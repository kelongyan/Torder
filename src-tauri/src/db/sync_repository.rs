use chrono::{SecondsFormat, Utc};
use rusqlite::{params, OptionalExtension, Transaction};
use serde_json::Value;
use uuid::Uuid;

use crate::error::RepositoryResult;
use crate::models::{SyncChange, SyncCleanupResult, SyncConflict, SyncDevice, SyncStatus};
use crate::sync::credentials;

/// Records a business-object mutation. The caller must invoke this before
/// committing the same transaction that changed the business row.
pub fn record_change(
    transaction: &Transaction<'_>,
    entity: &str,
    object_id: &str,
    operation: &str,
    payload: Value,
) -> RepositoryResult<()> {
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    let current_revision = transaction
        .query_row(
            "SELECT revision FROM sync_objects WHERE entity = ?1 AND object_id = ?2",
            params![entity, object_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .unwrap_or(0);
    let revision =
        current_revision
            .checked_add(1)
            .ok_or(crate::error::RepositoryError::Validation(
                "sync revision overflow",
            ))?;
    let deleted_at = payload.get("deletedAt").and_then(Value::as_str);

    transaction.execute(
        r#"
        INSERT INTO sync_objects (
            entity, object_id, revision, last_changed_at, deleted_at
        ) VALUES (?1, ?2, ?3, ?4, ?5)
        ON CONFLICT(entity, object_id) DO UPDATE SET
            revision = excluded.revision,
            last_changed_at = excluded.last_changed_at,
            deleted_at = excluded.deleted_at
        "#,
        params![entity, object_id, revision, now, deleted_at],
    )?;
    transaction.execute(
        r#"
        INSERT INTO sync_changes (
            id, entity, object_id, operation, base_revision, revision,
            payload_json, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        "#,
        params![
            Uuid::new_v4().to_string(),
            entity,
            object_id,
            operation,
            current_revision,
            revision,
            serde_json::to_string(&payload)?,
            now,
        ],
    )?;
    Ok(())
}

pub fn pending_count(connection: &rusqlite::Connection) -> RepositoryResult<i64> {
    Ok(connection.query_row(
        "SELECT COUNT(*) FROM sync_changes WHERE uploaded_at IS NULL",
        [],
        |row| row.get(0),
    )?)
}

pub fn list_pending(
    connection: &rusqlite::Connection,
    limit: i64,
) -> RepositoryResult<Vec<SyncChange>> {
    let mut statement = connection.prepare(
        r#"SELECT id, entity, object_id, operation, base_revision, revision,
                  payload_json, created_at, uploaded_at, remote_sequence
           FROM sync_changes WHERE uploaded_at IS NULL
           ORDER BY created_at ASC LIMIT ?1"#,
    )?;
    let rows = statement
        .query_map(params![limit.clamp(1, 5000)], |row| {
            Ok(SyncChange {
                id: row.get(0)?,
                entity: row.get(1)?,
                object_id: row.get(2)?,
                operation: row.get(3)?,
                base_revision: row.get(4)?,
                revision: row.get(5)?,
                payload_json: row.get(6)?,
                created_at: row.get(7)?,
                uploaded_at: row.get(8)?,
                remote_sequence: row.get(9)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn status(connection: &rusqlite::Connection) -> RepositoryResult<SyncStatus> {
    let setting = |key: &str| -> RepositoryResult<Option<String>> {
        Ok(connection
            .query_row(
                "SELECT value FROM sync_state WHERE key = ?1",
                params![key],
                |row| row.get(0),
            )
            .optional()?)
    };
    let conflict_count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM sync_conflicts WHERE resolved_at IS NULL",
        [],
        |row| row.get(0),
    )?;
    let configured = setting("serverUrl")?.is_some();
    let encryption_config = setting("encryptionConfig")?
        .map(|value| {
            serde_json::from_str::<crate::sync::manifest::EncryptionConfig>(&value).map_err(|_| {
                crate::error::RepositoryError::Validation(
                    "invalid local sync encryption configuration",
                )
            })
        })
        .transpose()?;
    let encryption_key_id = encryption_config
        .as_ref()
        .map(|config| config.key_id.clone());
    let encryption_key_available = match encryption_key_id.as_deref() {
        Some(key_id) => credentials::has_encryption_key(connection, key_id)?,
        None => false,
    };
    let stored_state = setting("syncStatus")?
        .unwrap_or_else(|| if configured { "configured" } else { "disabled" }.to_owned());
    let last_sync_at = setting("lastSyncAt")?;
    let sync_started_at = setting("syncStartedAt")?;
    let state = if stored_state == "syncing" && !sync_is_active(sync_started_at.as_deref()) {
        normalized_sync_state(
            if last_sync_at.is_some() {
                "success"
            } else {
                "configured"
            },
            configured,
            conflict_count,
            last_sync_at.is_some(),
        )
    } else {
        normalized_sync_state(
            &stored_state,
            configured,
            conflict_count,
            last_sync_at.is_some(),
        )
    };
    Ok(SyncStatus {
        state,
        configured,
        has_credential: credentials::is_available(connection)?,
        server_url: setting("serverUrl")?,
        remote_path: setting("remotePath")?,
        username: setting("username")?,
        device_name: setting("deviceName")?,
        pending_changes: pending_count(connection)?,
        conflict_count,
        phase: setting("syncPhase")?,
        last_sync_at,
        last_error: setting("lastError")?,
        encryption_enabled: encryption_config.is_some(),
        encryption_key_available,
        encryption_key_id,
    })
}

fn sync_is_active(started_at: Option<&str>) -> bool {
    let Some(started_at) = started_at else {
        return false;
    };
    let Ok(started_at) = chrono::DateTime::parse_from_rfc3339(started_at) else {
        return false;
    };
    let elapsed = Utc::now().signed_duration_since(started_at.with_timezone(&Utc));
    elapsed >= chrono::Duration::zero() && elapsed <= chrono::Duration::minutes(3)
}

fn normalized_sync_state(
    stored_state: &str,
    configured: bool,
    conflict_count: i64,
    has_last_sync: bool,
) -> String {
    match (conflict_count > 0, stored_state) {
        (true, "configured" | "success") => "needsConflict".to_owned(),
        (false, "needsConflict") => {
            if has_last_sync {
                "success".to_owned()
            } else if configured {
                "configured".to_owned()
            } else {
                "disabled".to_owned()
            }
        }
        _ => stored_state.to_owned(),
    }
}

pub fn set_state(
    connection: &rusqlite::Connection,
    key: &str,
    value: &str,
) -> RepositoryResult<()> {
    connection.execute(
        r#"INSERT INTO sync_state (key, value, updated_at)
           VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
           ON CONFLICT(key) DO UPDATE SET
             value = excluded.value, updated_at = excluded.updated_at"#,
        params![key, value],
    )?;
    Ok(())
}

pub fn clear_state(connection: &rusqlite::Connection, key: &str) -> RepositoryResult<()> {
    connection.execute("DELETE FROM sync_state WHERE key = ?1", params![key])?;
    Ok(())
}

pub fn clear_local_sync_data(connection: &mut rusqlite::Connection) -> RepositoryResult<()> {
    let transaction = connection.transaction()?;
    transaction.execute_batch(
        "DELETE FROM sync_changes;
         DELETE FROM sync_objects;
         DELETE FROM sync_conflicts;
         DELETE FROM sync_devices;",
    )?;
    transaction.commit()?;
    Ok(())
}

pub fn get_state(connection: &rusqlite::Connection, key: &str) -> RepositoryResult<Option<String>> {
    Ok(connection
        .query_row(
            "SELECT value FROM sync_state WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()?)
}

pub fn ensure_device(
    connection: &rusqlite::Connection,
    id: &str,
    name: &str,
) -> RepositoryResult<()> {
    connection.execute(
        r#"INSERT INTO sync_devices (id, name, created_at)
           VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
           ON CONFLICT(id) DO UPDATE SET name = excluded.name"#,
        params![id, name],
    )?;
    Ok(())
}

pub fn import_manifest_device(
    connection: &rusqlite::Connection,
    id: &str,
    name: &str,
    last_seen_at: &str,
    last_remote_sequence: i64,
    enabled: bool,
) -> RepositoryResult<()> {
    connection.execute(
        r#"INSERT INTO sync_devices (id, name, created_at, last_sync_at, last_remote_sequence, enabled)
           VALUES (?1, ?2, ?3, ?3, ?4, ?5)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             last_sync_at = CASE
               WHEN sync_devices.last_sync_at IS NULL
                 OR sync_devices.last_sync_at < excluded.last_sync_at
               THEN excluded.last_sync_at
               ELSE sync_devices.last_sync_at
             END,
             last_remote_sequence = MAX(sync_devices.last_remote_sequence, excluded.last_remote_sequence),
             enabled = sync_devices.enabled * excluded.enabled"#,
        params![id, name, last_seen_at, last_remote_sequence, i64::from(enabled)],
    )?;
    Ok(())
}

pub fn update_device_sync(
    connection: &rusqlite::Connection,
    id: &str,
    synced_at: &str,
    remote_sequence: i64,
) -> RepositoryResult<()> {
    connection.execute(
        r#"UPDATE sync_devices
           SET last_sync_at = ?2, last_remote_sequence = ?3
           WHERE id = ?1 AND enabled = 1"#,
        params![id, synced_at, remote_sequence],
    )?;
    Ok(())
}

pub fn is_device_enabled(connection: &rusqlite::Connection, id: &str) -> RepositoryResult<bool> {
    Ok(connection
        .query_row(
            "SELECT enabled FROM sync_devices WHERE id = ?1",
            params![id],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .is_none_or(|enabled| enabled != 0))
}

pub fn list_devices(connection: &rusqlite::Connection) -> RepositoryResult<Vec<SyncDevice>> {
    let current_device_id = get_state(connection, "deviceId")?;
    let mut statement = connection.prepare(
        "SELECT id, name, created_at, last_sync_at, last_remote_sequence, enabled FROM sync_devices ORDER BY enabled DESC, last_sync_at DESC, created_at ASC",
    )?;
    let devices = statement
        .query_map([], |row| {
            let id = row.get::<_, String>(0)?;
            Ok(SyncDevice {
                current: current_device_id.as_deref() == Some(id.as_str()),
                id,
                name: row.get(1)?,
                created_at: row.get(2)?,
                last_sync_at: row.get(3)?,
                last_remote_sequence: row.get(4)?,
                enabled: row.get::<_, i64>(5)? != 0,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(devices)
}

pub fn revoke_device(connection: &rusqlite::Connection, id: &str) -> RepositoryResult<()> {
    if get_state(connection, "deviceId")?.as_deref() == Some(id) {
        return Err(crate::error::RepositoryError::Validation(
            "current sync device cannot be revoked",
        ));
    }
    let updated = connection.execute(
        "UPDATE sync_devices SET enabled = 0 WHERE id = ?1",
        params![id],
    )?;
    if updated == 0 {
        return Err(crate::error::RepositoryError::NotFound("sync device"));
    }
    Ok(())
}

pub fn prune_history(connection: &rusqlite::Connection) -> RepositoryResult<SyncCleanupResult> {
    let transaction = connection.unchecked_transaction()?;
    let changes_removed = transaction.execute(
        r#"DELETE FROM sync_changes AS change
           WHERE change.uploaded_at IS NOT NULL
             AND julianday(change.created_at) < julianday('now', '-30 days')
             AND NOT EXISTS (
               SELECT 1 FROM sync_devices AS device
               WHERE device.enabled = 1
                 AND device.last_remote_sequence < COALESCE(change.remote_sequence, 0)
             )"#,
        [],
    )? as i64;
    let tombstones_removed = transaction.execute(
        r#"DELETE FROM sync_objects AS object
           WHERE object.deleted_at IS NOT NULL
             AND julianday(object.deleted_at) < julianday('now', '-30 days')
             AND NOT EXISTS (
               SELECT 1 FROM sync_changes AS change
               WHERE change.entity = object.entity
                 AND change.object_id = object.object_id
             )"#,
        [],
    )? as i64;
    transaction.commit()?;
    Ok(SyncCleanupResult {
        changes_removed,
        tombstones_removed,
    })
}

pub fn mark_uploaded(
    connection: &rusqlite::Connection,
    ids: &[String],
    remote_sequence: i64,
) -> RepositoryResult<()> {
    for id in ids {
        connection.execute(
            "UPDATE sync_changes SET uploaded_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), remote_sequence = ?2 WHERE id = ?1 AND uploaded_at IS NULL",
            params![id, remote_sequence],
        )?;
    }
    Ok(())
}

pub fn has_change(connection: &rusqlite::Connection, id: &str) -> RepositoryResult<bool> {
    Ok(connection
        .query_row(
            "SELECT 1 FROM sync_changes WHERE id = ?1",
            params![id],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .is_some())
}

pub fn list_conflicts(
    connection: &rusqlite::Connection,
    include_resolved: bool,
    limit: i64,
) -> RepositoryResult<Vec<SyncConflict>> {
    let where_clause = if include_resolved {
        ""
    } else {
        "WHERE resolved_at IS NULL"
    };
    let sql = format!(
        "SELECT id, entity, object_id, local_revision, remote_revision, local_payload_json, remote_payload_json, detected_at, resolved_at, resolution FROM sync_conflicts {where_clause} ORDER BY detected_at DESC LIMIT ?1"
    );
    let mut statement = connection.prepare(&sql)?;
    let rows = statement
        .query_map(params![limit.clamp(1, 5000)], |row| {
            Ok(SyncConflict {
                id: row.get(0)?,
                entity: row.get(1)?,
                object_id: row.get(2)?,
                local_revision: row.get(3)?,
                remote_revision: row.get(4)?,
                local_payload_json: row.get(5)?,
                remote_payload_json: row.get(6)?,
                detected_at: row.get(7)?,
                resolved_at: row.get(8)?,
                resolution: row.get(9)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::{normalized_sync_state, sync_is_active};

    #[test]
    fn conflicts_promote_configured_or_success_to_needs_conflict() {
        assert_eq!(
            normalized_sync_state("configured", true, 1, false),
            "needsConflict"
        );
        assert_eq!(
            normalized_sync_state("success", true, 2, true),
            "needsConflict"
        );
    }

    #[test]
    fn resolved_conflicts_restore_success_when_a_sync_exists() {
        assert_eq!(
            normalized_sync_state("needsConflict", true, 0, true),
            "success"
        );
    }

    #[test]
    fn resolved_conflicts_restore_configured_before_first_sync() {
        assert_eq!(
            normalized_sync_state("needsConflict", true, 0, false),
            "configured"
        );
    }

    #[test]
    fn resolved_conflicts_restore_disabled_when_not_configured() {
        assert_eq!(
            normalized_sync_state("needsConflict", false, 0, false),
            "disabled"
        );
        assert_eq!(
            normalized_sync_state("disabled", false, 0, false),
            "disabled"
        );
    }

    #[test]
    fn stale_syncing_state_is_recoverable_after_restart() {
        assert!(!sync_is_active(None));
        assert!(!sync_is_active(Some("not-a-timestamp")));
        assert!(!sync_is_active(Some("2020-01-01T00:00:00Z")));
        let now = chrono::Utc::now().to_rfc3339();
        assert!(sync_is_active(Some(&now)));
    }
}
