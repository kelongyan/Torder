#![allow(dead_code)]

use rusqlite::OptionalExtension;
use serde_json::{json, Value};
use std::io::{Read, Write};

use super::validate::validate_operation;
use super::{
    Utc, MAX_BATCH_OPERATIONS, MAX_ID_LENGTH, MAX_SNAPSHOT_JSON_BYTES, MAX_SNAPSHOT_OPERATIONS,
    PROTOCOL,
};
use crate::db::attachment_repository::managed_blob_relative_path;
use crate::db::{sync_repository, Database};
use crate::error::{RepositoryError, RepositoryResult};
use crate::sync::manifest::{ChangeBatch, ChangeOperation, Snapshot};
use flate2::{read::GzDecoder, Compression, GzBuilder};

pub fn resolve_conflict(
    database: &Database,
    conflict_id: &str,
    resolution: &str,
) -> RepositoryResult<()> {
    resolve_conflict_with_payload(database, conflict_id, resolution, None)
}

pub fn resolve_conflict_with_payload(
    database: &Database,
    conflict_id: &str,
    resolution: &str,
    merged_payload: Option<Value>,
) -> RepositoryResult<()> {
    if !matches!(resolution, "keepLocal" | "acceptRemote" | "merge" | "copy") {
        return Err(RepositoryError::Validation(
            "invalid sync conflict resolution",
        ));
    }
    let mut connection = database.connect()?;
    let transaction = connection.transaction()?;
    let conflict = transaction.query_row(
        "SELECT entity, object_id, local_revision, remote_revision, local_payload_json, remote_payload_json FROM sync_conflicts WHERE id = ?1 AND resolved_at IS NULL",
        rusqlite::params![conflict_id],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
            ))
        },
    ).optional()?.ok_or(RepositoryError::NotFound("sync conflict"))?;
    if conflict_id.starts_with("list-name-conflict:") && resolution == "keepLocal" {
        return Err(RepositoryError::Validation(
            "rename the local list before resolving this sync conflict",
        ));
    }
    let local_payload: Value = serde_json::from_str(&conflict.4)?;
    let remote_payload: Value = serde_json::from_str(&conflict.5)?;
    let mut object_id = conflict.1.clone();
    let payload: Value = match resolution {
        "keepLocal" => local_payload.clone(),
        "acceptRemote" => remote_payload.clone(),
        "merge" => merged_payload.unwrap_or_else(|| merge_payload(&local_payload, &remote_payload)),
        "copy" => {
            if conflict.0 != "task" && conflict.0 != "calendarEvent" {
                return Err(RepositoryError::Validation(
                    "only tasks and calendar events can be copied from a conflict",
                ));
            }
            object_id = uuid::Uuid::new_v4().to_string();
            let mut copy = merge_payload(&local_payload, &remote_payload)
                .as_object()
                .cloned()
                .ok_or(RepositoryError::Validation(
                    "invalid remote conflict payload",
                ))?;
            copy.insert("id".to_owned(), Value::String(object_id.clone()));
            copy.insert("deletedAt".to_owned(), Value::Null);
            Value::Object(copy)
        }
        _ => unreachable!("resolution validated above"),
    };
    let (base_revision, revision) = if resolution == "copy" {
        (0, 1)
    } else {
        (
            conflict.2,
            conflict
                .2
                .checked_add(1)
                .ok_or(RepositoryError::Validation("sync revision overflow"))?,
        )
    };
    let operation = ChangeOperation {
        id: format!("resolution-{conflict_id}"),
        entity: conflict.0.clone(),
        object_id,
        operation: if payload.get("deletedAt").and_then(Value::as_str).is_some() {
            "delete"
        } else {
            "upsert"
        }
        .to_owned(),
        base_revision,
        revision,
        changed_at: Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        payload,
    };
    validate_operation(&operation)?;
    if resolution != "keepLocal" {
        apply_operation(&transaction, &operation)?;
    }
    sync_repository::record_change(
        &transaction,
        &operation.entity,
        &operation.object_id,
        &operation.operation,
        operation.payload.clone(),
    )?;
    transaction.execute(
        "UPDATE sync_conflicts SET resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), resolution = ?2 WHERE id = ?1 AND resolved_at IS NULL",
        rusqlite::params![conflict_id, resolution],
    )?;
    transaction.commit()?;
    Ok(())
}

