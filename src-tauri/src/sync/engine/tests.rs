#[test]
fn initial_sync_mode_defaults_to_merge_and_rejects_unknown_values() {
    assert_eq!(
        InitialSyncMode::parse(None).unwrap(),
        InitialSyncMode::Merge
    );
    assert_eq!(
        InitialSyncMode::parse(Some("upload")).unwrap(),
        InitialSyncMode::Upload
    );
    assert_eq!(
        InitialSyncMode::parse(Some("download")).unwrap(),
        InitialSyncMode::Download
    );
    assert!(InitialSyncMode::parse(Some("overwrite")).is_err());
    assert!(validate_initial_sync_mode(InitialSyncMode::Upload, 3, 0).is_ok());
    assert!(validate_initial_sync_mode(InitialSyncMode::Upload, 3, 1).is_err());
    assert!(validate_initial_sync_mode(InitialSyncMode::Download, 0, 1).is_ok());
    assert!(validate_initial_sync_mode(InitialSyncMode::Download, 1, 1).is_err());
}
use super::*;
use crate::db::attachment_repository::AttachmentRepository;
use crate::db::database::Database;
use crate::db::recurring_repository::RecurringRuleRepository;
use crate::db::sync_repository;
use crate::error::RepositoryError;
use crate::models::SyncChange;
use crate::sync::credentials;
use crate::sync::engine::apply::resolve_conflict_with_payload;
use crate::sync::manifest::{ChangeBatch, ChangeOperation, Manifest, ManifestDevice, Snapshot};
use crate::sync::webdav::WebDavClient;
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::thread::JoinHandle;

fn operation(id: &str, entity: &str, object_id: &str, payload: Value) -> ChangeOperation {
    ChangeOperation {
        id: id.to_owned(),
        entity: entity.to_owned(),
        object_id: object_id.to_owned(),
        operation: "upsert".to_owned(),
        base_revision: 0,
        revision: 1,
        changed_at: "2026-08-21T00:00:00.000Z".to_owned(),
        payload,
    }
}

fn keyring_test_guard() -> MutexGuard<'static, ()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(())).lock().unwrap()
}

