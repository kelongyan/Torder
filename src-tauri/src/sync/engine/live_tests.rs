//! 真机 WebDAV 联调测试（默认跳过）。
//!
//! 需要四个环境变量才会真正执行，缺任一即跳过：
//!   TORDER_LIVE_DAV_URL   例：https://dav.jianguoyun.com/dav/
//!   TORDER_LIVE_DAV_USER  WebDAV 账号
//!   TORDER_LIVE_DAV_PASS  WebDAV 应用密码
//!   TORDER_LIVE_DAV_ROOT  测试目录，例：Test
//!
//! 每次运行在 ROOT 下建独立子目录，结束后清理，不影响既有同步集合。

use super::run::run_with_client;
use crate::db::database::Database;
use crate::db::sync_repository;
use crate::db::task_repository::TaskRepository;
use crate::models::CreateTaskInput;
use crate::sync::webdav::WebDavClient;

struct LiveConfig {
    url: String,
    user: String,
    pass: String,
    root: String,
}

fn live_config() -> Option<LiveConfig> {
    Some(LiveConfig {
        url: std::env::var("TORDER_LIVE_DAV_URL").ok()?,
        user: std::env::var("TORDER_LIVE_DAV_USER").ok()?,
        pass: std::env::var("TORDER_LIVE_DAV_PASS").ok()?,
        root: std::env::var("TORDER_LIVE_DAV_ROOT").ok()?,
    })
}

fn temp_database(label: &str) -> (Database, std::path::PathBuf) {
    let path = std::env::temp_dir().join(format!(
        "torder-live-{label}-{}.sqlite",
        uuid::Uuid::new_v4()
    ));
    let database = Database::initialize(path.clone()).expect("initialize temp database");
    (database, path)
}

fn cleanup_database(path: &std::path::Path) {
    let _ = std::fs::remove_file(path);
    let _ = std::fs::remove_file(format!("{}-wal", path.display()));
    let _ = std::fs::remove_file(format!("{}-shm", path.display()));
}

fn seed_task(database: &Database, title: &str) -> String {
    TaskRepository::new(database)
        .create(CreateTaskInput {
            title: title.to_owned(),
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
        .expect("create task")
        .id
}

fn task_titles(database: &Database) -> Vec<String> {
    let connection = database.connect().expect("connect");
    let mut statement = connection
        .prepare("SELECT title FROM tasks WHERE deleted_at IS NULL ORDER BY title")
        .expect("prepare");
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .expect("query");
    rows.map(|row| row.expect("row")).collect()
}

fn state(database: &Database, key: &str) -> Option<String> {
    let connection = database.connect().expect("connect");
    sync_repository::get_state(&connection, key).expect("get_state")
}

fn pending(database: &Database) -> i64 {
    let connection = database.connect().expect("connect");
    sync_repository::pending_count(&connection).expect("pending_count")
}

async fn purge_remote(client: &WebDavClient, root: &str) {
    for suffix in ["changes", "snapshots", "locks", "attachments"] {
        let _ = client.delete(&format!("{root}/{suffix}")).await;
    }
    let _ = client.delete(&format!("{root}/manifest.json")).await;
    let _ = client.delete(root).await;
}

#[test]
fn live_webdav_two_device_round_trip() {
    let Some(config) = live_config() else {
        eprintln!("live WebDAV test skipped: TORDER_LIVE_DAV_* not set");
        return;
    };
    let remote_root = format!(
        "{}/live-{}",
        config.root.trim_matches('/'),
        &uuid::Uuid::new_v4().to_string()[..8]
    );
    let client = WebDavClient::new(
        &config.url,
        Some(config.user.clone()),
        Some(config.pass.clone()),
    )
    .expect("build WebDAV client");

    let (device_a, path_a) = temp_database("a");
    let (device_b, path_b) = temp_database("b");
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        tauri::async_runtime::block_on(async {
            eprintln!("live remote root: {remote_root}");

            // 1) A 端首次上传
            seed_task(&device_a, "A-第一条任务");
            run_with_client(&device_a, &client, &remote_root)
                .await
                .expect("device A first sync");
            assert_eq!(pending(&device_a), 0, "A 端上传后应无待同步变更");
            assert_eq!(
                state(&device_a, "lastRemoteSequence").as_deref(),
                Some("1"),
                "A 端应停在序号 1"
            );

            // 2) B 端首次拉取
            run_with_client(&device_b, &client, &remote_root)
                .await
                .expect("device B first sync");
            assert!(
                task_titles(&device_b).contains(&"A-第一条任务".to_owned()),
                "B 端应拉到 A 端任务，实际：{:?}",
                task_titles(&device_b)
            );

            // 3) B 端写入并上传
            seed_task(&device_b, "B-第二条任务");
            run_with_client(&device_b, &client, &remote_root)
                .await
                .expect("device B upload");
            assert_eq!(pending(&device_b), 0, "B 端上传后应无待同步变更");

            // 4) A 端回拉 B 端改动
            run_with_client(&device_a, &client, &remote_root)
                .await
                .expect("device A pull back");
            let titles = task_titles(&device_a);
            assert!(
                titles.contains(&"B-第二条任务".to_owned()),
                "A 端应拉到 B 端任务，实际：{titles:?}"
            );
            eprintln!("live round trip OK, A titles = {titles:?}");
        });
    }));

    tauri::async_runtime::block_on(purge_remote(&client, &remote_root));
    drop(device_a);
    drop(device_b);
    cleanup_database(&path_a);
    cleanup_database(&path_b);
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