fn merge_payload(local: &Value, remote: &Value) -> Value {
    let mut merged = local.as_object().cloned().unwrap_or_default();
    if let Some(remote) = remote.as_object() {
        for (key, value) in remote {
            merged.insert(key.clone(), value.clone());
        }
    }
    Value::Object(merged)
}

pub fn build_snapshot(
    connection: &mut rusqlite::Connection,
    sequence: i64,
) -> RepositoryResult<Snapshot> {
    let transaction = connection.transaction()?;
    let objects = {
        let mut statement = transaction.prepare(
            r#"SELECT entity, object_id, revision, last_changed_at
               FROM sync_objects
               ORDER BY CASE entity
                 WHEN 'list' THEN 0
                 WHEN 'recurringRule' THEN 1
                 WHEN 'task' THEN 2
                 WHEN 'attachment' THEN 3
                 WHEN 'calendarEvent' THEN 4
                 ELSE 5
               END, object_id"#,
        )?;
        let values = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        values
    };
    if objects.len() > MAX_SNAPSHOT_OPERATIONS {
        return Err(RepositoryError::Validation(
            "sync snapshot contains too many objects",
        ));
    }
    let mut operations = Vec::with_capacity(objects.len());
    for (index, (entity, object_id, revision, changed_at)) in objects.into_iter().enumerate() {
        let payload = current_payload(&transaction, &entity, &object_id)?;
        operations.push(ChangeOperation {
            id: format!("snapshot-{sequence}-{index}"),
            entity,
            object_id,
            operation: if payload.get("deletedAt").and_then(Value::as_str).is_some() {
                "delete"
            } else {
                "upsert"
            }
            .to_owned(),
            base_revision: 0,
            revision,
            changed_at,
            payload,
        });
    }
    transaction.commit()?;
    Ok(Snapshot {
        protocol: PROTOCOL,
        sequence,
        created_at: Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        operations,
    })
}

pub(crate) fn encode_snapshot(snapshot: &Snapshot) -> RepositoryResult<Vec<u8>> {
    let json = serde_json::to_vec(snapshot)?;
    if json.len() as u64 > MAX_SNAPSHOT_JSON_BYTES {
        return Err(RepositoryError::Validation("sync snapshot is too large"));
    }
    let mut encoder = GzBuilder::new()
        .mtime(0)
        .write(Vec::new(), Compression::default());
    encoder.write_all(&json)?;
    Ok(encoder.finish()?)
}

pub(crate) fn decode_snapshot(payload: &[u8]) -> RepositoryResult<Snapshot> {
    let decoder = GzDecoder::new(payload);
    let mut limited = decoder.take(MAX_SNAPSHOT_JSON_BYTES + 1);
    let mut json = Vec::new();
    limited
        .read_to_end(&mut json)
        .map_err(|_| RepositoryError::Validation("invalid compressed sync snapshot"))?;
    if json.len() as u64 > MAX_SNAPSHOT_JSON_BYTES {
        return Err(RepositoryError::Validation(
            "decompressed sync snapshot is too large",
        ));
    }
    let snapshot: Snapshot = serde_json::from_slice(&json)
        .map_err(|_| RepositoryError::Validation("invalid sync snapshot"))?;
    if snapshot.protocol != PROTOCOL
        || snapshot.sequence < 1
        || snapshot.operations.len() > MAX_SNAPSHOT_OPERATIONS
        || chrono::DateTime::parse_from_rfc3339(&snapshot.created_at).is_err()
    {
        return Err(RepositoryError::Validation("invalid sync snapshot"));
    }
    Ok(snapshot)
}

pub fn apply_batch(
    connection: &mut rusqlite::Connection,
    batch: &ChangeBatch,
) -> RepositoryResult<()> {
    apply_batch_with_limit(connection, batch, MAX_BATCH_OPERATIONS)
}

pub fn apply_snapshot(
    connection: &mut rusqlite::Connection,
    snapshot: &Snapshot,
) -> RepositoryResult<()> {
    let batch = ChangeBatch {
        protocol: snapshot.protocol,
        sequence: snapshot.sequence,
        device_id: "snapshot".to_owned(),
        created_at: snapshot.created_at.clone(),
        operations: snapshot.operations.clone(),
    };
    apply_batch_with_limit(connection, &batch, MAX_SNAPSHOT_OPERATIONS)
}