#[test]
fn generated_occurrence_sync_payload_contains_full_insert_fields() {
    let path = std::env::temp_dir().join(format!(
        "torder-sync-occurrence-payload-{}.sqlite",
        uuid::Uuid::new_v4()
    ));
    let database = Database::initialize(path.clone()).unwrap();
    let repository = RecurringRuleRepository::new(&database);
    repository
        .create(crate::models::CreateRecurringRuleInput {
            source_task_id: None,
            title: "每日同步载荷".to_owned(),
            note: None,
            priority: 1,
            list_id: "work".to_owned(),
            frequency: "daily".to_owned(),
            interval_count: 1,
            weekdays: Vec::new(),
            month_day: None,
            first_due_at: "2026-01-01T00:00:00Z".to_owned(),
            timezone: "UTC".to_owned(),
            generate_ahead_minutes: 0,
            remind_before: None,
            end_at: None,
        })
        .unwrap();
    let result = repository.generate_due().unwrap();
    assert!(result.generated_count >= 1);

    let connection = database.connect().unwrap();
    let payload_json: String = connection
        .query_row(
            "SELECT payload_json FROM sync_changes WHERE entity = 'task' ORDER BY revision DESC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let payload: Value = serde_json::from_str(&payload_json).unwrap();
    // 接收端 has_full_insert_payload 要求这些字段齐全；缺失任一都会让本地无该任务的
    // 设备拒收整批（"sync partial payload requires existing object"），同步永久卡死
    for field in [
        "title",
        "status",
        "priority",
        "listId",
        "sortOrder",
        "deletedAt",
    ] {
        assert!(
            payload.get(field).is_some(),
            "generated occurrence payload misses required field: {field}"
        );
    }

    drop(connection);
    drop(database);
    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_file(format!("{}-wal", path.display()));
    let _ = std::fs::remove_file(format!("{}-shm", path.display()));
}

#[test]
fn apply_batch_skips_duplicate_recurring_occurrence() {
    let path = std::env::temp_dir().join(format!(
        "torder-sync-occurrence-duplicate-{}.sqlite",
        uuid::Uuid::new_v4()
    ));
    let database = Database::initialize(path.clone()).unwrap();
    let repository = RecurringRuleRepository::new(&database);
    let rule = repository
        .create(crate::models::CreateRecurringRuleInput {
            source_task_id: None,
            title: "双设备同期次".to_owned(),
            note: None,
            priority: 1,
            list_id: "work".to_owned(),
            frequency: "daily".to_owned(),
            interval_count: 1,
            weekdays: Vec::new(),
            month_day: None,
            first_due_at: "2026-01-01T09:00:00Z".to_owned(),
            timezone: "UTC".to_owned(),
            generate_ahead_minutes: 0,
            remind_before: None,
            end_at: None,
        })
        .unwrap();
    repository.generate_due().unwrap();
    // generate_due 每次只落最后一个到期期次，取本地实际生成的值作为远端批次的期次
    let occurrence: String = {
        let connection = database.connect().unwrap();
        let value = connection
            .query_row(
                "SELECT occurrence_at FROM tasks WHERE recurring_rule_id = ?1 AND deleted_at IS NULL ORDER BY occurrence_at DESC LIMIT 1",
                rusqlite::params![rule.id],
                |row| row.get(0),
            )
            .unwrap();
        drop(connection);
        value
    };

    let batch = ChangeBatch {
        protocol: PROTOCOL,
        sequence: 1,
        device_id: "remote-device".to_owned(),
        created_at: "2026-01-02T00:00:00.000Z".to_owned(),
        operations: vec![operation(
            "remote-occurrence-change",
            "task",
            "remote-occurrence-task",
            json!({
                "id": "remote-occurrence-task", "title": "远端生成的同期次实例",
                "status": "todo", "priority": 1, "listId": "work", "sortOrder": 0,
                "dueAt": occurrence, "recurringRuleId": rule.id,
                "occurrenceAt": occurrence, "deletedAt": null,
                "subtasks": [], "tags": []
            }),
        )],
    };

    let mut connection = database.connect().unwrap();
    // 修复前：INSERT 命中部分唯一索引 (rule, occurrence)，整批回滚、同步卡死；
    // 修复后：本地已有同 (规则, 期次) 存活行时幂等跳过
    apply_batch(&mut connection, &batch).unwrap();

    let live_count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM tasks WHERE recurring_rule_id = ?1 AND occurrence_at = ?2 AND deleted_at IS NULL AND purged_at IS NULL",
            rusqlite::params![rule.id, occurrence],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(live_count, 1);
    let remote_exists: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM tasks WHERE id = 'remote-occurrence-task'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(remote_exists, 0);

    drop(connection);
    drop(database);
    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_file(format!("{}-wal", path.display()));
    let _ = std::fs::remove_file(format!("{}-shm", path.display()));
}

#[test]
fn missing_webdav_collections_are_uninitialized() {
    assert!(missing_remote_collection(reqwest::StatusCode::NOT_FOUND));
    assert!(missing_remote_collection(reqwest::StatusCode::CONFLICT));
    assert!(!missing_remote_collection(
        reqwest::StatusCode::UNAUTHORIZED
    ));
}

#[test]
fn remote_collection_paths_create_nested_parents_first() {
    assert_eq!(
        remote_collection_paths("Torder/mobile"),
        vec![
            "Torder",
            "Torder/mobile",
            "Torder/mobile/changes",
            "Torder/mobile/snapshots",
            "Torder/mobile/locks",
        ]
    );
    assert_eq!(
        remote_collection_paths(".torder"),
        vec![
            ".torder",
            ".torder/changes",
            ".torder/snapshots",
            ".torder/locks",
        ]
    );
}

#[test]
fn rejects_invalid_remote_payload_fields_and_limits() {
    let invalid_payloads = [
        operation(
            "bad-status",
            "task",
            "task-id",
            json!({ "id": "task-id", "status": "unknown" }),
        ),
        operation(
            "bad-priority",
            "task",
            "task-id",
            json!({ "id": "task-id", "priority": 3 }),
        ),
        operation(
            "bad-frequency",
            "recurringRule",
            "rule-id",
            json!({ "id": "rule-id", "frequency": "yearly" }),
        ),
        operation(
            "bad-weekdays",
            "recurringRule",
            "rule-id",
            json!({ "id": "rule-id", "weekdays": [7] }),
        ),
        operation(
            "bad-event-date",
            "calendarEvent",
            "event-id",
            json!({ "id": "event-id", "startDate": "2026-02-30" }),
        ),
        operation(
            "bad-event-type",
            "calendarEvent",
            "event-id",
            json!({ "id": "event-id", "eventType": "meeting" }),
        ),
        operation(
            "mismatched-id",
            "list",
            "list-id",
            json!({ "id": "other-id" }),
        ),
        operation(
            "unknown-field",
            "task",
            "task-id",
            json!({ "id": "task-id", "password": "must-not-sync" }),
        ),
        operation(
            "bad-attachment-kind",
            "attachment",
            "attachment-id",
            json!({ "id": "attachment-id", "taskId": "task-id", "kind": "localReference", "displayName": "本机路径", "sortOrder": 0, "deletedAt": null }),
        ),
        operation(
            "bad-attachment-url",
            "attachment",
            "attachment-id",
            json!({ "id": "attachment-id", "taskId": "task-id", "kind": "webLink", "displayName": "链接", "externalUrl": "file:///secret", "sortOrder": 0, "deletedAt": null }),
        ),
        operation(
            "long-title",
            "task",
            "task-id",
            json!({ "id": "task-id", "title": "x".repeat(513) }),
        ),
    ];

    for operation in invalid_payloads {
        assert!(validate_operation(&operation).is_err(), "{}", operation.id);
    }

    let mut nested = json!(null);
    for _ in 0..=MAX_JSON_DEPTH {
        nested = json!({ "value": nested });
    }
    let deeply_nested = operation(
        "deeply-nested",
        "task",
        "task-id",
        json!({ "id": "task-id", "note": nested }),
    );
    assert!(validate_operation(&deeply_nested).is_err());
}

#[test]
fn rejects_unknown_protocol_fields_in_manifest_and_change_batches() {
    let manifest = json!({
        "protocol": PROTOCOL,
        "collectionId": uuid::Uuid::new_v4().to_string(),
        "format": "torder-sync",
        "schemaVersion": 2,
        "latestSequence": 0,
        "updatedAt": "2026-08-21T00:00:00.000Z",
        "unexpected": true
    });
    assert!(serde_json::from_value::<Manifest>(manifest).is_err());

    let batch = json!({
        "protocol": PROTOCOL,
        "sequence": 1,
        "deviceId": "remote-device",
        "createdAt": "2026-08-21T00:00:00.000Z",
        "operations": [],
        "unexpected": true
    });
    assert!(serde_json::from_value::<ChangeBatch>(batch).is_err());
}

#[test]
fn rejects_change_batch_over_operation_limit() {
    let repeated = operation(
        "change-id",
        "task",
        "task-id",
        json!({ "id": "task-id", "title": "valid" }),
    );
    let batch = ChangeBatch {
        protocol: PROTOCOL,
        sequence: 1,
        device_id: "remote-device".to_owned(),
        created_at: "2026-08-21T00:00:00.000Z".to_owned(),
        operations: vec![repeated; MAX_BATCH_OPERATIONS + 1],
    };
    let mut connection = rusqlite::Connection::open_in_memory().unwrap();

    assert!(apply_batch(&mut connection, &batch).is_err());
}

#[test]
fn rejects_remote_list_name_collision_without_mutating_local_data() {
    let path = std::env::temp_dir().join(format!(
        "torder-sync-list-name-collision-{}.sqlite",
        uuid::Uuid::new_v4()
    ));
    let database = Database::initialize(path.clone()).unwrap();
    let mut connection = database.connect().unwrap();
    connection
        .execute(
            "INSERT INTO lists (id, name, color, sort_order, is_default) VALUES ('local-list', 'Inbox', '#123456', 4, 0)",
            [],
        )
        .unwrap();
    let batch = ChangeBatch {
        protocol: PROTOCOL,
        sequence: 1,
        device_id: "remote-device".to_owned(),
        created_at: "2026-08-21T00:00:00.000Z".to_owned(),
        operations: vec![
            operation(
                "remote-list-change",
                "list",
                "remote-list",
                json!({
                    "id": "remote-list", "name": "inbox", "color": "#654321",
                    "sortOrder": 5, "isDefault": false, "deletedAt": null
                }),
            ),
            operation(
                "remote-task-change",
                "task",
                "remote-task",
                json!({
                    "id": "remote-task", "title": "不应部分导入", "status": "todo",
                    "priority": 1, "listId": "remote-list", "sortOrder": 0,
                    "deletedAt": null
                }),
            ),
        ],
    };

    let error = apply_batch(&mut connection, &batch)
        .unwrap_err()
        .to_string();
    assert!(error.contains("sync list name conflicts"), "{error}");
    assert_eq!(
        connection
            .query_row(
                "SELECT COUNT(*) FROM lists WHERE id = 'remote-list'",
                [],
                |row| { row.get::<_, i64>(0) }
            )
            .unwrap(),
        0
    );
    assert_eq!(
        connection
            .query_row(
                "SELECT COUNT(*) FROM tasks WHERE id = 'remote-task'",
                [],
                |row| { row.get::<_, i64>(0) }
            )
            .unwrap(),
        0
    );
    assert_eq!(
        connection
            .query_row(
                "SELECT name FROM lists WHERE id = 'local-list'",
                [],
                |row| { row.get::<_, String>(0) }
            )
            .unwrap(),
        "Inbox"
    );
    assert_eq!(sync_repository::pending_count(&connection).unwrap(), 0);
    assert_eq!(
        connection
            .query_row(
                "SELECT COUNT(*) FROM sync_conflicts WHERE id = 'list-name-conflict:remote-list-change' AND resolved_at IS NULL",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
        1
    );

    connection
        .execute(
            "UPDATE lists SET name = 'Local Inbox' WHERE id = 'local-list'",
            [],
        )
        .unwrap();
    apply_batch(&mut connection, &batch).unwrap();
    assert_eq!(
        connection
            .query_row(
                "SELECT name FROM lists WHERE id = 'remote-list'",
                [],
                |row| { row.get::<_, String>(0) }
            )
            .unwrap(),
        "inbox"
    );
    assert_eq!(
        connection
            .query_row(
                "SELECT COUNT(*) FROM tasks WHERE id = 'remote-task'",
                [],
                |row| { row.get::<_, i64>(0) }
            )
            .unwrap(),
        1
    );
    assert_eq!(
        connection
            .query_row(
                "SELECT resolution FROM sync_conflicts WHERE id = 'list-name-conflict:remote-list-change'",
                [],
                |row| row.get::<_, Option<String>>(0),
            )
            .unwrap()
            .as_deref(),
        Some("retryAfterRename")
    );

    drop(connection);
    drop(database);
    cleanup_database(&path);
}

#[test]
fn upload_batch_splits_when_serialized_payload_exceeds_one_megabyte() {
    let large_title = "x".repeat(15_000);
    let changes = (0..100)
        .map(|index| SyncChange {
            id: format!("change-{index}"),
            entity: "task".to_owned(),
            object_id: format!("task-{index}"),
            operation: "upsert".to_owned(),
            base_revision: 0,
            revision: 1,
            payload_json: serde_json::to_string(&json!({
                "id": format!("task-{index}"),
                "title": large_title,
            }))
            .unwrap(),
            created_at: "2026-08-21T00:00:00.000Z".to_owned(),
            uploaded_at: None,
            remote_sequence: None,
        })
        .collect::<Vec<_>>();

    let (_, batch_value, operation_count) =
        build_upload_batch(&changes, 1, "local-device", None).unwrap();
    assert!(operation_count < changes.len());
    assert!(serde_json::to_vec(&batch_value).unwrap().len() <= MAX_BATCH_JSON_BYTES);
}

#[test]
fn rejects_corrupt_local_sync_payload_instead_of_uploading_a_placeholder() {
    let changes = vec![SyncChange {
        id: "corrupt-change".to_owned(),
        entity: "task".to_owned(),
        object_id: "task-1".to_owned(),
        operation: "upsert".to_owned(),
        base_revision: 0,
        revision: 1,
        payload_json: "not-json".to_owned(),
        created_at: "2026-08-21T00:00:00.000Z".to_owned(),
        uploaded_at: None,
        remote_sequence: None,
    }];

    assert!(matches!(
        build_upload_batch(&changes, 1, "local-device", None),
        Err(RepositoryError::Validation("invalid local sync payload"))
    ));
}

#[test]
fn remote_task_payload_preserves_reminded_at() {
    let path = std::env::temp_dir().join(format!(
        "torder-sync-reminded-at-{}.sqlite",
        uuid::Uuid::new_v4()
    ));
    let database = Database::initialize(path.clone()).unwrap();
    let mut connection = database.connect().unwrap();
    let reminded_at = "2026-08-21T08:30:00.000Z";
    let batch = ChangeBatch {
        protocol: PROTOCOL,
        sequence: 1,
        device_id: "remote-device".to_owned(),
        created_at: "2026-08-21T08:31:00.000Z".to_owned(),
        operations: vec![operation(
            "task-reminded-at",
            "task",
            "remote-task",
            json!({
                "id": "remote-task",
                "title": "已提醒任务",
                "status": "todo",
                "priority": 1,
                "listId": "work",
                "sortOrder": 0,
                "remindedAt": reminded_at,
                "deletedAt": null
            }),
        )],
    };

    apply_batch(&mut connection, &batch).unwrap();

    assert_eq!(
        connection
            .query_row(
                "SELECT reminded_at FROM tasks WHERE id = 'remote-task'",
                [],
                |row| row.get::<_, Option<String>>(0),
            )
            .unwrap()
            .as_deref(),
        Some(reminded_at)
    );
    drop(connection);
    drop(database);
    cleanup_database(&path);
}

#[test]
fn rejects_partial_remote_payload_without_local_base() {
    let path = std::env::temp_dir().join(format!(
        "torder-sync-partial-missing-base-{}.sqlite",
        uuid::Uuid::new_v4()
    ));
    let database = Database::initialize(path.clone()).unwrap();
    let mut connection = database.connect().unwrap();
    let batch = ChangeBatch {
        protocol: PROTOCOL,
        sequence: 1,
        device_id: "remote-device".to_owned(),
        created_at: "2026-08-21T08:31:00.000Z".to_owned(),
        operations: vec![operation(
            "partial-remote-task",
            "task",
            "remote-task",
            json!({
                "id": "remote-task",
                "title": "只有标题的增量"
            }),
        )],
    };

    let error = apply_batch(&mut connection, &batch).unwrap_err();

    assert!(matches!(
        error,
        RepositoryError::Validation("sync partial payload requires existing object")
    ));
    assert_eq!(
        connection
            .query_row(
                "SELECT COUNT(*) FROM tasks WHERE id = 'remote-task'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
    assert_eq!(
        connection
            .query_row(
                "SELECT COUNT(*) FROM sync_changes WHERE id = 'partial-remote-task'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
    drop(connection);
    drop(database);
    cleanup_database(&path);
}

#[test]
fn applies_remote_attachment_metadata_after_task() {
    let path = std::env::temp_dir().join(format!(
        "torder-sync-attachment-{}.sqlite",
        uuid::Uuid::new_v4()
    ));
    let database = Database::initialize(path.clone()).unwrap();
    let mut connection = database.connect().unwrap();
    let attachment_payload = json!({
        "id": "remote-attachment",
        "taskId": "remote-task",
        "kind": "managed",
        "blobId": "remote-blob",
        "displayName": "合同.pdf",
        "originalName": "合同.pdf",
        "externalUrl": null,
        "contentSha256": "abc123",
        "sizeBytes": 12,
        "mimeType": "application/pdf",
        "remotePath": "attachments/blobs/re/remote-blob.bin",
        "sortOrder": 0,
        "createdAt": "2026-08-21T00:00:00.000Z",
        "updatedAt": "2026-08-21T00:00:00.000Z",
        "deletedAt": null,
    });
    let task_payload = json!({
        "id": "remote-task",
        "title": "带附件任务",
        "status": "todo",
        "priority": 1,
        "listId": "work",
        "sortOrder": 0,
        "createdAt": "2026-08-21T00:00:00.000Z",
        "updatedAt": "2026-08-21T00:00:00.000Z",
        "deletedAt": null,
    });
    let batch = ChangeBatch {
        protocol: PROTOCOL,
        sequence: 1,
        device_id: "remote-device".to_owned(),
        created_at: "2026-08-21T00:00:00.000Z".to_owned(),
        operations: vec![
            operation(
                "remote-attachment-op",
                "attachment",
                "remote-attachment",
                attachment_payload,
            ),
            operation("remote-task-op", "task", "remote-task", task_payload),
        ],
    };

    apply_batch(&mut connection, &batch).unwrap();

    let row: (String, String, String) = connection
        .query_row(
            "SELECT a.task_id, b.sync_state, b.remote_path FROM task_attachments AS a INNER JOIN attachment_blobs AS b ON b.id = a.blob_id WHERE a.id = 'remote-attachment'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(row.0, "remote-task");
    assert_eq!(row.1, "pendingDownload");
    assert_eq!(row.2, "attachments/blobs/re/remote-blob.bin");
    let payload = current_payload(
        &connection.unchecked_transaction().unwrap(),
        "attachment",
        "remote-attachment",
    )
    .unwrap();
    assert_eq!(payload["displayName"], "合同.pdf");
    assert_eq!(payload["sizeBytes"], 12);

    drop(connection);
    drop(database);
    cleanup_database(&path);
}

#[test]
fn applies_remote_task_link_after_referenced_tasks() {
    let path = std::env::temp_dir().join(format!(
        "torder-sync-task-link-{}.sqlite",
        uuid::Uuid::new_v4()
    ));
    let database = Database::initialize(path.clone()).unwrap();
    let mut connection = database.connect().unwrap();
    let source_task_payload = json!({
        "id": "remote-source-task",
        "title": "远端源任务",
        "status": "todo",
        "priority": 1,
        "listId": "work",
        "sortOrder": 0,
        "createdAt": "2026-08-21T00:00:00.000Z",
        "updatedAt": "2026-08-21T00:00:00.000Z",
        "deletedAt": null,
    });
    let target_task_payload = json!({
        "id": "remote-target-task",
        "title": "远端目标任务",
        "status": "todo",
        "priority": 1,
        "listId": "work",
        "sortOrder": 1000,
        "createdAt": "2026-08-21T00:00:00.000Z",
        "updatedAt": "2026-08-21T00:00:00.000Z",
        "deletedAt": null,
    });
    let task_link_payload = json!({
        "id": "remote-task-link",
        "sourceTaskId": "remote-source-task",
        "targetTaskId": "remote-target-task",
        "relationType": "reference",
        "sortOrder": 0,
        "createdAt": "2026-08-21T00:00:00.000Z",
        "updatedAt": "2026-08-21T00:00:00.000Z",
        "deletedAt": null,
    });
    let batch = ChangeBatch {
        protocol: PROTOCOL,
        sequence: 1,
        device_id: "remote-device".to_owned(),
        created_at: "2026-08-21T00:00:00.000Z".to_owned(),
        operations: vec![
            operation(
                "remote-task-link-op",
                "taskLink",
                "remote-task-link",
                task_link_payload,
            ),
            operation(
                "remote-target-task-op",
                "task",
                "remote-target-task",
                target_task_payload,
            ),
            operation(
                "remote-source-task-op",
                "task",
                "remote-source-task",
                source_task_payload,
            ),
        ],
    };

    apply_batch(&mut connection, &batch).unwrap();

    let row: (String, String, String) = connection
        .query_row(
            r#"
            SELECT l.source_task_id, l.target_task_id, target.title
            FROM task_links AS l
            INNER JOIN tasks AS target ON target.id = l.target_task_id
            WHERE l.id = 'remote-task-link'
            "#,
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(row.0, "remote-source-task");
    assert_eq!(row.1, "remote-target-task");
    assert_eq!(row.2, "远端目标任务");

    drop(connection);
    drop(database);
    cleanup_database(&path);
}

#[test]
fn rejects_remote_task_link_self_reference() {
    let change = operation(
        "self-task-link-op",
        "taskLink",
        "self-task-link",
        json!({
            "id": "self-task-link",
            "sourceTaskId": "task-1",
            "targetTaskId": "task-1",
            "relationType": "reference",
            "sortOrder": 0,
            "deletedAt": null,
        }),
    );

    assert!(matches!(
        validate_operation(&change),
        Err(RepositoryError::Validation(
            "task link cannot reference itself"
        ))
    ));
}

#[test]
fn applies_dependency_ordered_batch_and_replay_is_idempotent() {
    let path = std::env::temp_dir().join(format!(
        "torder-sync-engine-{}.sqlite",
        uuid::Uuid::new_v4()
    ));
    let database = Database::initialize(path.clone()).unwrap();
    let mut connection = database.connect().unwrap();
    let batch = ChangeBatch {
        protocol: PROTOCOL,
        sequence: 1,
        device_id: "remote-device".to_owned(),
        created_at: "2026-08-21T00:00:00.000Z".to_owned(),
        // Deliberately use the reverse dependency order to exercise sorting.
        operations: vec![
            operation(
                "event-change",
                "calendarEvent",
                "remote-event",
                json!({
                    "id": "remote-event", "title": "远端会议", "eventType": "other",
                    "startDate": "2026-09-01", "endDate": "2026-09-02", "note": null,
                    "createdAt": "2026-08-21T00:00:00.000Z",
                    "updatedAt": "2026-08-21T01:00:00.000Z",
                    "deletedAt": null
                }),
            ),
            operation(
                "task-change",
                "task",
                "remote-task",
                json!({
                    "id": "remote-task", "title": "远端任务", "status": "todo", "priority": 2,
                    "listId": "remote-list", "dueAt": null, "completedAt": null, "sortOrder": 0,
                    "remindBefore": null, "remindAt": null, "repeatRule": null,
                    "recurringRuleId": "remote-rule", "occurrenceAt": null, "deletedAt": null
                }),
            ),
            operation(
                "rule-change",
                "recurringRule",
                "remote-rule",
                json!({
                    "id": "remote-rule", "title": "远端循环", "note": null, "priority": 1,
                    "listId": "remote-list", "frequency": "weekly", "intervalCount": 1,
                    "weekdays": [1], "monthDay": null, "firstDueAt": "2026-09-01T09:00:00Z",
                    "nextDueAt": "2026-09-08T09:00:00Z", "timezone": "Asia/Shanghai",
                    "generateAheadMinutes": 0, "remindBefore": null, "endAt": null,
                    "enabled": true, "deletedAt": null
                }),
            ),
            operation(
                "list-change",
                "list",
                "remote-list",
                json!({
                    "id": "remote-list", "name": "远端清单", "color": "#123456", "sortOrder": 4,
                    "isDefault": false, "deletedAt": null
                }),
            ),
        ],
    };

    apply_batch(&mut connection, &batch).unwrap();
    assert_eq!(
        connection
            .query_row(
                "SELECT name FROM lists WHERE id = 'remote-list'",
                [],
                |row| row.get::<_, String>(0)
            )
            .unwrap(),
        "远端清单"
    );
    assert_eq!(
        connection
            .query_row(
                "SELECT list_id FROM recurring_rules WHERE id = 'remote-rule'",
                [],
                |row| row.get::<_, String>(0)
            )
            .unwrap(),
        "remote-list"
    );
    assert_eq!(
        connection
            .query_row(
                "SELECT recurring_rule_id FROM tasks WHERE id = 'remote-task'",
                [],
                |row| row.get::<_, Option<String>>(0)
            )
            .unwrap()
            .as_deref(),
        Some("remote-rule")
    );
    assert_eq!(
        connection
            .query_row(
                "SELECT title, event_type FROM calendar_events WHERE id = 'remote-event'",
                [],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            )
            .unwrap(),
        ("远端会议".to_owned(), "other".to_owned())
    );
    assert_eq!(
        connection
            .query_row(
                "SELECT created_at, updated_at FROM calendar_events WHERE id = 'remote-event'",
                [],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            )
            .unwrap(),
        (
            "2026-08-21T00:00:00.000Z".to_owned(),
            "2026-08-21T01:00:00.000Z".to_owned()
        )
    );

    apply_batch(&mut connection, &batch).unwrap();
    assert_eq!(
        connection
            .query_row(
                "SELECT COUNT(*) FROM sync_changes WHERE remote_sequence = 1",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        4
    );

    drop(connection);
    drop(database);
    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_file(format!("{}-wal", path.display()));
    let _ = std::fs::remove_file(format!("{}-shm", path.display()));
}

#[test]
fn incremental_remote_payload_preserves_existing_fields() {
    let path =
        std::env::temp_dir().join(format!("torder-sync-merge-{}.sqlite", uuid::Uuid::new_v4()));
    let database = Database::initialize(path.clone()).unwrap();
    let mut connection = database.connect().unwrap();
    let initial = ChangeBatch {
        protocol: PROTOCOL,
        sequence: 1,
        device_id: "remote-device".to_owned(),
        created_at: "2026-08-21T00:00:00.000Z".to_owned(),
        operations: vec![operation(
            "rule-full",
            "recurringRule",
            "remote-rule",
            json!({
                "id": "remote-rule", "title": "完整规则", "note": "保留备注", "priority": 2,
                "listId": "work", "frequency": "daily", "intervalCount": 1, "weekdays": [],
                "monthDay": null, "firstDueAt": "2026-09-01T09:00:00Z", "nextDueAt": "2026-09-02T09:00:00Z",
                "timezone": "UTC", "generateAheadMinutes": 5, "remindBefore": 10,
                "endAt": null, "enabled": true, "deletedAt": null
            }),
        )],
    };
    apply_batch(&mut connection, &initial).unwrap();
    let incremental = ChangeBatch {
        protocol: PROTOCOL,
        sequence: 2,
        device_id: "remote-device".to_owned(),
        created_at: "2026-08-21T01:00:00.000Z".to_owned(),
        operations: vec![ChangeOperation {
            id: "rule-disable".to_owned(),
            entity: "recurringRule".to_owned(),
            object_id: "remote-rule".to_owned(),
            operation: "upsert".to_owned(),
            base_revision: 1,
            revision: 2,
            changed_at: "2026-08-21T01:00:00.000Z".to_owned(),
            payload: json!({ "id": "remote-rule", "enabled": false }),
        }],
    };
    apply_batch(&mut connection, &incremental).unwrap();
    let values = connection
        .query_row(
            "SELECT title, note, priority, enabled FROM recurring_rules WHERE id = 'remote-rule'",
            [],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            },
        )
        .unwrap();
    assert_eq!(
        values,
        ("完整规则".to_owned(), Some("保留备注".to_owned()), 2, 0)
    );

    drop(connection);
    drop(database);
    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_file(format!("{}-wal", path.display()));
    let _ = std::fs::remove_file(format!("{}-shm", path.display()));
}

#[test]
fn resolving_conflict_keeps_local_and_records_new_revision() {
    let path = std::env::temp_dir().join(format!(
        "torder-sync-conflict-local-{}.sqlite",
        uuid::Uuid::new_v4()
    ));
    let database = Database::initialize(path.clone()).unwrap();
    let task = crate::db::task_repository::TaskRepository::new(&database)
        .create(crate::models::CreateTaskInput {
            title: "本地标题".to_owned(),
            note: None,
            priority: Some(1),
            list_id: Some("work".to_owned()),
            scheduled_date: None,
            due_at: None,
            sort_order: None,
            remind_before: None,
            repeat_rule: None,
            subtasks: None,
            tags: None,
        })
        .unwrap();
    let mut connection = database.connect().unwrap();
    let remote = ChangeBatch {
        protocol: PROTOCOL,
        sequence: 1,
        device_id: "remote-device".to_owned(),
        created_at: "2026-08-21T01:00:00.000Z".to_owned(),
        operations: vec![operation(
            "remote-task-update",
            "task",
            &task.id,
            json!({ "id": task.id, "title": "远端标题" }),
        )],
    };
    apply_batch(&mut connection, &remote).unwrap();
    let conflict_id = connection
        .query_row(
            "SELECT id FROM sync_conflicts WHERE resolved_at IS NULL",
            [],
            |row| row.get::<_, String>(0),
        )
        .unwrap();
    drop(connection);

    resolve_conflict_with_payload(&database, &conflict_id, "keepLocal", None).unwrap();
    let connection = database.connect().unwrap();
    assert_eq!(
        connection
            .query_row(
                "SELECT title FROM tasks WHERE id = ?1",
                rusqlite::params![task.id],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
        "本地标题"
    );
    assert_eq!(
        connection
            .query_row(
                "SELECT resolution FROM sync_conflicts WHERE id = ?1",
                rusqlite::params![conflict_id],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
        "keepLocal"
    );
    assert_eq!(
        connection
            .query_row(
                "SELECT revision FROM sync_objects WHERE entity = 'task' AND object_id = ?1",
                rusqlite::params![task.id],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
        2
    );

    drop(connection);
    drop(database);
    cleanup_database(&path);
}

#[test]
fn unresolved_conflict_blocks_later_remote_revisions_until_resolution() {
    let path = std::env::temp_dir().join(format!(
        "torder-sync-conflict-follow-up-{}.sqlite",
        uuid::Uuid::new_v4()
    ));
    let database = Database::initialize(path.clone()).unwrap();
    let task = crate::db::task_repository::TaskRepository::new(&database)
        .create(crate::models::CreateTaskInput {
            title: "本地标题".to_owned(),
            note: None,
            priority: Some(1),
            list_id: Some("work".to_owned()),
            scheduled_date: None,
            due_at: None,
            sort_order: None,
            remind_before: None,
            repeat_rule: None,
            subtasks: None,
            tags: None,
        })
        .unwrap();
    let mut connection = database.connect().unwrap();
    apply_batch(
        &mut connection,
        &ChangeBatch {
            protocol: PROTOCOL,
            sequence: 1,
            device_id: "remote-device".to_owned(),
            created_at: "2026-08-21T01:00:00.000Z".to_owned(),
            operations: vec![operation(
                "remote-task-update-1",
                "task",
                &task.id,
                json!({ "id": task.id, "title": "远端标题 1" }),
            )],
        },
    )
    .unwrap();

    let follow_up = ChangeOperation {
        id: "remote-task-update-2".to_owned(),
        entity: "task".to_owned(),
        object_id: task.id.clone(),
        operation: "upsert".to_owned(),
        base_revision: 1,
        revision: 2,
        changed_at: "2026-08-21T02:00:00.000Z".to_owned(),
        payload: json!({ "id": task.id, "title": "远端标题 2" }),
    };
    apply_batch(
        &mut connection,
        &ChangeBatch {
            protocol: PROTOCOL,
            sequence: 2,
            device_id: "remote-device".to_owned(),
            created_at: "2026-08-21T02:00:00.000Z".to_owned(),
            operations: vec![follow_up],
        },
    )
    .unwrap();

    assert_eq!(
        connection
            .query_row(
                "SELECT title FROM tasks WHERE id = ?1",
                rusqlite::params![task.id],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
        "本地标题"
    );
    let conflict = connection
        .query_row(
            "SELECT remote_revision, remote_payload_json FROM sync_conflicts WHERE entity = 'task' AND object_id = ?1 AND resolved_at IS NULL",
            rusqlite::params![task.id],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
        )
        .unwrap();
    assert_eq!(conflict.0, 2);
    assert_eq!(
        serde_json::from_str::<Value>(&conflict.1).unwrap()["title"],
        "远端标题 2"
    );
    assert_eq!(
        connection
            .query_row(
                "SELECT COUNT(*) FROM sync_conflicts WHERE entity = 'task' AND object_id = ?1 AND resolved_at IS NULL",
                rusqlite::params![task.id],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
        1
    );

    drop(connection);
    drop(database);
    cleanup_database(&path);
}

#[test]
fn resolving_conflict_accepts_remote_payload_and_records_new_revision() {
    let path = std::env::temp_dir().join(format!(
        "torder-sync-conflict-remote-{}.sqlite",
        uuid::Uuid::new_v4()
    ));
    let database = Database::initialize(path.clone()).unwrap();
    let task = crate::db::task_repository::TaskRepository::new(&database)
        .create(crate::models::CreateTaskInput {
            title: "本地标题".to_owned(),
            note: Some("本地备注".to_owned()),
            priority: Some(1),
            list_id: Some("work".to_owned()),
            scheduled_date: None,
            due_at: None,
            sort_order: None,
            remind_before: None,
            repeat_rule: None,
            subtasks: None,
            tags: None,
        })
        .unwrap();
    let mut connection = database.connect().unwrap();
    let remote = ChangeBatch {
        protocol: PROTOCOL,
        sequence: 1,
        device_id: "remote-device".to_owned(),
        created_at: "2026-08-21T01:00:00.000Z".to_owned(),
        operations: vec![operation(
            "remote-task-update",
            "task",
            &task.id,
            json!({ "id": task.id, "title": "远端标题", "priority": 2 }),
        )],
    };
    apply_batch(&mut connection, &remote).unwrap();
    let conflict_id = connection
        .query_row(
            "SELECT id FROM sync_conflicts WHERE resolved_at IS NULL",
            [],
            |row| row.get::<_, String>(0),
        )
        .unwrap();
    drop(connection);

    resolve_conflict_with_payload(&database, &conflict_id, "acceptRemote", None).unwrap();
    let connection = database.connect().unwrap();
    let resolved = connection
        .query_row(
            "SELECT title, note, priority FROM tasks WHERE id = ?1",
            rusqlite::params![task.id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .unwrap();
    assert_eq!(
        resolved,
        ("远端标题".to_owned(), Some("本地备注".to_owned()), 2)
    );
    assert_eq!(
        connection
            .query_row(
                "SELECT resolution FROM sync_conflicts WHERE id = ?1",
                rusqlite::params![conflict_id],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
        "acceptRemote"
    );
    assert_eq!(sync_repository::pending_count(&connection).unwrap(), 2);

    drop(connection);
    drop(database);
    cleanup_database(&path);
}

#[test]
fn resolving_conflict_can_merge_or_copy_without_destroying_original() {
    let path = std::env::temp_dir().join(format!(
        "torder-sync-conflict-copy-{}.sqlite",
        uuid::Uuid::new_v4()
    ));
    let database = Database::initialize(path.clone()).unwrap();
    let task = crate::db::task_repository::TaskRepository::new(&database)
        .create(crate::models::CreateTaskInput {
            title: "本地任务".to_owned(),
            note: Some("本地备注".to_owned()),
            priority: Some(1),
            list_id: Some("work".to_owned()),
            scheduled_date: None,
            due_at: None,
            sort_order: None,
            remind_before: None,
            repeat_rule: None,
            subtasks: None,
            tags: None,
        })
        .unwrap();
    let mut connection = database.connect().unwrap();
    let remote = ChangeBatch {
        protocol: PROTOCOL,
        sequence: 1,
        device_id: "remote-device".to_owned(),
        created_at: "2026-08-21T01:00:00.000Z".to_owned(),
        operations: vec![operation(
            "remote-task-copy",
            "task",
            &task.id,
            json!({ "id": task.id, "title": "远端任务", "priority": 2 }),
        )],
    };
    apply_batch(&mut connection, &remote).unwrap();
    let conflict_id = connection
        .query_row(
            "SELECT id FROM sync_conflicts WHERE resolved_at IS NULL",
            [],
            |row| row.get::<_, String>(0),
        )
        .unwrap();
    drop(connection);

    resolve_conflict_with_payload(
        &database,
        &conflict_id,
        "merge",
        Some(json!({ "id": task.id, "title": "合并任务", "note": "保留备注" })),
    )
    .unwrap();
    let mut connection = database.connect().unwrap();
    assert_eq!(
        connection
            .query_row(
                "SELECT title, note FROM tasks WHERE id = ?1",
                rusqlite::params![task.id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
            )
            .unwrap(),
        ("合并任务".to_owned(), Some("保留备注".to_owned()))
    );
    let remote_copy = ChangeBatch {
        protocol: PROTOCOL,
        sequence: 2,
        device_id: "remote-device".to_owned(),
        created_at: "2026-08-21T02:00:00.000Z".to_owned(),
        operations: vec![operation(
            "remote-task-copy-second",
            "task",
            &task.id,
            json!({ "id": task.id, "title": "远端副本", "priority": 2 }),
        )],
    };
    apply_batch(&mut connection, &remote_copy).unwrap();
    let second_conflict_id = connection
        .query_row(
            "SELECT id FROM sync_conflicts WHERE resolution IS NULL LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .unwrap();
    drop(connection);
    resolve_conflict_with_payload(&database, &second_conflict_id, "copy", None).unwrap();
    let connection = database.connect().unwrap();
    assert_eq!(
        connection
            .query_row("SELECT COUNT(*) FROM tasks", [], |row| row.get::<_, i64>(0))
            .unwrap(),
        2
    );
    assert_eq!(
        connection
            .query_row(
                "SELECT title FROM tasks WHERE id = ?1",
                rusqlite::params![task.id],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
        "合并任务"
    );
    let copied = connection
        .query_row(
            "SELECT tasks.title, sync_objects.revision
             FROM tasks
             JOIN sync_objects ON sync_objects.entity = 'task'
               AND sync_objects.object_id = tasks.id
             WHERE tasks.id <> ?1",
            rusqlite::params![task.id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        )
        .unwrap();
    assert_eq!(copied, ("远端副本".to_owned(), 1));
    drop(connection);
    drop(database);
    cleanup_database(&path);
}

#[test]
fn webdav_flow_initializes_manifest_uploads_and_verifies_changes() {
    let (address, requests, handle) = spawn_mock_dav(MockDavConfig::default(), 11);
    let client = WebDavClient::new_for_test(address);
    let path = std::env::temp_dir().join(format!(
        "torder-sync-webdav-upload-{}.sqlite",
        uuid::Uuid::new_v4()
    ));
    let database = Database::initialize(path.clone()).unwrap();
    crate::db::task_repository::TaskRepository::new(&database)
        .create(crate::models::CreateTaskInput {
            title: "待上传任务".to_owned(),
            note: None,
            priority: Some(1),
            list_id: Some("work".to_owned()),
            scheduled_date: None,
            due_at: None,
            sort_order: None,
            remind_before: None,
            repeat_rule: None,
            subtasks: None,
            tags: None,
        })
        .unwrap();

    tauri::async_runtime::block_on(run_with_client(&database, &client, "sync")).unwrap();

    let connection = database.connect().unwrap();
    assert_eq!(sync_repository::pending_count(&connection).unwrap(), 0);
    assert_eq!(
        sync_repository::get_state(&connection, "lastRemoteSequence")
            .unwrap()
            .as_deref(),
        Some("1")
    );
    assert_eq!(
        connection
            .query_row(
                "SELECT last_remote_sequence FROM sync_devices WHERE enabled = 1",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
        1
    );
    let requests = requests.lock().unwrap();
    assert!(requests.iter().any(|request| {
        request.method == "PUT"
            && request.path.ends_with("/manifest.json")
            && request.raw_headers.contains("if-none-match: *")
    }));
    assert!(requests.iter().any(|request| {
        request.method == "PUT"
            && request.path.ends_with("/manifest.json")
            && request.raw_headers.contains("if-match: \"v1\"")
    }));
    drop(requests);
    handle.join().unwrap();
    drop(connection);
    drop(database);
    cleanup_database(&path);
}

#[test]
fn encrypted_managed_attachment_uploads_blob_before_metadata_without_plaintext() {
    let _keyring_guard = keyring_test_guard();
    let (config, key) = crypto::create_config("attachment sync password").unwrap();
    let dir = std::env::temp_dir().join(format!(
        "torder-sync-attachment-upload-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let database = Database::initialize(dir.join("torder.sqlite")).unwrap();
    configure_local_encryption(&database, &config, &key);
    let task = crate::db::task_repository::TaskRepository::new(&database)
        .create(crate::models::CreateTaskInput {
            title: "带附件任务".to_owned(),
            note: None,
            priority: Some(1),
            list_id: Some("work".to_owned()),
            scheduled_date: None,
            due_at: None,
            sort_order: None,
            remind_before: None,
            repeat_rule: None,
            subtasks: None,
            tags: None,
        })
        .unwrap();
    let source_path = dir.join("source-secret.txt");
    std::fs::write(&source_path, b"attachment plaintext secret").unwrap();
    let attachment = AttachmentRepository::new(&database)
        .create_managed(
            &dir,
            crate::models::CreateAttachmentInput {
                task_id: task.id,
                source_path: source_path.display().to_string(),
                display_name: Some("secret.txt".to_owned()),
            },
        )
        .unwrap();

    let (address, requests, handle) = spawn_mock_dav(MockDavConfig::default(), 17);
    let client = WebDavClient::new_for_test(address);
    tauri::async_runtime::block_on(run_with_client(&database, &client, "sync")).unwrap();

    let requests = requests.lock().unwrap();
    let blob_put_index = requests
        .iter()
        .position(|request| request.method == "PUT" && request.path.contains("/attachments/blobs/"))
        .unwrap();
    let change_put_index = requests
        .iter()
        .position(|request| request.method == "PUT" && request.path.contains("/changes/"))
        .unwrap();
    assert!(blob_put_index < change_put_index);
    let blob_put = &requests[blob_put_index];
    assert!(!blob_put
        .body
        .windows("attachment plaintext secret".len())
        .any(|window| window == b"attachment plaintext secret"));
    drop(requests);
    handle.join().unwrap();

    let connection = database.connect().unwrap();
    let blob_row: (String, Option<String>) = connection
        .query_row(
            "SELECT sync_state, encryption_key_id FROM attachment_blobs WHERE id = ?1",
            rusqlite::params![attachment.blob_id.unwrap()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(blob_row.0, "uploaded");
    assert_eq!(blob_row.1.as_deref(), Some(config.key_id.as_str()));
    credentials::remove_encryption_keys(&connection).unwrap();
    drop(connection);
    drop(database);
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn remote_attachment_metadata_downloads_blob_to_managed_storage() {
    let dir = std::env::temp_dir().join(format!(
        "torder-sync-attachment-download-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let database = Database::initialize(dir.join("torder.sqlite")).unwrap();
    let payload = b"remote attachment body".to_vec();
    let attachment_payload = json!({
        "id": "remote-attachment-download",
        "taskId": "remote-task-download",
        "kind": "managed",
        "blobId": "remote-blob-download",
        "displayName": "remote.txt",
        "originalName": "remote.txt",
        "contentSha256": sha256_bytes(&payload),
        "sizeBytes": payload.len() as i64,
        "mimeType": "text/plain",
        "remotePath": "attachments/blobs/re/remote-blob-download.bin",
        "sortOrder": 0,
        "deletedAt": null
    });
    let batch = serde_json::to_value(ChangeBatch {
        protocol: PROTOCOL,
        sequence: 1,
        device_id: "remote-device".to_owned(),
        created_at: "2026-08-21T00:00:00.000Z".to_owned(),
        operations: vec![
            operation(
                "remote-task-download-op",
                "task",
                "remote-task-download",
                json!({
                    "id": "remote-task-download",
                    "title": "远端附件任务",
                    "status": "todo",
                    "priority": 1,
                    "listId": "work",
                    "sortOrder": 0,
                    "deletedAt": null
                }),
            ),
            operation(
                "remote-attachment-download-op",
                "attachment",
                "remote-attachment-download",
                attachment_payload,
            ),
        ],
    })
    .unwrap();
    let manifest = json!({
        "protocol": PROTOCOL,
        "collectionId": uuid::Uuid::new_v4().to_string(),
        "format": "torder-sync",
        "schemaVersion": 2,
        "latestSequence": 1,
        "updatedAt": "2026-08-21T00:00:00.000Z"
    });
    let (address, _requests, handle) = spawn_mock_dav(
        MockDavConfig {
            manifest: Some(manifest),
            batch: Some(batch),
            blob: Some(payload.clone()),
            ..MockDavConfig::default()
        },
        9,
    );
    let client = WebDavClient::new_for_test(address);
    tauri::async_runtime::block_on(run_with_client(&database, &client, "sync")).unwrap();

    let local_path = dir.join("attachments/blobs/re/remote-blob-download.bin");
    assert_eq!(std::fs::read(&local_path).unwrap(), payload);
    let connection = database.connect().unwrap();
    assert_eq!(
        connection
            .query_row(
                "SELECT sync_state FROM attachment_blobs WHERE id = 'remote-blob-download'",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
        "downloaded"
    );
    handle.join().unwrap();
    drop(connection);
    drop(database);
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn remote_attachment_hash_mismatch_marks_blob_failed_without_writing_file() {
    let dir = std::env::temp_dir().join(format!(
        "torder-sync-attachment-mismatch-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let database = Database::initialize(dir.join("torder.sqlite")).unwrap();
    let expected = b"expected attachment body".to_vec();
    let wrong = b"wrong attachment body".to_vec();
    let attachment_payload = json!({
        "id": "remote-attachment-mismatch",
        "taskId": "remote-task-mismatch",
        "kind": "managed",
        "blobId": "remote-blob-mismatch",
        "displayName": "remote.txt",
        "contentSha256": sha256_bytes(&expected),
        "sizeBytes": expected.len() as i64,
        "remotePath": "attachments/blobs/re/remote-blob-mismatch.bin",
        "sortOrder": 0,
        "deletedAt": null
    });
    let batch = serde_json::to_value(ChangeBatch {
        protocol: PROTOCOL,
        sequence: 1,
        device_id: "remote-device".to_owned(),
        created_at: "2026-08-21T00:00:00.000Z".to_owned(),
        operations: vec![
            operation(
                "remote-task-mismatch-op",
                "task",
                "remote-task-mismatch",
                json!({
                    "id": "remote-task-mismatch",
                    "title": "远端坏附件任务",
                    "status": "todo",
                    "priority": 1,
                    "listId": "work",
                    "sortOrder": 0,
                    "deletedAt": null
                }),
            ),
            operation(
                "remote-attachment-mismatch-op",
                "attachment",
                "remote-attachment-mismatch",
                attachment_payload,
            ),
        ],
    })
    .unwrap();
    let manifest = json!({
        "protocol": PROTOCOL,
        "collectionId": uuid::Uuid::new_v4().to_string(),
        "format": "torder-sync",
        "schemaVersion": 2,
        "latestSequence": 1,
        "updatedAt": "2026-08-21T00:00:00.000Z"
    });
    let (address, _requests, handle) = spawn_mock_dav(
        MockDavConfig {
            manifest: Some(manifest),
            batch: Some(batch),
            blob: Some(wrong),
            ..MockDavConfig::default()
        },
        9,
    );
    let client = WebDavClient::new_for_test(address);
    tauri::async_runtime::block_on(run_with_client(&database, &client, "sync")).unwrap();

    assert!(!dir
        .join("attachments/blobs/re/remote-blob-mismatch.bin")
        .exists());
    let connection = database.connect().unwrap();
    let row: (String, Option<String>) = connection
        .query_row(
            "SELECT sync_state, last_error FROM attachment_blobs WHERE id = 'remote-blob-mismatch'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(row.0, "failed");
    assert!(row.1.unwrap().contains("integrity mismatch"));
    handle.join().unwrap();
    drop(connection);
    drop(database);
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn remote_device_revocation_updates_manifest_before_local_state() {
    let path = std::env::temp_dir().join(format!(
        "torder-sync-revoke-device-{}.sqlite",
        uuid::Uuid::new_v4()
    ));
    let database = Database::initialize(path.clone()).unwrap();
    let collection_id = uuid::Uuid::new_v4().to_string();
    let manifest = json!({
        "protocol": PROTOCOL,
        "collectionId": collection_id,
        "format": "torder-sync",
        "schemaVersion": 2,
        "latestSequence": 1,
        "snapshotSequence": 0,
        "updatedAt": "2026-08-21T00:00:00.000Z",
        "devices": [
            { "id": "local-device", "name": "本机", "lastSeenAt": "2026-08-21T00:00:00.000Z", "lastSequence": 1, "enabled": true },
            { "id": "remote-device", "name": "手机", "lastSeenAt": "2026-08-21T00:00:00.000Z", "lastSequence": 1, "enabled": true }
        ]
    });
    let connection = database.connect().unwrap();
    sync_repository::set_state(&connection, "deviceId", "local-device").unwrap();
    sync_repository::set_state(
        &connection,
        "remoteConfirmedFor",
        &confirmation_key("http://test", "sync"),
    )
    .unwrap();
    sync_repository::ensure_device(&connection, "local-device", "本机").unwrap();
    sync_repository::ensure_device(&connection, "remote-device", "手机").unwrap();
    let (address, requests, handle) = spawn_mock_dav(
        MockDavConfig {
            manifest: Some(manifest),
            ..MockDavConfig::default()
        },
        3,
    );
    let client = WebDavClient::new_for_test(address);
    tauri::async_runtime::block_on(revoke_remote_device_with_client(
        &database,
        &client,
        "sync",
        "remote-device",
    ))
    .unwrap();
    let requests = requests.lock().unwrap();
    let updated_manifest: Value = requests
        .iter()
        .find(|request| request.method == "PUT" && request.path.ends_with("/manifest.json"))
        .map(|request| serde_json::from_slice(&request.body).unwrap())
        .unwrap();
    assert_eq!(
        updated_manifest["devices"]
            .as_array()
            .unwrap()
            .iter()
            .find(|device| device["id"] == "remote-device")
            .unwrap()["enabled"],
        false
    );
    drop(requests);
    handle.join().unwrap();

    let connection = database.connect().unwrap();
    assert!(!sync_repository::is_device_enabled(&connection, "remote-device").unwrap());
    drop(connection);
    drop(client);
    drop(database);
    cleanup_database(&path);
}

#[test]
fn encrypted_upload_hides_payload_and_rotation_publishes_new_snapshot() {
    let _keyring_guard = keyring_test_guard();
    let (old_config, old_key) = crypto::create_config("old sync password").expect("create old key");
    let path = std::env::temp_dir().join(format!(
        "torder-sync-webdav-encrypted-{}.sqlite",
        uuid::Uuid::new_v4()
    ));
    let database = Database::initialize(path.clone()).unwrap();
    crate::db::task_repository::TaskRepository::new(&database)
        .create(crate::models::CreateTaskInput {
            title: "只有本机可见的任务标题".to_owned(),
            note: Some("敏感备注".to_owned()),
            priority: Some(1),
            list_id: Some("work".to_owned()),
            scheduled_date: None,
            due_at: None,
            sort_order: None,
            remind_before: None,
            repeat_rule: None,
            subtasks: None,
            tags: None,
        })
        .unwrap();
    configure_local_encryption(&database, &old_config, &old_key);

    let (address, requests, handle) = spawn_mock_dav(MockDavConfig::default(), 11);
    let client = WebDavClient::new_for_test(address);
    tauri::async_runtime::block_on(run_with_client(&database, &client, "sync")).unwrap();

    let (manifest_value, uploaded_batch) = {
        let requests = requests.lock().unwrap();
        let manifest = requests
            .iter()
            .rev()
            .find(|request| request.method == "PUT" && request.path.ends_with("/manifest.json"))
            .map(|request| serde_json::from_slice::<Value>(&request.body).unwrap())
            .unwrap();
        let batch = requests
            .iter()
            .find(|request| request.method == "PUT" && request.path.contains("/changes/"))
            .map(|request| serde_json::from_slice::<Value>(&request.body).unwrap())
            .unwrap();
        (manifest, batch)
    };
    let uploaded_json = serde_json::to_string(&uploaded_batch).unwrap();
    assert!(!uploaded_json.contains("只有本机可见的任务标题"));
    assert!(uploaded_batch["operations"][0]["payload"]["$encrypted"].is_object());
    handle.join().unwrap();

    let (new_address, rotation_requests, rotation_handle) = spawn_mock_dav(
        MockDavConfig {
            manifest: Some(manifest_value),
            ..MockDavConfig::default()
        },
        8,
    );
    let rotation_client = WebDavClient::new_for_test(new_address);
    tauri::async_runtime::block_on(rotate_encryption_with_client(
        &database,
        &rotation_client,
        "sync",
        "new sync password",
    ))
    .unwrap();

    let connection = database.connect().unwrap();
    let new_config: EncryptionConfig = serde_json::from_str(
        &sync_repository::get_state(&connection, "encryptionConfig")
            .unwrap()
            .unwrap(),
    )
    .unwrap();
    assert_ne!(new_config.key_id, old_config.key_id);
    assert_eq!(
        sync_repository::get_state(&connection, "lastRemoteSequence")
            .unwrap()
            .as_deref(),
        Some("2")
    );
    assert!(credentials::has_encryption_key(&connection, &new_config.key_id).unwrap());
    let requests = rotation_requests.lock().unwrap();
    let rotated_manifest_value: Value = requests
        .iter()
        .rev()
        .find(|request| request.method == "PUT" && request.path.ends_with("/manifest.json"))
        .map(|request| serde_json::from_slice(&request.body).unwrap())
        .unwrap();
    let rotated_manifest: Manifest =
        serde_json::from_value(rotated_manifest_value.clone()).unwrap();
    assert_eq!(rotated_manifest.latest_sequence, 2);
    assert_eq!(rotated_manifest.snapshot_sequence, 2);
    assert_eq!(rotated_manifest.encryption, Some(new_config.clone()));
    let empty_batch: ChangeBatch = requests
        .iter()
        .find(|request| {
            request.method == "PUT" && request.path.ends_with("/changes/00000000000000000002.json")
        })
        .map(|request| serde_json::from_slice(&request.body).unwrap())
        .unwrap();
    assert!(empty_batch.operations.is_empty());
    let rotated_snapshot = requests
        .iter()
        .find(|request| {
            request.method == "PUT"
                && request
                    .path
                    .ends_with("/snapshots/00000000000000000002.json.gz")
        })
        .map(|request| request.body.clone())
        .unwrap();
    drop(requests);
    rotation_handle.join().unwrap();

    let new_device_path = std::env::temp_dir().join(format!(
        "torder-sync-webdav-new-device-{}.sqlite",
        uuid::Uuid::new_v4()
    ));
    let new_device = Database::initialize(new_device_path.clone()).unwrap();
    let new_device_key = crypto::derive_key(&new_config, "new sync password").unwrap();
    configure_local_encryption(&new_device, &new_config, &new_device_key);
    let (new_device_address, _new_device_requests, new_device_handle) = spawn_mock_dav(
        MockDavConfig {
            manifest: Some(rotated_manifest_value),
            snapshot: Some(rotated_snapshot),
            ..MockDavConfig::default()
        },
        10,
    );
    let new_device_client = WebDavClient::new_for_test(new_device_address);
    tauri::async_runtime::block_on(run_with_client(&new_device, &new_device_client, "sync"))
        .unwrap();
    let new_device_connection = new_device.connect().unwrap();
    assert_eq!(
        new_device_connection
            .query_row(
                "SELECT title FROM tasks WHERE title = '只有本机可见的任务标题'",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
        "只有本机可见的任务标题"
    );
    credentials::remove_encryption_keys(&new_device_connection).unwrap();
    drop(new_device_connection);
    new_device_handle.join().unwrap();
    drop(new_device);
    cleanup_database(&new_device_path);
    credentials::remove_encryption_keys(&connection).unwrap();
    drop(connection);
    drop(database);
    cleanup_database(&path);
}

#[test]
fn encrypted_remote_batch_requires_the_right_key_and_preserves_local_state_on_failure() {
    let _keyring_guard = keyring_test_guard();
    let (config, key) = crypto::create_config("remote sync password").unwrap();
    let encrypted_operation = operation(
        "encrypted-remote-task",
        "task",
        "encrypted-remote-task",
        json!({
            "id": "encrypted-remote-task",
            "title": "远端加密任务",
            "status": "todo",
            "priority": 1,
            "listId": "work",
            "sortOrder": 0,
            "deletedAt": null
        }),
    );
    let context = EncryptionContext {
        config: config.clone(),
        key: key.clone(),
    };
    let mut encrypted_operations = vec![encrypted_operation];
    encrypt_operations(&mut encrypted_operations, Some(&context)).unwrap();
    let batch = serde_json::to_value(ChangeBatch {
        protocol: PROTOCOL,
        sequence: 1,
        device_id: "remote-device".to_owned(),
        created_at: "2026-08-21T00:00:00.000Z".to_owned(),
        operations: encrypted_operations,
    })
    .unwrap();
    let manifest = json!({
        "protocol": PROTOCOL,
        "collectionId": uuid::Uuid::new_v4().to_string(),
        "format": "torder-sync",
        "schemaVersion": 2,
        "latestSequence": 1,
        "updatedAt": "2026-08-21T00:00:00.000Z",
        "encryption": config,
    });

    let correct_path = std::env::temp_dir().join(format!(
        "torder-sync-webdav-encrypted-pull-{}.sqlite",
        uuid::Uuid::new_v4()
    ));
    let correct_database = Database::initialize(correct_path.clone()).unwrap();
    configure_local_encryption(&correct_database, &config, &key);
    let (address, _requests, handle) = spawn_mock_dav(
        MockDavConfig {
            manifest: Some(manifest.clone()),
            batch: Some(batch.clone()),
            ..MockDavConfig::default()
        },
        8,
    );
    let client = WebDavClient::new_for_test(address);
    tauri::async_runtime::block_on(run_with_client(&correct_database, &client, "sync")).unwrap();
    let connection = correct_database.connect().unwrap();
    assert_eq!(
        connection
            .query_row(
                "SELECT title FROM tasks WHERE id = 'encrypted-remote-task'",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
        "远端加密任务"
    );
    credentials::remove_encryption_keys(&connection).unwrap();
    drop(connection);
    handle.join().unwrap();
    drop(correct_database);
    cleanup_database(&correct_path);

    let (_wrong_config, wrong_key) = crypto::create_config("wrong password").unwrap();
    let wrong_path = std::env::temp_dir().join(format!(
        "torder-sync-webdav-encrypted-wrong-{}.sqlite",
        uuid::Uuid::new_v4()
    ));
    let wrong_database = Database::initialize(wrong_path.clone()).unwrap();
    configure_local_encryption(&wrong_database, &config, &wrong_key);
    let (wrong_address, _wrong_requests, wrong_handle) = spawn_mock_dav(
        MockDavConfig {
            manifest: Some(manifest),
            batch: Some(batch),
            ..MockDavConfig::default()
        },
        6,
    );
    let wrong_client = WebDavClient::new_for_test(wrong_address);
    let error =
        tauri::async_runtime::block_on(run_with_client(&wrong_database, &wrong_client, "sync"))
            .unwrap_err()
            .to_string();
    assert!(
        error.contains("incorrect") || error.contains("damaged"),
        "{error}"
    );
    let connection = wrong_database.connect().unwrap();
    assert_eq!(
        connection
            .query_row(
                "SELECT COUNT(*) FROM tasks WHERE id = 'encrypted-remote-task'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
        0
    );
    assert!(
        sync_repository::get_state(&connection, "lastRemoteSequence")
            .unwrap()
            .is_none()
    );
    credentials::remove_encryption_keys(&connection).unwrap();
    drop(connection);
    wrong_handle.join().unwrap();
    drop(wrong_database);
    cleanup_database(&wrong_path);
}

#[test]
fn plaintext_collection_can_be_migrated_to_encryption_by_rotation() {
    let _keyring_guard = keyring_test_guard();
    let path = std::env::temp_dir().join(format!(
        "torder-sync-webdav-plaintext-migration-{}.sqlite",
        uuid::Uuid::new_v4()
    ));
    let database = Database::initialize(path.clone()).unwrap();
    let (address, requests, handle) = spawn_mock_dav(
        MockDavConfig {
            manifest: Some(empty_manifest()),
            ..MockDavConfig::default()
        },
        7,
    );
    let client = WebDavClient::new_for_test(address);
    tauri::async_runtime::block_on(rotate_encryption_with_client(
        &database,
        &client,
        "sync",
        "migrate sync password",
    ))
    .unwrap();
    let connection = database.connect().unwrap();
    let config: EncryptionConfig = serde_json::from_str(
        &sync_repository::get_state(&connection, "encryptionConfig")
            .unwrap()
            .unwrap(),
    )
    .unwrap();
    assert!(credentials::has_encryption_key(&connection, &config.key_id).unwrap());
    let manifest: Manifest = requests
        .lock()
        .unwrap()
        .iter()
        .rev()
        .find(|request| request.method == "PUT" && request.path.ends_with("/manifest.json"))
        .map(|request| serde_json::from_slice(&request.body).unwrap())
        .unwrap();
    assert_eq!(manifest.encryption, Some(config));
    credentials::remove_encryption_keys(&connection).unwrap();
    drop(connection);
    handle.join().unwrap();
    drop(database);
    cleanup_database(&path);
}

#[test]
fn encrypted_snapshot_restores_business_objects_without_remote_plaintext() {
    let _keyring_guard = keyring_test_guard();
    let (config, key) = crypto::create_config("snapshot sync password").unwrap();
    let mut snapshot_operation = operation(
        "snapshot-1-0",
        "task",
        "encrypted-snapshot-task",
        json!({
            "id": "encrypted-snapshot-task",
            "title": "只存在于加密快照",
            "status": "todo",
            "priority": 1,
            "listId": "work",
            "sortOrder": 0,
            "deletedAt": null
        }),
    );
    let context = EncryptionContext {
        config: config.clone(),
        key: key.clone(),
    };
    encrypt_operations(
        std::slice::from_mut(&mut snapshot_operation),
        Some(&context),
    )
    .unwrap();
    let snapshot = Snapshot {
        protocol: PROTOCOL,
        sequence: 1,
        created_at: "2026-08-21T00:00:00.000Z".to_owned(),
        operations: vec![snapshot_operation],
    };
    let encoded_snapshot = encode_snapshot(&snapshot).unwrap();
    assert!(!String::from_utf8_lossy(&encoded_snapshot).contains("只存在于加密快照"));
    let manifest = json!({
        "protocol": PROTOCOL,
        "collectionId": uuid::Uuid::new_v4().to_string(),
        "format": "torder-sync",
        "schemaVersion": 2,
        "latestSequence": 1,
        "snapshotSequence": 1,
        "updatedAt": "2026-08-21T00:00:00.000Z",
        "encryption": config,
    });
    let path = std::env::temp_dir().join(format!(
        "torder-sync-webdav-encrypted-snapshot-{}.sqlite",
        uuid::Uuid::new_v4()
    ));
    let database = Database::initialize(path.clone()).unwrap();
    configure_local_encryption(&database, &config, &key);
    let (address, _requests, handle) = spawn_mock_dav(
        MockDavConfig {
            manifest: Some(manifest),
            snapshot: Some(encoded_snapshot),
            ..MockDavConfig::default()
        },
        9,
    );
    let client = WebDavClient::new_for_test(address);
    tauri::async_runtime::block_on(run_with_client(&database, &client, "sync")).unwrap();
    let connection = database.connect().unwrap();
    assert_eq!(
        connection
            .query_row(
                "SELECT title FROM tasks WHERE id = 'encrypted-snapshot-task'",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
        "只存在于加密快照"
    );
    credentials::remove_encryption_keys(&connection).unwrap();
    drop(connection);
    handle.join().unwrap();
    drop(database);
    cleanup_database(&path);
}

#[test]
fn webdav_flow_pulls_remote_batch_before_finishing() {
    let collection_id = uuid::Uuid::new_v4().to_string();
    let manifest = json!({
        "protocol": PROTOCOL,
        "collectionId": collection_id,
        "format": "torder-sync",
        "schemaVersion": 2,
        "latestSequence": 1,
        "updatedAt": "2026-08-21T00:00:00.000Z"
    });
    let batch = serde_json::to_value(ChangeBatch {
        protocol: PROTOCOL,
        sequence: 1,
        device_id: "remote-device".to_owned(),
        created_at: "2026-08-21T00:00:00.000Z".to_owned(),
        operations: vec![operation(
            "remote-list-change",
            "list",
            "remote-list",
            json!({
                "id": "remote-list",
                "name": "远端同步清单",
                "color": "#123456",
                "sortOrder": 0,
                "isDefault": false,
                "deletedAt": null
            }),
        )],
    })
    .unwrap();
    let config = MockDavConfig {
        manifest: Some(manifest),
        batch: Some(batch),
        ..MockDavConfig::default()
    };
    let (address, requests, handle) = spawn_mock_dav(config, 8);
    let client = WebDavClient::new_for_test(address);
    let path = std::env::temp_dir().join(format!(
        "torder-sync-webdav-pull-{}.sqlite",
        uuid::Uuid::new_v4()
    ));
    let database = Database::initialize(path.clone()).unwrap();

    tauri::async_runtime::block_on(run_with_client(&database, &client, "sync")).unwrap();

    let connection = database.connect().unwrap();
    assert_eq!(
        connection
            .query_row(
                "SELECT name FROM lists WHERE id = 'remote-list'",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
        "远端同步清单"
    );
    assert_eq!(
        sync_repository::get_state(&connection, "lastRemoteSequence")
            .unwrap()
            .as_deref(),
        Some("1")
    );
    let devices = sync_repository::list_devices(&connection).unwrap();
    assert!(devices
        .iter()
        .any(|device| device.current && device.enabled));
    assert!(devices.iter().any(|device| {
        device.id == "remote-device" && device.enabled && device.last_remote_sequence == 1
    }));
    sync_repository::revoke_device(&connection, "remote-device").unwrap();
    assert!(!sync_repository::is_device_enabled(&connection, "remote-device").unwrap());
    let current_device = devices.iter().find(|device| device.current).unwrap();
    assert!(sync_repository::revoke_device(&connection, &current_device.id).is_err());
    let requests = requests.lock().unwrap();
    let manifest_update = requests
        .iter()
        .rev()
        .find(|request| request.method == "PUT" && request.path.ends_with("/manifest.json"))
        .unwrap();
    let manifest: Manifest = serde_json::from_slice(&manifest_update.body).unwrap();
    assert!(manifest
        .devices
        .iter()
        .any(|device| device.id == current_device.id && device.enabled));
    assert!(manifest
        .devices
        .iter()
        .any(|device| device.id == "remote-device" && device.enabled));
    drop(requests);
    handle.join().unwrap();
    drop(connection);
    drop(database);
    cleanup_database(&path);
}

#[test]
fn webdav_flow_restores_compressed_snapshot_before_pruned_history() {
    let snapshot = Snapshot {
        protocol: PROTOCOL,
        sequence: 1,
        created_at: "2026-08-21T00:00:00.000Z".to_owned(),
        operations: vec![operation(
            "snapshot-1-0",
            "task",
            "snapshot-task",
            json!({
                "id": "snapshot-task",
                "title": "来自压缩快照",
                "status": "todo",
                "priority": 1,
                "listId": "work",
                "sortOrder": 0,
                "deletedAt": null
            }),
        )],
    };
    let manifest = json!({
        "protocol": PROTOCOL,
        "collectionId": uuid::Uuid::new_v4().to_string(),
        "format": "torder-sync",
        "schemaVersion": 2,
        "latestSequence": 1,
        "snapshotSequence": 1,
        "updatedAt": "2026-08-21T00:00:00.000Z"
    });
    let config = MockDavConfig {
        manifest: Some(manifest),
        snapshot: Some(encode_snapshot(&snapshot).unwrap()),
        ..MockDavConfig::default()
    };
    let (address, requests, handle) = spawn_mock_dav(config, 9);
    let client = WebDavClient::new_for_test(address);
    let path = std::env::temp_dir().join(format!(
        "torder-sync-webdav-snapshot-{}.sqlite",
        uuid::Uuid::new_v4()
    ));
    let database = Database::initialize(path.clone()).unwrap();

    tauri::async_runtime::block_on(run_with_client(&database, &client, "sync")).unwrap();

    let connection = database.connect().unwrap();
    assert_eq!(
        connection
            .query_row(
                "SELECT title FROM tasks WHERE id = 'snapshot-task'",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
        "来自压缩快照"
    );
    assert_eq!(
        sync_repository::get_state(&connection, "lastRemoteSequence")
            .unwrap()
            .as_deref(),
        Some("1")
    );
    let requests = requests.lock().unwrap();
    assert!(requests.iter().any(|request| {
        request.method == "GET"
            && request
                .path
                .ends_with("/snapshots/00000000000000000001.json.gz")
    }));
    assert!(requests.iter().any(|request| {
        request.method == "DELETE" && request.path.ends_with("/changes/00000000000000000001.json")
    }));
    drop(requests);
    handle.join().unwrap();
    drop(connection);
    drop(database);
    cleanup_database(&path);
}

#[test]
fn webdav_manifest_revocation_blocks_the_current_device() {
    let manifest = json!({
        "protocol": PROTOCOL,
        "collectionId": uuid::Uuid::new_v4().to_string(),
        "format": "torder-sync",
        "schemaVersion": 2,
        "latestSequence": 0,
        "updatedAt": "2026-08-21T00:00:00.000Z",
        "devices": [{
            "id": "local-device",
            "name": "已撤销设备",
            "lastSeenAt": "2026-08-21T00:00:00.000Z",
            "enabled": false
        }]
    });
    let config = MockDavConfig {
        manifest: Some(manifest),
        ..MockDavConfig::default()
    };
    let (address, _requests, handle) = spawn_mock_dav(config, 5);
    let client = WebDavClient::new_for_test(address);
    let path = std::env::temp_dir().join(format!(
        "torder-sync-webdav-revoked-{}.sqlite",
        uuid::Uuid::new_v4()
    ));
    let database = Database::initialize(path.clone()).unwrap();
    sync_repository::set_state(&database.connect().unwrap(), "deviceId", "local-device").unwrap();

    let error = tauri::async_runtime::block_on(run_with_client(&database, &client, "sync"))
        .unwrap_err()
        .to_string();

    assert!(error.contains("revoked"), "{error}");
    handle.join().unwrap();
    drop(database);
    cleanup_database(&path);
}

#[test]
fn webdav_flow_generates_occurrence_after_pulling_recurring_rule() {
    let manifest = json!({
        "protocol": PROTOCOL,
        "collectionId": uuid::Uuid::new_v4().to_string(),
        "format": "torder-sync",
        "schemaVersion": 2,
        "latestSequence": 1,
        "updatedAt": "2026-08-21T00:00:00.000Z"
    });
    let batch = serde_json::to_value(ChangeBatch {
        protocol: PROTOCOL,
        sequence: 1,
        device_id: "remote-device".to_owned(),
        created_at: "2026-08-21T00:00:00.000Z".to_owned(),
        operations: vec![operation(
            "remote-rule-change",
            "recurringRule",
            "remote-rule",
            json!({
                "id": "remote-rule",
                "title": "远端到期循环任务",
                "priority": 1,
                "listId": "work",
                "frequency": "daily",
                "intervalCount": 1,
                "weekdays": [],
                "monthDay": null,
                "firstDueAt": "2026-08-20T09:00:00Z",
                "nextDueAt": "2026-08-20T09:00:00Z",
                "timezone": "UTC",
                "generateAheadMinutes": 0,
                "remindBefore": null,
                "endAt": null,
                "enabled": true,
                "deletedAt": null
            }),
        )],
    })
    .unwrap();
    let config = MockDavConfig {
        manifest: Some(manifest),
        batch: Some(batch),
        ..MockDavConfig::default()
    };
    let (address, _requests, handle) = spawn_mock_dav(config, 10);
    let client = WebDavClient::new_for_test(address);
    let path = std::env::temp_dir().join(format!(
        "torder-sync-webdav-recurring-{}.sqlite",
        uuid::Uuid::new_v4()
    ));
    let database = Database::initialize(path.clone()).unwrap();

    tauri::async_runtime::block_on(run_with_client(&database, &client, "sync")).unwrap();

    let connection = database.connect().unwrap();
    assert_eq!(
        connection
            .query_row(
                "SELECT COUNT(*) FROM tasks WHERE recurring_rule_id = 'remote-rule'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
        1
    );
    assert_eq!(sync_repository::pending_count(&connection).unwrap(), 0);
    assert_eq!(
        sync_repository::get_state(&connection, "lastRemoteSequence")
            .unwrap()
            .as_deref(),
        Some("2")
    );
    handle.join().unwrap();
    drop(connection);
    drop(database);
    cleanup_database(&path);
}

#[test]
fn webdav_manifest_conflict_keeps_local_changes_pending() {
    let config = MockDavConfig {
        manifest: Some(empty_manifest()),
        fail_manifest_update: true,
        ..MockDavConfig::default()
    };
    let (address, _requests, handle) = spawn_mock_dav(config, 7);
    let client = WebDavClient::new_for_test(address);
    let path = std::env::temp_dir().join(format!(
        "torder-sync-webdav-conflict-{}.sqlite",
        uuid::Uuid::new_v4()
    ));
    let database = Database::initialize(path.clone()).unwrap();
    create_pending_task(&database);

    let result = tauri::async_runtime::block_on(run_with_client(&database, &client, "sync"));

    assert!(result
        .unwrap_err()
        .to_string()
        .contains("remote manifest changed"));
    assert_eq!(
        sync_repository::pending_count(&database.connect().unwrap()).unwrap(),
        1
    );
    handle.join().unwrap();
    drop(database);
    cleanup_database(&path);
}

#[test]
fn webdav_verification_failure_keeps_local_changes_pending() {
    let config = MockDavConfig {
        manifest: Some(empty_manifest()),
        corrupt_batch_read: true,
        ..MockDavConfig::default()
    };
    let (address, _requests, handle) = spawn_mock_dav(config, 9);
    let client = WebDavClient::new_for_test(address);
    let path = std::env::temp_dir().join(format!(
        "torder-sync-webdav-verify-{}.sqlite",
        uuid::Uuid::new_v4()
    ));
    let database = Database::initialize(path.clone()).unwrap();
    create_pending_task(&database);

    let result = tauri::async_runtime::block_on(run_with_client(&database, &client, "sync"));

    let error = result.unwrap_err().to_string();
    assert!(
        error.contains("remote write verification failed"),
        "{error}"
    );
    assert_eq!(
        sync_repository::pending_count(&database.connect().unwrap()).unwrap(),
        1
    );
    handle.join().unwrap();
    drop(database);
    cleanup_database(&path);
}

#[test]
fn soft_lock_reclaims_expired_lock_and_rejects_active_lock() {
    let expired_config = MockDavConfig {
        lock_payload: Some(json!({
            "deviceId": "other-device",
            "expiresAt": "2020-01-01T00:00:00Z"
        })),
        ..MockDavConfig::default()
    };
    let (address, requests, handle) = spawn_mock_dav(expired_config, 4);
    let client = WebDavClient::new_for_test(address);
    tauri::async_runtime::block_on(acquire_soft_lock(
        &client,
        "sync/locks/sync.lock",
        "local-device",
    ))
    .unwrap();
    let methods = requests
        .lock()
        .unwrap()
        .iter()
        .map(|request| request.method.clone())
        .collect::<Vec<_>>();
    // 软锁不再只靠 If-None-Match（部分服务端会忽略它直接覆盖），先 PROPFIND 探存在性
    assert_eq!(methods, vec!["PROPFIND", "GET", "DELETE", "PUT"]);
    handle.join().unwrap();

    let active_config = MockDavConfig {
        lock_payload: Some(json!({
            "deviceId": "other-device",
            "expiresAt": "2999-01-01T00:00:00Z"
        })),
        ..MockDavConfig::default()
    };
    let (address, _requests, handle) = spawn_mock_dav(active_config, 2);
    let client = WebDavClient::new_for_test(address);
    let error = tauri::async_runtime::block_on(acquire_soft_lock(
        &client,
        "sync/locks/sync.lock",
        "local-device",
    ))
    .unwrap_err()
    .to_string();
    assert!(error.contains("remote sync lock is held"));
    handle.join().unwrap();
}

#[test]
fn manifest_without_etag_is_guarded_by_soft_lock() {
    let initial_manifest = empty_manifest();
    let config = MockDavConfig {
        manifest: Some(initial_manifest.clone()),
        manifest_without_etag: true,
        ..MockDavConfig::default()
    };
    let (address, requests, handle) = spawn_mock_dav(config, 6);
    let client = WebDavClient::new_for_test(address);
    let manifest: Manifest = serde_json::from_value(initial_manifest).unwrap();
    tauri::async_runtime::block_on(put_manifest(
        &client,
        "sync/manifest.json",
        &manifest,
        None,
        0,
        "local-device",
    ))
    .unwrap();
    let requests = requests.lock().unwrap();
    assert_eq!(requests[0].method, "PROPFIND");
    assert!(requests[0].path.contains("/locks/sync.lock"));
    assert_eq!(requests[1].method, "PUT");
    assert!(requests[1].path.contains("/locks/sync.lock"));
    assert_eq!(requests[2].method, "GET");
    assert_eq!(requests[3].method, "PUT");
    assert_eq!(requests[4].method, "DELETE");
    assert_eq!(requests[5].method, "GET");
    drop(requests);
    handle.join().unwrap();
}

#[test]
fn history_cleanup_requires_age_and_all_active_devices_acknowledgement() {
    let path = std::env::temp_dir().join(format!(
        "torder-sync-cleanup-{}.sqlite",
        uuid::Uuid::new_v4()
    ));
    let database = Database::initialize(path.clone()).unwrap();
    let connection = database.connect().unwrap();
    sync_repository::ensure_device(&connection, "local-device", "本机").unwrap();
    sync_repository::update_device_sync(
        &connection,
        "local-device",
        "2026-08-21T00:00:00.000Z",
        10,
    )
    .unwrap();
    sync_repository::ensure_device(&connection, "lagging-device", "旧设备").unwrap();
    sync_repository::update_device_sync(
        &connection,
        "lagging-device",
        "2026-08-21T00:00:00.000Z",
        9,
    )
    .unwrap();
    connection
        .execute(
            "INSERT INTO sync_changes (id, entity, object_id, operation, base_revision, revision, payload_json, created_at, uploaded_at, remote_sequence) VALUES ('old-change', 'task', 'old-task', 'delete', 1, 2, '{}', '2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z', 10)",
            [],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO sync_objects (entity, object_id, revision, last_changed_at, deleted_at) VALUES ('task', 'old-task', 2, '2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
    let blocked = sync_repository::prune_history(&connection).unwrap();
    assert_eq!(blocked.changes_removed, 0);
    assert_eq!(blocked.tombstones_removed, 0);
    sync_repository::update_device_sync(
        &connection,
        "lagging-device",
        "2026-08-21T00:00:00.000Z",
        10,
    )
    .unwrap();
    let result = sync_repository::prune_history(&connection).unwrap();
    assert_eq!(result.changes_removed, 1);
    assert_eq!(result.tombstones_removed, 1);
    assert_eq!(
        connection
            .query_row(
                "SELECT COUNT(*) FROM sync_changes WHERE id = 'old-change'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
        0
    );

    drop(connection);
    drop(database);
    cleanup_database(&path);
}

#[test]
fn compressed_snapshot_round_trips_and_restores_business_state() {
    let source_path = std::env::temp_dir().join(format!(
        "torder-sync-snapshot-source-{}.sqlite",
        uuid::Uuid::new_v4()
    ));
    let source = Database::initialize(source_path.clone()).unwrap();
    crate::db::task_repository::TaskRepository::new(&source)
        .create(crate::models::CreateTaskInput {
            title: "快照任务".to_owned(),
            note: Some("不会包含凭据".to_owned()),
            priority: Some(2),
            list_id: Some("work".to_owned()),
            scheduled_date: None,
            due_at: None,
            sort_order: None,
            remind_before: None,
            repeat_rule: None,
            subtasks: None,
            tags: None,
        })
        .unwrap();
    let mut source_connection = source.connect().unwrap();
    let mut snapshot = build_snapshot(&mut source_connection, 7).unwrap();
    snapshot.created_at = "2026-08-21T00:00:00.000Z".to_owned();
    let encoded = encode_snapshot(&snapshot).unwrap();
    assert_eq!(encoded, encode_snapshot(&snapshot).unwrap());
    let decoded = decode_snapshot(&encoded).unwrap();
    assert_eq!(decoded.sequence, 7);
    assert_eq!(decoded.operations.len(), 1);

    let target_path = std::env::temp_dir().join(format!(
        "torder-sync-snapshot-target-{}.sqlite",
        uuid::Uuid::new_v4()
    ));
    let target = Database::initialize(target_path.clone()).unwrap();
    let mut target_connection = target.connect().unwrap();
    apply_snapshot(&mut target_connection, &decoded).unwrap();
    assert_eq!(
        target_connection
            .query_row(
                "SELECT title FROM tasks WHERE title = '快照任务'",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
        "快照任务"
    );
    let mut repeated_snapshot = decoded.clone();
    repeated_snapshot.sequence = 8;
    repeated_snapshot.operations[0].id = "snapshot-8-0".to_owned();
    apply_snapshot(&mut target_connection, &repeated_snapshot).unwrap();
    assert_eq!(
        target_connection
            .query_row(
                "SELECT COUNT(*) FROM sync_conflicts WHERE resolved_at IS NULL",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
    assert!(decode_snapshot(b"not-gzip").is_err());

    drop(source_connection);
    drop(target_connection);
    drop(source);
    drop(target);
    cleanup_database(&source_path);
    cleanup_database(&target_path);
}

#[test]
fn remote_history_cleanup_waits_for_every_enabled_device_ack() {
    let manifest = Manifest {
        protocol: PROTOCOL,
        collection_id: uuid::Uuid::new_v4().to_string(),
        format: "torder-sync".to_owned(),
        schema_version: 2,
        latest_sequence: 2,
        snapshot_sequence: 2,
        updated_at: "2026-08-21T00:00:00.000Z".to_owned(),
        encryption: None,
        devices: vec![ManifestDevice {
            id: "device-a".to_owned(),
            name: "设备 A".to_owned(),
            last_seen_at: "2026-08-21T00:00:00.000Z".to_owned(),
            last_sequence: 1,
            enabled: true,
        }],
    };
    let (address, requests, handle) = spawn_mock_dav(MockDavConfig::default(), 2);
    let client = WebDavClient::new_for_test(address);
    assert_eq!(
        tauri::async_runtime::block_on(cleanup_remote_history(&client, "sync", &manifest, 0))
            .unwrap(),
        None
    );
    let mut acknowledged = manifest;
    acknowledged.devices[0].last_sequence = 2;
    assert_eq!(
        tauri::async_runtime::block_on(cleanup_remote_history(&client, "sync", &acknowledged, 0,))
            .unwrap(),
        Some(2)
    );
    let requests = requests.lock().unwrap();
    assert_eq!(requests.len(), 2);
    assert!(requests
        .iter()
        .all(|request| request.method == "DELETE" && request.path.contains("/changes/")));
    drop(requests);
    handle.join().unwrap();
}

#[test]
fn remote_attachment_cleanup_waits_for_every_enabled_device_ack() {
    let path = std::env::temp_dir().join(format!(
        "torder-sync-attachment-cleanup-{}.sqlite",
        uuid::Uuid::new_v4()
    ));
    let database = Database::initialize(path.clone()).unwrap();
    let connection = database.connect().unwrap();
    connection
        .execute(
            "INSERT INTO tasks (id, title, status, priority, list_id, sort_order) VALUES ('task-1', '附件任务', 'todo', 1, 'work', 0)",
            [],
        )
        .unwrap();
    connection
        .execute(
            r#"
            INSERT INTO attachment_blobs (
                id, content_sha256, size_bytes, local_relative_path,
                remote_path, sync_state, created_at, updated_at
            ) VALUES (
                'blob-1',
                'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                8,
                'attachments/blobs/bl/blob-1.bin',
                'attachments/blobs/bl/blob-1.bin',
                'uploaded',
                '2020-01-01T00:00:00.000Z',
                '2020-01-01T00:00:00.000Z'
            )
            "#,
            [],
        )
        .unwrap();
    connection
        .execute(
            r#"
            INSERT INTO task_attachments (
                id, task_id, kind, blob_id, display_name,
                created_at, updated_at, deleted_at
            ) VALUES (
                'attachment-1',
                'task-1',
                'managed',
                'blob-1',
                '合同.pdf',
                '2020-01-01T00:00:00.000Z',
                '2020-01-01T00:00:00.000Z',
                '2020-01-01T00:00:00.000Z'
            )
            "#,
            [],
        )
        .unwrap();
    connection
        .execute(
            r#"
            INSERT INTO sync_changes (
                id, entity, object_id, operation, base_revision, revision,
                payload_json, created_at, uploaded_at, remote_sequence
            ) VALUES (
                'change-1',
                'attachment',
                'attachment-1',
                'delete',
                1,
                2,
                '{}',
                '2020-01-01T00:00:00.000Z',
                '2020-01-01T00:00:00.000Z',
                10
            )
            "#,
            [],
        )
        .unwrap();

    let mut manifest = Manifest {
        protocol: PROTOCOL,
        collection_id: uuid::Uuid::new_v4().to_string(),
        format: "torder-sync".to_owned(),
        schema_version: 2,
        latest_sequence: 10,
        snapshot_sequence: 0,
        updated_at: "2026-08-21T00:00:00.000Z".to_owned(),
        encryption: None,
        devices: vec![
            ManifestDevice {
                id: "device-a".to_owned(),
                name: "设备 A".to_owned(),
                last_seen_at: "2026-08-21T00:00:00.000Z".to_owned(),
                last_sequence: 9,
                enabled: true,
            },
            ManifestDevice {
                id: "device-disabled".to_owned(),
                name: "停用设备".to_owned(),
                last_seen_at: "2026-08-21T00:00:00.000Z".to_owned(),
                last_sequence: 0,
                enabled: false,
            },
        ],
    };
    assert!(remote_attachment_cleanup_candidates(&connection, &manifest)
        .unwrap()
        .is_empty());
    manifest.devices[0].last_sequence = 10;
    let candidates = remote_attachment_cleanup_candidates(&connection, &manifest).unwrap();
    assert_eq!(candidates.len(), 1);
    assert_eq!(candidates[0].remote_path, "attachments/blobs/bl/blob-1.bin");
    drop(connection);

    let (address, requests, handle) = spawn_mock_dav(
        MockDavConfig {
            blob: Some(b"old body".to_vec()),
            ..MockDavConfig::default()
        },
        1,
    );
    let client = WebDavClient::new_for_test(address);
    let removed = tauri::async_runtime::block_on(cleanup_remote_attachment_blobs(
        &database, &client, "sync", &manifest,
    ))
    .unwrap();
    assert_eq!(removed, 1);
    let requests = requests.lock().unwrap();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].method, "DELETE");
    assert!(requests[0]
        .path
        .contains("/sync/attachments/blobs/bl/blob-1.bin"));
    drop(requests);
    handle.join().unwrap();
    drop(database);
    cleanup_database(&path);
}

#[test]
fn bootstrap_tracks_existing_objects_once_without_default_list_noise() {
    let path = std::env::temp_dir().join(format!(
        "torder-sync-bootstrap-{}.sqlite",
        uuid::Uuid::new_v4()
    ));
    let database = Database::initialize(path.clone()).unwrap();
    let mut connection = database.connect().unwrap();
    connection
        .execute(
            "INSERT INTO lists (id, name, color, sort_order, is_default) VALUES ('legacy-list', '旧清单', '#123456', 4, 0)",
            [],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO tasks (id, title, status, priority, list_id, sort_order) VALUES ('legacy-task', '升级前任务', 'todo', 1, 'legacy-list', 0)",
            [],
        )
        .unwrap();

    bootstrap_existing_objects(&mut connection).unwrap();
    bootstrap_existing_objects(&mut connection).unwrap();

    assert_eq!(sync_repository::pending_count(&connection).unwrap(), 2);
    assert_eq!(
        connection
            .query_row(
                "SELECT COUNT(*) FROM sync_objects WHERE entity = 'list' AND object_id IN ('work', 'personal', 'study')",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
        0
    );
    let list_change = sync_repository::list_pending(&connection, 10)
        .unwrap()
        .into_iter()
        .find(|change| change.object_id == "legacy-list")
        .unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&list_change.payload_json)
            .unwrap()
            .get("isDefault"),
        Some(&Value::Bool(false))
    );

    drop(connection);
    drop(database);
    cleanup_database(&path);
}

fn empty_manifest() -> Value {
    json!({
        "protocol": PROTOCOL,
        "collectionId": uuid::Uuid::new_v4().to_string(),
        "format": "torder-sync",
        "schemaVersion": 2,
        "latestSequence": 0,
        "updatedAt": "2026-08-21T00:00:00.000Z"
    })
}

/// 老客户端建立的集合：protocol / schemaVersion 都是 1。
#[test]
fn legacy_protocol_v1_collection_syncs_and_is_upgraded_in_place() {
    let collection_id = uuid::Uuid::new_v4().to_string();
    let manifest = json!({
        "protocol": 1,
        "collectionId": collection_id,
        "format": "torder-sync",
        "schemaVersion": 1,
        "latestSequence": 1,
        "updatedAt": "2026-08-24T12:16:15.344Z"
    });
    let batch = json!({
        "protocol": 1,
        "sequence": 1,
        "deviceId": "legacy-windows",
        "createdAt": "2026-08-24T05:18:15.171Z",
        "operations": [{
            "id": "legacy-list-change",
            "entity": "list",
            "objectId": "legacy-list",
            "operation": "upsert",
            "baseRevision": 0,
            "revision": 1,
            "changedAt": "2026-08-24T05:18:15.171Z",
            "payload": {
                "id": "legacy-list",
                "name": "老协议清单",
                "color": "#123456",
                "sortOrder": 0,
                "isDefault": false,
                "deletedAt": null
            }
        }]
    });
    let config = MockDavConfig {
        manifest: Some(manifest),
        batch: Some(batch),
        ..MockDavConfig::default()
    };
    let (address, requests, handle) = spawn_mock_dav(config, 8);
    let client = WebDavClient::new_for_test(address);
    let path = std::env::temp_dir().join(format!(
        "torder-sync-legacy-v1-{}.sqlite",
        uuid::Uuid::new_v4()
    ));
    let database = Database::initialize(path.clone()).unwrap();

    tauri::async_runtime::block_on(run_with_client(&database, &client, "sync")).unwrap();

    let connection = database.connect().unwrap();
    assert_eq!(
        connection
            .query_row(
                "SELECT name FROM lists WHERE id = 'legacy-list'",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
        "老协议清单",
        "v1 集合的历史变更必须能被当前客户端拉下来"
    );
    let requests = requests.lock().unwrap();
    let upgraded: Manifest = serde_json::from_slice(
        &requests
            .iter()
            .rev()
            .find(|request| request.method == "PUT" && request.path.ends_with("/manifest.json"))
            .expect("manifest was rewritten")
            .body,
    )
    .unwrap();
    assert_eq!(upgraded.protocol, PROTOCOL, "写回时应就地升级 protocol");
    assert_eq!(upgraded.schema_version, 2, "写回时应就地升级 schemaVersion");
    assert_eq!(upgraded.collection_id, collection_id);
    drop(requests);
    handle.join().unwrap();
    drop(connection);
    drop(database);
    cleanup_database(&path);
}

fn create_pending_task(database: &Database) {
    crate::db::task_repository::TaskRepository::new(database)
        .create(crate::models::CreateTaskInput {
            title: "待同步任务".to_owned(),
            note: None,
            priority: Some(1),
            list_id: Some("work".to_owned()),
            scheduled_date: None,
            due_at: None,
            sort_order: None,
            remind_before: None,
            repeat_rule: None,
            subtasks: None,
            tags: None,
        })
        .unwrap();
}

fn configure_local_encryption(
    database: &Database,
    config: &EncryptionConfig,
    key: &crypto::EncryptionKey,
) {
    let connection = database.connect().unwrap();
    sync_repository::set_state(
        &connection,
        "encryptionConfig",
        &serde_json::to_string(config).unwrap(),
    )
    .unwrap();
    let mut stored = crypto::StoredKeys::default();
    crypto::add_stored_key(&mut stored, &config.key_id, key, true);
    credentials::store_encryption_keys(&connection, &stored).unwrap();
}

#[derive(Default)]
struct MockDavConfig {
    manifest: Option<Value>,
    batch: Option<Value>,
    snapshot: Option<Vec<u8>>,
    blob: Option<Vec<u8>>,
    fail_manifest_update: bool,
    corrupt_batch_read: bool,
    manifest_without_etag: bool,
    lock_payload: Option<Value>,
}

#[derive(Debug)]
struct MockRequest {
    method: String,
    path: String,
    raw_headers: String,
    body: Vec<u8>,
}

struct MockResponse {
    status: u16,
    body: Vec<u8>,
    etag: Option<&'static str>,
}

fn spawn_mock_dav(
    config: MockDavConfig,
    expected_requests: usize,
) -> (SocketAddr, Arc<Mutex<Vec<MockRequest>>>, JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let requests = Arc::new(Mutex::new(Vec::new()));
    let captured = Arc::clone(&requests);
    let handle = std::thread::spawn(move || {
        let mut manifest = config.manifest;
        let mut batch = config.batch;
        let mut snapshot = config.snapshot;
        let mut blob = config.blob;
        let mut lock_payload = config.lock_payload;
        let mut manifest_version = if manifest.is_some() { 1 } else { 0 };
        // create-only 写入会先发 PROPFIND 探存在性，实际请求数比 expected_requests 多，
        // 所以把它当下限：先服务够下限，之后空闲一段时间再收摊，避免多一个请求就挂死。
        let mut existing_paths = std::collections::BTreeSet::<String>::new();
        if let Some(sequence) = batch
            .as_ref()
            .and_then(|value| value.get("sequence"))
            .and_then(Value::as_i64)
        {
            existing_paths.insert(format!("{sequence:020}.json"));
        }
        if snapshot.is_some() {
            if let Some(sequence) = manifest
                .as_ref()
                .and_then(|value| value.get("snapshotSequence"))
                .and_then(Value::as_i64)
            {
                existing_paths.insert(format!("{sequence:020}.json.gz"));
            }
        }
        listener.set_nonblocking(true).unwrap();
        let mut served = 0_usize;
        let mut last_activity = std::time::Instant::now();
        loop {
            let (mut stream, _) = match listener.accept() {
                Ok(accepted) => accepted,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    let idle = last_activity.elapsed();
                    if served >= expected_requests && idle > std::time::Duration::from_millis(800) {
                        break;
                    }
                    if idle > std::time::Duration::from_secs(15) {
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(5));
                    continue;
                }
                Err(error) => panic!("mock WebDAV accept failed: {error}"),
            };
            stream.set_nonblocking(false).unwrap();
            served += 1;
            last_activity = std::time::Instant::now();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(2)))
                .unwrap();
            let request = read_mock_request(&mut stream);
            let response = if request.method == "PROPFIND" {
                let name = request.path.rsplit('/').next().unwrap_or("").to_owned();
                let present = if request.path.contains("/locks/sync.lock") {
                    lock_payload.is_some()
                } else {
                    existing_paths.contains(&name)
                };
                MockResponse {
                    status: if present { 207 } else { 404 },
                    body: Vec::new(),
                    etag: None,
                }
            } else if request.path.contains("/locks/sync.lock") {
                match request.method.as_str() {
                    "PUT" if lock_payload.is_some() => MockResponse {
                        status: 412,
                        body: Vec::new(),
                        etag: None,
                    },
                    "PUT" => {
                        lock_payload = Some(serde_json::from_slice(&request.body).unwrap());
                        MockResponse {
                            status: 201,
                            body: Vec::new(),
                            etag: None,
                        }
                    }
                    "GET" => match lock_payload.as_ref() {
                        Some(value) => MockResponse {
                            status: 200,
                            body: serde_json::to_vec(value).unwrap(),
                            etag: None,
                        },
                        None => MockResponse {
                            status: 404,
                            body: Vec::new(),
                            etag: None,
                        },
                    },
                    "DELETE" => {
                        lock_payload = None;
                        MockResponse {
                            status: 204,
                            body: Vec::new(),
                            etag: None,
                        }
                    }
                    _ => MockResponse {
                        status: 500,
                        body: Vec::new(),
                        etag: None,
                    },
                }
            } else if request.method == "MKCOL" {
                MockResponse {
                    status: 201,
                    body: Vec::new(),
                    etag: None,
                }
            } else if request.path.ends_with("/manifest.json") && request.method == "GET" {
                match manifest.as_ref() {
                    Some(value) => MockResponse {
                        status: 200,
                        body: serde_json::to_vec(value).unwrap(),
                        etag: (!config.manifest_without_etag).then_some({
                            if manifest_version <= 1 {
                                "\"v1\""
                            } else {
                                "\"v2\""
                            }
                        }),
                    },
                    None => MockResponse {
                        status: 404,
                        body: Vec::new(),
                        etag: None,
                    },
                }
            } else if request.path.ends_with("/manifest.json") && request.method == "PUT" {
                if config.fail_manifest_update && manifest.is_some() {
                    MockResponse {
                        status: 412,
                        body: Vec::new(),
                        etag: None,
                    }
                } else {
                    manifest = Some(serde_json::from_slice(&request.body).unwrap());
                    manifest_version += 1;
                    MockResponse {
                        status: 201,
                        body: Vec::new(),
                        etag: None,
                    }
                }
            } else if request.path.contains("/changes/") && request.method == "PUT" {
                batch = Some(serde_json::from_slice(&request.body).unwrap());
                if let Some(name) = request.path.rsplit('/').next() {
                    existing_paths.insert(name.to_owned());
                }
                MockResponse {
                    status: 201,
                    body: Vec::new(),
                    etag: None,
                }
            } else if request.path.contains("/changes/") && request.method == "GET" {
                if config.corrupt_batch_read {
                    MockResponse {
                        status: 200,
                        body: b"{}".to_vec(),
                        etag: None,
                    }
                } else {
                    match batch.as_ref() {
                        Some(value) => MockResponse {
                            status: 200,
                            body: serde_json::to_vec(value).unwrap(),
                            etag: None,
                        },
                        None => MockResponse {
                            status: 404,
                            body: Vec::new(),
                            etag: None,
                        },
                    }
                }
            } else if request.path.contains("/attachments/blobs/") && request.method == "PUT" {
                if blob.is_some() {
                    MockResponse {
                        status: 412,
                        body: Vec::new(),
                        etag: None,
                    }
                } else {
                    blob = Some(request.body.clone());
                    MockResponse {
                        status: 201,
                        body: Vec::new(),
                        etag: None,
                    }
                }
            } else if request.path.contains("/attachments/blobs/") && request.method == "GET" {
                match blob.as_ref() {
                    Some(value) => MockResponse {
                        status: 200,
                        body: value.clone(),
                        etag: None,
                    },
                    None => MockResponse {
                        status: 404,
                        body: Vec::new(),
                        etag: None,
                    },
                }
            } else if request.path.contains("/attachments/blobs/") && request.method == "DELETE" {
                blob = None;
                MockResponse {
                    status: 204,
                    body: Vec::new(),
                    etag: None,
                }
            } else if request.path.contains("/snapshots/") && request.method == "PUT" {
                snapshot = Some(request.body.clone());
                if let Some(name) = request.path.rsplit('/').next() {
                    existing_paths.insert(name.to_owned());
                }
                MockResponse {
                    status: 201,
                    body: Vec::new(),
                    etag: None,
                }
            } else if request.path.contains("/snapshots/") && request.method == "GET" {
                match snapshot.as_ref() {
                    Some(value) => MockResponse {
                        status: 200,
                        body: value.clone(),
                        etag: None,
                    },
                    None => MockResponse {
                        status: 404,
                        body: Vec::new(),
                        etag: None,
                    },
                }
            } else if request.path.contains("/changes/") && request.method == "DELETE" {
                if let Some(name) = request.path.rsplit('/').next() {
                    existing_paths.remove(name);
                }
                MockResponse {
                    status: 204,
                    body: Vec::new(),
                    etag: None,
                }
            } else {
                MockResponse {
                    status: 500,
                    body: Vec::new(),
                    etag: None,
                }
            };
            write_mock_response(&mut stream, response);
            captured.lock().unwrap().push(request);
        }
    });
    (address, requests, handle)
}

fn read_mock_request(stream: &mut std::net::TcpStream) -> MockRequest {
    let mut request = Vec::new();
    let mut buffer = [0_u8; 4096];
    loop {
        let count = stream.read(&mut buffer).unwrap_or(0);
        if count == 0 {
            break;
        }
        request.extend_from_slice(&buffer[..count]);
        let Some(header_end) = request.windows(4).position(|value| value == b"\r\n\r\n") else {
            continue;
        };
        let headers = String::from_utf8_lossy(&request[..header_end + 4]);
        let content_length = headers
            .lines()
            .find_map(|line| {
                line.to_ascii_lowercase()
                    .strip_prefix("content-length:")
                    .and_then(|value| value.trim().parse::<usize>().ok())
            })
            .unwrap_or(0);
        if request.len() >= header_end + 4 + content_length {
            break;
        }
    }
    let header_end = request
        .windows(4)
        .position(|value| value == b"\r\n\r\n")
        .unwrap();
    let raw_headers = String::from_utf8_lossy(&request[..header_end]).to_ascii_lowercase();
    let mut request_line = raw_headers.lines().next().unwrap().split_whitespace();
    MockRequest {
        method: request_line.next().unwrap().to_ascii_uppercase(),
        path: request_line.next().unwrap().to_owned(),
        raw_headers,
        body: request[header_end + 4..].to_vec(),
    }
}

fn write_mock_response(stream: &mut std::net::TcpStream, response: MockResponse) {
    let reason = match response.status {
        200 => "OK",
        201 => "Created",
        204 => "No Content",
        404 => "Not Found",
        412 => "Precondition Failed",
        _ => "Internal Server Error",
    };
    let etag = response
        .etag
        .map(|value| format!("ETag: {value}\r\n"))
        .unwrap_or_default();
    let encoded = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\n{}Content-Length: {}\r\nConnection: close\r\n\r\n",
        response.status,
        reason,
        etag,
        response.body.len()
    );
    stream.write_all(encoded.as_bytes()).unwrap();
    stream.write_all(&response.body).unwrap();
}

fn cleanup_database(path: &std::path::Path) {
    let _ = std::fs::remove_file(path);
    let _ = std::fs::remove_file(format!("{}-wal", path.display()));
    let _ = std::fs::remove_file(format!("{}-shm", path.display()));
}