/// 复现用户现场：老客户端建立的 protocol/schemaVersion = 1 集合，
/// 升级后的客户端必须能继续同步，并把远端 manifest 就地升级到 v2。
#[test]
fn live_legacy_v1_collection_is_readable_and_upgraded() {
    let Some(config) = live_config() else {
        eprintln!("live WebDAV test skipped: TORDER_LIVE_DAV_* not set");
        return;
    };
    let remote_root = format!(
        "{}/legacy-{}",
        config.root.trim_matches('/'),
        &uuid::Uuid::new_v4().to_string()[..8]
    );
    let client = WebDavClient::new(&config.url, Some(config.user), Some(config.pass))
        .expect("build WebDAV client");
    let collection_id = uuid::Uuid::new_v4().to_string();
    let (device, db_path) = temp_database("legacy");

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        tauri::async_runtime::block_on(async {
            eprintln!("live legacy root: {remote_root}");
            for suffix in ["", "/changes", "/snapshots", "/locks"] {
                client
                    .mkcol(&format!("{remote_root}{suffix}"))
                    .await
                    .expect("create remote collection");
            }
            client
                .put_json(
                    &format!("{remote_root}/changes/{:020}.json", 1),
                    &legacy_batch(),
                )
                .await
                .expect("seed v1 change batch");
            client
                .put_json(
                    &format!("{remote_root}/manifest.json"),
                    &legacy_manifest(&collection_id),
                )
                .await
                .expect("seed v1 manifest");

            run_with_client(&device, &client, &remote_root)
                .await
                .expect("sync against v1 collection");
            assert!(
                task_titles(&device).contains(&"老协议历史任务".to_owned()),
                "应能读取 v1 集合的历史变更，实际：{:?}",
                task_titles(&device)
            );

            let upgraded = client
                .get_json(&format!("{remote_root}/manifest.json"))
                .await
                .expect("read manifest back");
            assert_eq!(upgraded["protocol"], 2, "远端 manifest 应升级为 protocol 2");
            assert_eq!(
                upgraded["schemaVersion"], 2,
                "远端 manifest 应升级为 schemaVersion 2"
            );
            assert_eq!(upgraded["collectionId"], collection_id.as_str());

            // 升级后继续正常上传
            seed_task(&device, "升级后新任务");
            run_with_client(&device, &client, &remote_root)
                .await
                .expect("upload after upgrade");
            assert_eq!(pending(&device), 0);
            assert_eq!(state(&device, "lastRemoteSequence").as_deref(), Some("2"));
            eprintln!("live legacy upgrade OK");
        });
    }));

    tauri::async_runtime::block_on(purge_remote(&client, &remote_root));
    drop(device);
    cleanup_database(&db_path);
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

/// 只读校验既有真实集合：GET manifest 与全部变更批次，走一遍校验 + 落库，
/// 全程不向服务器写任何东西。需额外设置 TORDER_LIVE_DAV_VERIFY_PATH（例：.torder）。
#[test]
fn live_existing_collection_passes_validation_read_only() {
    let Some(config) = live_config() else {
        eprintln!("live WebDAV test skipped: TORDER_LIVE_DAV_* not set");
        return;
    };
    let Ok(verify_path) = std::env::var("TORDER_LIVE_DAV_VERIFY_PATH") else {
        eprintln!("read-only verification skipped: TORDER_LIVE_DAV_VERIFY_PATH not set");
        return;
    };
    let client = WebDavClient::new(&config.url, Some(config.user), Some(config.pass))
        .expect("build WebDAV client");
    let root = verify_path.trim_matches('/').to_owned();
    let (database, db_path) = temp_database("verify");

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        tauri::async_runtime::block_on(async {
            let value = client
                .get_json(&format!("{root}/manifest.json"))
                .await
                .expect("read remote manifest");
            let manifest: crate::sync::manifest::Manifest =
                serde_json::from_value(value).expect("deserialize remote manifest");
            super::validate_manifest(&manifest).expect("existing manifest must validate");
            eprintln!(
                "verified {root}: protocol={} schemaVersion={} latestSequence={} snapshotSequence={}",
                manifest.protocol,
                manifest.schema_version,
                manifest.latest_sequence,
                manifest.snapshot_sequence
            );

            let mut connection = database.connect().expect("connect");
            let start = manifest.snapshot_sequence.max(1);
            for sequence in start..=manifest.latest_sequence {
                let batch_value = client
                    .get_json(&format!("{root}/changes/{sequence:020}.json"))
                    .await
                    .unwrap_or_else(|error| panic!("read change batch {sequence}: {error}"));
                let batch: crate::sync::manifest::ChangeBatch = serde_json::from_value(batch_value)
                    .unwrap_or_else(|error| panic!("deserialize batch {sequence}: {error}"));
                super::apply_batch(&mut connection, &batch)
                    .unwrap_or_else(|error| panic!("apply batch {sequence}: {error}"));
            }
            drop(connection);
            eprintln!("applied titles = {:?}", task_titles(&database));
        });
    }));

    drop(database);
    cleanup_database(&db_path);
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