pub fn apply_batch_with_limit(
    connection: &mut rusqlite::Connection,
    batch: &ChangeBatch,
    operation_limit: usize,
) -> RepositoryResult<()> {
    if batch.protocol != PROTOCOL || batch.sequence < 1 {
        return Err(RepositoryError::Validation("invalid sync change batch"));
    }
    if batch.device_id.trim().is_empty() || batch.device_id.len() > MAX_ID_LENGTH {
        return Err(RepositoryError::Validation("invalid sync device id"));
    }
    if chrono::DateTime::parse_from_rfc3339(&batch.created_at).is_err() {
        return Err(RepositoryError::Validation("invalid sync batch timestamp"));
    }
    if batch.operations.len() > operation_limit {
        return Err(RepositoryError::Validation(
            "sync change batch has too many operations",
        ));
    }
    let mut operations = batch.operations.iter().collect::<Vec<_>>();
    // Objects with foreign-key references must be present before their dependents.
    // Stable sorting retains the sender's order for multiple revisions of one object.
    operations.sort_by_key(|operation| entity_order(&operation.entity));
    for operation in &operations {
        validate_operation(operation)?;
    }
    if let Some((index, local_list_id)) = find_remote_list_name_collision(connection, &operations)?
    {
        record_remote_list_name_conflict(connection, operations[index], &local_list_id)?;
        return Err(RepositoryError::Validation(
            "sync list name conflicts with an existing local list; rename it before syncing",
        ));
    }
    let transaction = connection.transaction()?;
    for operation in operations {
        if sync_repository::has_change(&transaction, &operation.id)? {
            continue;
        }
        if let Some(conflict_id) =
            unresolved_conflict_id(&transaction, &operation.entity, &operation.object_id)?
        {
            // A list-name collision is a pre-apply guard: once the local
            // list has been renamed, the original remote batch must continue
            // through the normal dependency-ordered apply path.
            if !conflict_id.starts_with("list-name-conflict:") {
                refresh_unresolved_conflict(&transaction, &conflict_id, operation)?;
                record_remote_change(&transaction, batch, operation)?;
                continue;
            }
        }
        let local_revision = transaction
            .query_row(
                "SELECT revision FROM sync_objects WHERE entity = ?1 AND object_id = ?2",
                rusqlite::params![operation.entity, operation.object_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
            .unwrap_or(0);
        if local_revision > operation.base_revision {
            if local_revision == operation.revision
                && current_payload(&transaction, &operation.entity, &operation.object_id)
                    .is_ok_and(|payload| payload == operation.payload)
            {
                record_remote_change(&transaction, batch, operation)?;
                continue;
            }
            transaction.execute(
                r#"INSERT INTO sync_conflicts (
                    id, entity, object_id, local_revision, remote_revision,
                    local_payload_json, remote_payload_json, detected_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))"#,
                rusqlite::params![
                    uuid::Uuid::new_v4().to_string(),
                    operation.entity,
                    operation.object_id,
                    local_revision,
                    operation.revision,
                    local_payload(&transaction, operation)?,
                    serde_json::to_string(&operation.payload)?,
                ],
            )?;
            record_remote_change(&transaction, batch, operation)?;
            continue;
        }
        apply_operation(&transaction, operation)?;
        record_remote_change(&transaction, batch, operation)?;
        resolve_remote_list_name_conflict(&transaction, operation)?;
        transaction.execute(
            r#"INSERT INTO sync_objects (entity, object_id, revision, last_changed_at, last_source_device, deleted_at)
               VALUES (?1, ?2, ?3, ?4, ?5, json_extract(?6, '$.deletedAt'))
               ON CONFLICT(entity, object_id) DO UPDATE SET
                 revision = excluded.revision,
                 last_changed_at = excluded.last_changed_at,
                 last_source_device = excluded.last_source_device,
                 deleted_at = excluded.deleted_at"#,
            rusqlite::params![
                operation.entity,
                operation.object_id,
                operation.revision,
                operation.changed_at,
                batch.device_id,
                serde_json::to_string(&operation.payload)?,
            ],
        )?;
    }
    transaction.commit()?;
    Ok(())
}