/// 走 `run_with_mode`——即 Tauri 命令 `run_sync` 真正调用的入口，
/// 额外覆盖 remoteConfirmedFor 确认门禁、WebDavClient 构造与 OPTIONS 预检。
#[test]
fn live_run_with_mode_matches_app_entry_point() {
    let Some(config) = live_config() else {
        eprintln!("live WebDAV test skipped: TORDER_LIVE_DAV_* not set");
        return;
    };
    let remote_root = format!(
        "{}/entry-{}",
        config.root.trim_matches('/'),
        &uuid::Uuid::new_v4().to_string()[..8]
    );
    let client = WebDavClient::new(
        &config.url,
        Some(config.user.clone()),
        Some(config.pass.clone()),
    )
    .expect("build WebDAV client");
    let (database, db_path) = temp_database("entry");

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        // 未确认远端目录时必须直接拒绝
        let unconfirmed = tauri::async_runtime::block_on(super::run_with_mode(
            &database,
            &config.url,
            &remote_root,
            Some(config.user.clone()),
            Some(config.pass.clone()),
            super::InitialSyncMode::Merge,
        ));
        assert!(
            unconfirmed
                .unwrap_err()
                .to_string()
                .contains("not confirmed"),
            "未确认的远端目录应被拒绝"
        );

        let connection = database.connect().expect("connect");
        sync_repository::set_state(
            &connection,
            "remoteConfirmedFor",
            &super::confirmation_key(&config.url, &remote_root),
        )
        .expect("confirm remote");
        drop(connection);

        seed_task(&database, "入口路径任务");
        tauri::async_runtime::block_on(super::run_with_mode(
            &database,
            &config.url,
            &remote_root,
            Some(config.user.clone()),
            Some(config.pass.clone()),
            super::InitialSyncMode::Merge,
        ))
        .expect("run_with_mode sync");
        assert_eq!(pending(&database), 0);
        assert_eq!(state(&database, "lastRemoteSequence").as_deref(), Some("1"));
        eprintln!("live run_with_mode OK");
    }));

    tauri::async_runtime::block_on(purge_remote(&client, &remote_root));
    drop(database);
    cleanup_database(&db_path);
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

fn legacy_manifest(collection_id: &str) -> serde_json::Value {
    serde_json::json!({
        "protocol": 1,
        "collectionId": collection_id,
        "format": "torder-sync",
        "schemaVersion": 1,
        "latestSequence": 1,
        "snapshotSequence": 0,
        "encryption": null,
        "devices": [{
            "id": "legacy-windows-device",
            "name": "win",
            "lastSeenAt": "2026-08-24T12:16:15.344Z",
            "lastSequence": 1,
            "enabled": true
        }],
        "updatedAt": "2026-08-24T12:16:15.344Z"
    })
}

fn legacy_batch() -> serde_json::Value {
    serde_json::json!({
        "protocol": 1,
        "sequence": 1,
        "deviceId": "legacy-windows-device",
        "createdAt": "2026-08-24T05:18:15.171Z",
        "operations": [{
            "id": "legacy-task-change",
            "entity": "task",
            "objectId": "7827ef45-37c2-4c5d-a7a7-655f9e27a738",
            "operation": "upsert",
            "baseRevision": 0,
            "revision": 1,
            "changedAt": "2026-08-24T05:18:15.171Z",
            "payload": {
                "id": "7827ef45-37c2-4c5d-a7a7-655f9e27a738",
                "title": "老协议历史任务",
                "note": null,
                "status": "todo",
                "priority": 2,
                "listId": "study",
                "scheduledDate": null,
                "dueAt": "2026-08-24T11:00:00.000Z",
                "completedAt": null,
                "sortOrder": 0,
                "remindBefore": 1440,
                "remindAt": "2026-08-23T11:00:00Z",
                "remindedAt": null,
                "repeatRule": null,
                "subtasks": [],
                "tags": [],
                "recurringRuleId": null,
                "occurrenceAt": null,
                "deletedAt": null
            }
        }]
    })
}