fn unresolved_conflict_id(
    transaction: &rusqlite::Transaction<'_>,
    entity: &str,
    object_id: &str,
) -> RepositoryResult<Option<String>> {
    Ok(transaction
        .query_row(
            "SELECT id FROM sync_conflicts WHERE entity = ?1 AND object_id = ?2 AND resolved_at IS NULL ORDER BY remote_revision DESC, detected_at DESC LIMIT 1",
            rusqlite::params![entity, object_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?)
}

fn refresh_unresolved_conflict(
    transaction: &rusqlite::Transaction<'_>,
    conflict_id: &str,
    operation: &ChangeOperation,
) -> RepositoryResult<()> {
    let current_local_revision = transaction
        .query_row(
            "SELECT revision FROM sync_objects WHERE entity = ?1 AND object_id = ?2",
            rusqlite::params![operation.entity, operation.object_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .unwrap_or(0);
    let local_payload = current_payload(transaction, &operation.entity, &operation.object_id)
        .unwrap_or_else(|_| json!({ "id": operation.object_id }));
    transaction.execute(
        "UPDATE sync_conflicts SET local_revision = ?2, remote_revision = MAX(remote_revision, ?3), local_payload_json = ?4, remote_payload_json = CASE WHEN remote_revision < ?3 THEN ?5 ELSE remote_payload_json END, detected_at = CASE WHEN remote_revision < ?3 THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE detected_at END WHERE id = ?1 AND resolved_at IS NULL",
        rusqlite::params![
            conflict_id,
            current_local_revision,
            operation.revision,
            serde_json::to_string(&local_payload)?,
            serde_json::to_string(&operation.payload)?,
        ],
    )?;
    Ok(())
}

fn find_remote_list_name_collision(
    connection: &rusqlite::Connection,
    operations: &[&ChangeOperation],
) -> RepositoryResult<Option<(usize, String)>> {
    let mut names: Vec<(String, String)> = Vec::new();
    for (index, operation) in operations
        .iter()
        .enumerate()
        .filter(|(_, operation)| operation.entity == "list")
    {
        if connection
            .query_row(
                "SELECT 1 FROM sync_changes WHERE id = ?1 LIMIT 1",
                rusqlite::params![operation.id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
            .is_some()
        {
            continue;
        }
        let name = if let Some(name) = operation.payload.get("name").and_then(Value::as_str) {
            name.to_owned()
        } else {
            connection
                .query_row(
                    "SELECT name FROM lists WHERE id = ?1",
                    rusqlite::params![operation.object_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?
                .unwrap_or_else(|| "同步清单".to_owned())
        };

        let existing_id = connection
            .query_row(
                "SELECT id FROM lists WHERE name = ?1 COLLATE NOCASE AND id <> ?2",
                rusqlite::params![&name, operation.object_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if let Some(existing_id) = existing_id {
            return Ok(Some((index, existing_id)));
        }

        if names.iter().any(|(known_id, known_name)| {
            known_id != &operation.object_id && known_name.eq_ignore_ascii_case(&name)
        }) {
            return Err(RepositoryError::Validation(
                "sync batch contains duplicate list names; resolve them before syncing",
            ));
        }
        names.push((operation.object_id.clone(), name));
    }
    Ok(None)
}

fn list_name_conflict_id(operation_id: &str) -> String {
    format!("list-name-conflict:{operation_id}")
}

fn record_remote_list_name_conflict(
    connection: &mut rusqlite::Connection,
    operation: &ChangeOperation,
    local_list_id: &str,
) -> RepositoryResult<()> {
    let transaction = connection.transaction()?;
    let local_payload = current_payload(&transaction, "list", local_list_id)
        .unwrap_or_else(|_| json!({ "id": local_list_id }));
    let local_revision = transaction
        .query_row(
            "SELECT revision FROM sync_objects WHERE entity = 'list' AND object_id = ?1",
            rusqlite::params![local_list_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .unwrap_or(0);
    transaction.execute(
        r#"INSERT INTO sync_conflicts (
            id, entity, object_id, local_revision, remote_revision,
            local_payload_json, remote_payload_json, detected_at
        ) VALUES (?1, 'list', ?2, ?3, ?4, ?5, ?6, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        ON CONFLICT(id) DO UPDATE SET
            local_revision = excluded.local_revision,
            remote_revision = excluded.remote_revision,
            local_payload_json = excluded.local_payload_json,
            remote_payload_json = excluded.remote_payload_json,
            detected_at = excluded.detected_at,
            resolved_at = NULL,
            resolution = NULL"#,
        rusqlite::params![
            list_name_conflict_id(&operation.id),
            operation.object_id,
            local_revision,
            operation.revision,
            serde_json::to_string(&local_payload)?,
            serde_json::to_string(&operation.payload)?,
        ],
    )?;
    transaction.commit()?;
    Ok(())
}

fn resolve_remote_list_name_conflict(
    transaction: &rusqlite::Transaction<'_>,
    operation: &ChangeOperation,
) -> RepositoryResult<()> {
    if operation.entity != "list" {
        return Ok(());
    }
    transaction.execute(
        "UPDATE sync_conflicts SET resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), resolution = 'retryAfterRename' WHERE id = ?1 AND resolved_at IS NULL",
        rusqlite::params![list_name_conflict_id(&operation.id)],
    )?;
    Ok(())
}

fn entity_order(entity: &str) -> u8 {
    match entity {
        "list" => 0,
        "recurringRule" => 1,
        "task" => 2,
        "attachment" => 3,
        "calendarEvent" => 4,
        _ => 5,
    }
}

fn record_remote_change(
    transaction: &rusqlite::Transaction<'_>,
    batch: &ChangeBatch,
    operation: &ChangeOperation,
) -> RepositoryResult<()> {
    transaction.execute(
        r#"INSERT INTO sync_changes (
            id, entity, object_id, operation, base_revision, revision,
            payload_json, created_at, uploaded_at, remote_sequence
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, ?9)"#,
        rusqlite::params![
            operation.id,
            operation.entity,
            operation.object_id,
            operation.operation,
            operation.base_revision,
            operation.revision,
            serde_json::to_string(&operation.payload)?,
            operation.changed_at,
            batch.sequence,
        ],
    )?;
    Ok(())
}

fn local_payload(
    transaction: &rusqlite::Transaction<'_>,
    operation: &ChangeOperation,
) -> RepositoryResult<String> {
    let payload = current_payload(transaction, &operation.entity, &operation.object_id)
        .unwrap_or_else(|_| json!({ "id": operation.object_id }));
    Ok(serde_json::to_string(&payload)?)
}

pub(crate) fn current_payload(
    transaction: &rusqlite::Transaction<'_>,
    entity: &str,
    object_id: &str,
) -> RepositoryResult<Value> {
    let sql = match entity {
        "list" => "SELECT json_object('id', id, 'name', name, 'color', color, 'sortOrder', sort_order, 'isDefault', json(CASE WHEN is_default = 1 THEN 'true' ELSE 'false' END), 'createdAt', created_at, 'updatedAt', updated_at, 'deletedAt', deleted_at) FROM lists WHERE id = ?1",
        "recurringRule" => "SELECT json_object('id', id, 'title', title, 'note', note, 'priority', priority, 'listId', list_id, 'frequency', frequency, 'intervalCount', interval_count, 'weekdays', json(weekdays), 'monthDay', month_day, 'firstDueAt', first_due_at, 'nextDueAt', next_due_at, 'timezone', timezone, 'generateAheadMinutes', generate_ahead_minutes, 'remindBefore', remind_before, 'endAt', end_at, 'enabled', json(CASE WHEN enabled = 1 THEN 'true' ELSE 'false' END), 'createdAt', created_at, 'updatedAt', updated_at, 'deletedAt', deleted_at) FROM recurring_rules WHERE id = ?1",
        "task" => "SELECT json_object('id', id, 'title', title, 'note', note, 'status', status, 'priority', priority, 'listId', list_id, 'scheduledDate', scheduled_date, 'dueAt', due_at, 'completedAt', completed_at, 'sortOrder', sort_order, 'remindBefore', remind_before, 'remindAt', remind_at, 'remindedAt', reminded_at, 'repeatRule', repeat_rule, 'subtasks', json(subtasks), 'tags', json(tags), 'recurringRuleId', recurring_rule_id, 'occurrenceAt', occurrence_at, 'createdAt', created_at, 'updatedAt', updated_at, 'deletedAt', deleted_at) FROM tasks WHERE id = ?1",
        "calendarEvent" => "SELECT json_object('id', id, 'title', title, 'eventType', event_type, 'startDate', start_date, 'endDate', end_date, 'note', note, 'createdAt', created_at, 'updatedAt', updated_at, 'deletedAt', deleted_at) FROM calendar_events WHERE id = ?1",
        "attachment" => "SELECT json_object('id', a.id, 'taskId', a.task_id, 'kind', a.kind, 'blobId', a.blob_id, 'displayName', a.display_name, 'originalName', a.original_name, 'externalUrl', a.external_url, 'contentSha256', b.content_sha256, 'sizeBytes', b.size_bytes, 'mimeType', b.mime_type, 'remotePath', b.remote_path, 'encryptionKeyId', b.encryption_key_id, 'sortOrder', a.sort_order, 'createdAt', a.created_at, 'updatedAt', a.updated_at, 'deletedAt', a.deleted_at) FROM task_attachments AS a LEFT JOIN attachment_blobs AS b ON b.id = a.blob_id WHERE a.id = ?1",
        _ => return Err(RepositoryError::Validation("invalid sync entity")),
    };
    let encoded = transaction.query_row(sql, rusqlite::params![object_id], |row| {
        row.get::<_, String>(0)
    })?;
    Ok(serde_json::from_str(&encoded)?)
}

fn merged_payload(
    transaction: &rusqlite::Transaction<'_>,
    operation: &ChangeOperation,
) -> RepositoryResult<Value> {
    let mut merged = match current_payload(transaction, &operation.entity, &operation.object_id) {
        Ok(payload) => payload,
        Err(RepositoryError::Database(rusqlite::Error::QueryReturnedNoRows)) => {
            if !has_full_insert_payload(&operation.entity, &operation.payload) {
                return Err(RepositoryError::Validation(
                    "sync partial payload requires existing object",
                ));
            }
            json!({})
        }
        Err(error) => return Err(error),
    };
    let target = merged.as_object_mut().expect("sync payload object");
    for (key, value) in operation.payload.as_object().expect("validated payload") {
        target.insert(key.clone(), value.clone());
    }
    target.insert("id".to_owned(), Value::String(operation.object_id.clone()));
    Ok(merged)
}

fn has_full_insert_payload(entity: &str, payload: &Value) -> bool {
    let Some(payload) = payload.as_object() else {
        return false;
    };
    let required_fields: &[&str] = match entity {
        "list" => &["name", "sortOrder", "isDefault", "deletedAt"],
        "recurringRule" => &[
            "title",
            "priority",
            "listId",
            "frequency",
            "intervalCount",
            "weekdays",
            "firstDueAt",
            "timezone",
            "generateAheadMinutes",
            "enabled",
            "deletedAt",
        ],
        "task" => &[
            "title",
            "status",
            "priority",
            "listId",
            "sortOrder",
            "deletedAt",
        ],
        "calendarEvent" => &["title", "eventType", "startDate", "endDate", "deletedAt"],
        "attachment" => &["taskId", "kind", "displayName", "sortOrder", "deletedAt"],
        _ => return false,
    };
    required_fields
        .iter()
        .all(|field| payload.contains_key(*field))
}

fn apply_operation(
    transaction: &rusqlite::Transaction<'_>,
    operation: &ChangeOperation,
) -> RepositoryResult<()> {
    let payload = merged_payload(transaction, operation)?;
    match operation.entity.as_str() {
        "list" => {
            transaction.execute(
                r#"INSERT INTO lists (id, name, color, sort_order, is_default, created_at, updated_at, deleted_at)
                   VALUES (?1, ?2, ?3, ?4, ?5, COALESCE(?6, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
                           COALESCE(?7, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), ?8)
                   ON CONFLICT(id) DO UPDATE SET name=excluded.name, color=excluded.color,
                     sort_order=excluded.sort_order, is_default=excluded.is_default,
                     updated_at=excluded.updated_at, deleted_at=excluded.deleted_at"#,
                rusqlite::params![operation.object_id, string(&payload, "name", "同步清单"), optional_string(&payload, "color"), integer(&payload, "sortOrder", 0), boolean(&payload, "isDefault", false), optional_string(&payload, "createdAt"), optional_string(&payload, "updatedAt"), optional_string(&payload, "deletedAt")],
            )?;
        }
        "recurringRule" => {
            let weekdays = payload
                .get("weekdays")
                .cloned()
                .unwrap_or_else(|| json!([]));
            transaction.execute(
                r#"INSERT INTO recurring_rules (id, title, note, priority, list_id, frequency, interval_count, weekdays, month_day, first_due_at, next_due_at, timezone, generate_ahead_minutes, remind_before, end_at, enabled, created_at, updated_at, deleted_at)
                   VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16,
                           COALESCE(?17, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), COALESCE(?18, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), ?19)
                   ON CONFLICT(id) DO UPDATE SET title=excluded.title, note=excluded.note, priority=excluded.priority,
                     list_id=excluded.list_id, frequency=excluded.frequency, interval_count=excluded.interval_count,
                     weekdays=excluded.weekdays, month_day=excluded.month_day, first_due_at=excluded.first_due_at,
                     next_due_at=excluded.next_due_at, timezone=excluded.timezone,
                     generate_ahead_minutes=excluded.generate_ahead_minutes, remind_before=excluded.remind_before,
                     end_at=excluded.end_at, enabled=excluded.enabled, updated_at=excluded.updated_at,
                     deleted_at=excluded.deleted_at"#,
                rusqlite::params![operation.object_id, string(&payload, "title", "同步循环任务"), optional_string(&payload, "note"), integer(&payload, "priority", 1), string(&payload, "listId", "work"), string(&payload, "frequency", "daily"), integer(&payload, "intervalCount", 1), serde_json::to_string(&weekdays)?, optional_integer(&payload, "monthDay"), string(&payload, "firstDueAt", "1970-01-01T00:00:00Z"), optional_string(&payload, "nextDueAt"), string(&payload, "timezone", "UTC"), integer(&payload, "generateAheadMinutes", 0), optional_integer(&payload, "remindBefore"), optional_string(&payload, "endAt"), boolean(&payload, "enabled", true), optional_string(&payload, "createdAt"), optional_string(&payload, "updatedAt"), optional_string(&payload, "deletedAt")],
            )?;
        }
        "task" => {
            let subtasks = payload
                .get("subtasks")
                .cloned()
                .unwrap_or_else(|| json!([]));
            let tags = payload.get("tags").cloned().unwrap_or_else(|| json!([]));
            transaction.execute(
                r#"INSERT INTO tasks (
                    id, title, note, status, priority, list_id, scheduled_date, due_at, completed_at,
                    sort_order, remind_before, remind_at, reminded_at, repeat_rule, recurring_rule_id,
                    occurrence_at, subtasks, tags, created_at, updated_at, deleted_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18,
                          COALESCE(?19, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
                          COALESCE(?20, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), ?21)
                ON CONFLICT(id) DO UPDATE SET title=excluded.title, note=excluded.note,
                  status=excluded.status, priority=excluded.priority, list_id=excluded.list_id,
                  scheduled_date=excluded.scheduled_date,
                  due_at=excluded.due_at, completed_at=excluded.completed_at, sort_order=excluded.sort_order,
                  remind_before=excluded.remind_before, remind_at=excluded.remind_at,
                  reminded_at=excluded.reminded_at,
                  repeat_rule=excluded.repeat_rule, recurring_rule_id=excluded.recurring_rule_id,
                  occurrence_at=excluded.occurrence_at, subtasks=excluded.subtasks,
                  tags=excluded.tags, updated_at=excluded.updated_at,
                  deleted_at=excluded.deleted_at"#,
                rusqlite::params![
                    operation.object_id,
                    string(&payload, "title", "同步任务"), optional_string(&payload, "note"),
                    string(&payload, "status", "todo"), integer(&payload, "priority", 1),
                    string(&payload, "listId", "work"), optional_string(&payload, "scheduledDate"),
                    optional_string(&payload, "dueAt"),
                    optional_string(&payload, "completedAt"), integer(&payload, "sortOrder", 0),
                    optional_integer(&payload, "remindBefore"), optional_string(&payload, "remindAt"),
                    optional_string(&payload, "remindedAt"), optional_string(&payload, "repeatRule"),
                    optional_string(&payload, "recurringRuleId"), optional_string(&payload, "occurrenceAt"),
                    serde_json::to_string(&subtasks)?, serde_json::to_string(&tags)?,
                    optional_string(&payload, "createdAt"),
                    optional_string(&payload, "updatedAt"), optional_string(&payload, "deletedAt"),
                ],
            )?;
        }
        "attachment" => {
            let kind = string(&payload, "kind", "managed");
            let blob_id = optional_string(&payload, "blobId");
            if kind == "managed" {
                let blob_id = blob_id.ok_or(RepositoryError::Validation(
                    "managed attachment requires blob id",
                ))?;
                let local_relative_path = managed_blob_relative_path(blob_id);
                transaction.execute(
                    r#"INSERT INTO attachment_blobs (
                           id, content_sha256, size_bytes, mime_type, local_relative_path,
                           remote_path, encryption_key_id, sync_state, created_at, updated_at, deleted_at
                       )
                       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pendingDownload',
                               COALESCE(?8, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
                               COALESCE(?9, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), NULL)
                       ON CONFLICT(id) DO UPDATE SET
                         content_sha256=excluded.content_sha256,
                         size_bytes=excluded.size_bytes,
                         mime_type=excluded.mime_type,
                         remote_path=excluded.remote_path,
                         encryption_key_id=excluded.encryption_key_id,
                         sync_state=CASE
                           WHEN attachment_blobs.content_sha256 = excluded.content_sha256
                             AND attachment_blobs.sync_state = 'downloaded'
                           THEN attachment_blobs.sync_state
                           ELSE 'pendingDownload'
                         END,
                         updated_at=excluded.updated_at,
                         deleted_at=NULL"#,
                    rusqlite::params![
                        blob_id,
                        string(&payload, "contentSha256", ""),
                        integer(&payload, "sizeBytes", 0),
                        optional_string(&payload, "mimeType"),
                        local_relative_path,
                        optional_string(&payload, "remotePath"),
                        optional_string(&payload, "encryptionKeyId"),
                        optional_string(&payload, "createdAt"),
                        optional_string(&payload, "updatedAt"),
                    ],
                )?;
            }
            transaction.execute(
                r#"INSERT INTO task_attachments (
                       id, task_id, kind, blob_id, display_name, original_name, external_url,
                       sort_order, created_at, updated_at, deleted_at
                   )
                   VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
                           COALESCE(?9, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
                           COALESCE(?10, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), ?11)
                   ON CONFLICT(id) DO UPDATE SET
                     task_id=excluded.task_id,
                     kind=excluded.kind,
                     blob_id=excluded.blob_id,
                     display_name=excluded.display_name,
                     original_name=excluded.original_name,
                     external_url=excluded.external_url,
                     sort_order=excluded.sort_order,
                     updated_at=excluded.updated_at,
                     deleted_at=excluded.deleted_at"#,
                rusqlite::params![
                    operation.object_id,
                    string(&payload, "taskId", ""),
                    kind,
                    blob_id,
                    string(&payload, "displayName", "附件"),
                    optional_string(&payload, "originalName"),
                    optional_string(&payload, "externalUrl"),
                    integer(&payload, "sortOrder", 0),
                    optional_string(&payload, "createdAt"),
                    optional_string(&payload, "updatedAt"),
                    optional_string(&payload, "deletedAt"),
                ],
            )?;
        }
        "calendarEvent" => {
            transaction.execute(
                r#"INSERT INTO calendar_events (
                       id, title, event_type, start_date, end_date, note,
                       created_at, updated_at, deleted_at
                   )
                   VALUES (?1, ?2, ?3, ?4, ?5, ?6,
                           COALESCE(?7, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
                           COALESCE(?8, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), ?9)
                   ON CONFLICT(id) DO UPDATE SET title=excluded.title, event_type=excluded.event_type,
                     start_date=excluded.start_date, end_date=excluded.end_date, note=excluded.note,
                     created_at=excluded.created_at, updated_at=excluded.updated_at,
                     deleted_at=excluded.deleted_at"#,
                rusqlite::params![operation.object_id, string(&payload, "title", "同步事件"),
                    string(&payload, "eventType", "trip"), string(&payload, "startDate", "1970-01-01"),
                    string(&payload, "endDate", "1970-01-01"), optional_string(&payload, "note"),
                    optional_string(&payload, "createdAt"), optional_string(&payload, "updatedAt"),
                    optional_string(&payload, "deletedAt")],
            )?;
        }
        _ => {}
    }
    Ok(())
}

fn string<'a>(payload: &'a Value, key: &str, fallback: &'a str) -> &'a str {
    payload.get(key).and_then(Value::as_str).unwrap_or(fallback)
}

fn optional_string<'a>(payload: &'a Value, key: &str) -> Option<&'a str> {
    payload.get(key).and_then(Value::as_str)
}

fn integer(payload: &Value, key: &str, fallback: i64) -> i64 {
    payload.get(key).and_then(Value::as_i64).unwrap_or(fallback)
}

fn optional_integer(payload: &Value, key: &str) -> Option<i64> {
    payload.get(key).and_then(Value::as_i64)
}

fn boolean(payload: &Value, key: &str, fallback: bool) -> bool {
    payload
        .get(key)
        .and_then(Value::as_bool)
        .unwrap_or(fallback)
}
