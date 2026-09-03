use std::path::PathBuf;

use rusqlite::{params, Connection, TransactionBehavior};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;

use super::spawn_poller;
use crate::db::sync_repository;
use crate::db::task_repository;
use crate::models::Task;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderEvent {
    pub task_id: String,
    pub title: String,
    pub due_at: Option<String>,
}

pub fn start_notifier(app_handle: AppHandle, database_path: PathBuf) {
    // 启动时立即补扫一次：Android 后台进程会被系统冻结，恢复打开时
    // 借此补发冻结期间错过的提醒；桌面端也能避免启动后 60s 的空窗。
    if let Err(error) = check_and_notify(&app_handle, &database_path) {
        eprintln!("notifier startup scan error: {error}");
    }

    // 移动端不启动轮询线程（后台会被冻结，线程无意义且耗电），
    // 提醒降级为「每次打开应用时补发」。
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    spawn_poller(true, move || {
        if let Err(error) = check_and_notify(&app_handle, &database_path) {
            eprintln!("notifier error: {error}");
        }
    });
}

fn check_and_notify(app_handle: &AppHandle, database_path: &PathBuf) -> Result<(), String> {
    let mut connection = open_connection(database_path).map_err(|e| format!("db open: {e}"))?;

    // P0-02：系统通知的唯一权威是本模块的原生通知。用户在设置中关闭
    // 「系统通知」（notificationsEnabled）后，整个提醒链路短路：不发送
    // 原生通知、不 emit 事件、不标记 reminded_at。采用「暂停」语义而非
    // 「跳过并标记」：任务保持未提醒状态，重新开启通知后下轮轮询补发，
    // 避免用户以为提醒已消费却从未收到。
    if !notifications_enabled(&connection) {
        return Ok(());
    }

    let tasks = due_reminder_tasks(&connection)?;

    if tasks.is_empty() {
        return Ok(());
    }

    notify_tasks(
        &mut connection,
        tasks,
        &mut |task| send_native_notification(app_handle, task),
        &mut |task| {
            let event = ReminderEvent {
                task_id: task.id.clone(),
                title: task.title.clone(),
                due_at: task.due_at.clone(),
            };
            let _ = app_handle.emit("task-reminder", event);
        },
    )
}

/// 逐个发送并标记到期任务提醒。
///
/// 行为约束（P0-02 验收项）：
/// - 发送失败的任务不标记 `reminded_at`，留在待提醒集合中等待下轮重试；
/// - 标记幂等成功（首次更新命中）后才 emit 前端事件，重放/重复轮询
///   不会对同一任务重复 emit；
/// - `sender` 与 `emit` 通过参数注入，测试可用 spy 验证上述约束。
fn notify_tasks(
    connection: &mut Connection,
    tasks: Vec<Task>,
    sender: &mut dyn FnMut(&Task) -> Result<(), String>,
    emit: &mut dyn FnMut(&Task),
) -> Result<(), String> {
    for task in tasks {
        if let Err(error) = sender(&task) {
            // 发送失败不标记 reminded_at：任务留在待提醒集合中，下轮重试
            eprintln!("native notification failed for task {}: {error}", task.id);
            continue;
        }
        if mark_task_reminded(connection, &task.id)? {
            emit(&task);
        }
    }
    Ok(())
}

/// 读取系统通知总开关（settings 表 notificationsEnabled，值为 JSON 编码的
/// 布尔：前端 upsertSetting 写入 JSON.stringify(true) → "true"）。
///
/// 缺省、非法 JSON 或非布尔值一律视为开启：与前端 parseBoolean 的默认值
/// （defaultAppSettings.notificationsEnabled = true）保持一致，保证设置
/// 读写异常时不会静默吞掉用户提醒。
fn notifications_enabled(connection: &Connection) -> bool {
    connection
        .query_row(
            "SELECT value FROM settings WHERE key = 'notificationsEnabled'",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .map(|value| match value {
            serde_json::Value::Bool(enabled) => enabled,
            // 兼容历史/误写入的字符串形态（如 "\"true\""）
            serde_json::Value::String(raw) => raw == "true",
            _ => true,
        })
        .unwrap_or(true)
}

fn due_reminder_tasks(connection: &Connection) -> Result<Vec<Task>, String> {
    let mut statement = connection
        .prepare(&format!(
            "{} WHERE remind_at IS NOT NULL
              AND reminded_at IS NULL
              AND deleted_at IS NULL
              AND purged_at IS NULL
              AND status = 'todo'
              AND julianday(remind_at) <= julianday('now')",
            task_repository::select_tasks()
        ))
        .map_err(|e| format!("prepare: {e}"))?;

    let tasks = statement
        .query_map([], task_repository::map_task)
        .map_err(|e| format!("query_map: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("collect: {e}"))?;
    Ok(tasks)
}

fn send_native_notification(app_handle: &AppHandle, task: &Task) -> Result<(), String> {
    app_handle
        .notification()
        .builder()
        .title("今序提醒")
        .body(task.title.clone())
        .show()
        .map_err(|error| format!("native notification: {error}"))
}

/// 专注结束的一次性系统通知（阶段 A / T-02 一期）。
///
/// 权威约束（P0-02）：系统通知一律经本模块（Rust）原生通道发送，前端不得
/// 接入 Web Notification。尊重「系统通知」总开关（notifications_enabled）：
/// 关闭时静默成功（与任务提醒暂停语义一致）；不标记任务、不 emit 事件。
pub fn send_focus_finished_notification(
    app_handle: &AppHandle,
    connection: &Connection,
) -> Result<(), String> {
    let enabled = notifications_enabled(connection);
    notify_focus_if_enabled(enabled, &mut || {
        app_handle
            .notification()
            .builder()
            .title("专注结束")
            .body("本轮专注已完成，休息一下吧。")
            .show()
            .map_err(|error| format!("native notification: {error}"))
    })
}

/// 通用单条桌面通知（阶段 D）：受「系统通知」总开关门控，不标记任何数据。
pub fn send_text_notification(
    app_handle: &AppHandle,
    connection: &Connection,
    title: &str,
    body: &str,
) -> Result<(), String> {
    let enabled = notifications_enabled(connection);
    notify_focus_if_enabled(enabled, &mut || {
        app_handle
            .notification()
            .builder()
            .title(title)
            .body(body)
            .show()
            .map_err(|error| format!("native notification: {error}"))
    })
}

/// 门控 + 发送拆开便于单测（仿 notify_tasks 的 sender 注入）：
/// 关闭通知时静默成功；开启时调用 send 一次，失败原样透传。
fn notify_focus_if_enabled(
    enabled: bool,
    send: &mut dyn FnMut() -> Result<(), String>,
) -> Result<(), String> {
    if !enabled {
        return Ok(());
    }
    send()
}

fn mark_task_reminded(connection: &mut Connection, task_id: &str) -> Result<bool, String> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| format!("begin: {e}"))?;
    let updated = transaction
        .execute(
            r#"
            UPDATE tasks
            SET reminded_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?1
              AND reminded_at IS NULL
              AND (remind_at IS NULL OR julianday(remind_at) <= julianday('now'))
            "#,
            params![task_id],
        )
        .map_err(|e| format!("update reminded_at: {e}"))?;
    if updated == 0 {
        transaction.commit().map_err(|e| format!("commit: {e}"))?;
        return Ok(false);
    }

    let changed_task = transaction
        .query_row(
            &format!("{} WHERE id = ?1", task_repository::select_tasks()),
            params![task_id],
            task_repository::map_task,
        )
        .map_err(|e| format!("reload task: {e}"))?;
    sync_repository::record_change(
        &transaction,
        "task",
        task_id,
        "upsert",
        serde_json::to_value(changed_task).map_err(|e| format!("serialize task: {e}"))?,
    )
    .map_err(|e| format!("record reminder sync change: {e}"))?;
    transaction.commit().map_err(|e| format!("commit: {e}"))?;
    Ok(true)
}

fn open_connection(database_path: &PathBuf) -> Result<Connection, rusqlite::Error> {
    let connection = Connection::open(database_path)?;
    connection.busy_timeout(std::time::Duration::from_secs(5))?;
    connection.execute_batch(
        r#"
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        "#,
    )?;
    Ok(connection)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::task_repository::TaskRepository;
    use crate::db::Database;
    use crate::models::CreateTaskInput;

    fn temp_db(tag: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "torder-notifier-{tag}-{}.sqlite",
            uuid::Uuid::new_v4()
        ))
    }

    fn cleanup_db(path: &std::path::PathBuf) {
        let _ = std::fs::remove_file(path);
        let _ = std::fs::remove_file(format!("{}-wal", path.display()));
        let _ = std::fs::remove_file(format!("{}-shm", path.display()));
    }

    fn sample_task(database: &Database) -> crate::models::Task {
        TaskRepository::new(database)
            .create(CreateTaskInput {
                title: "提醒同步测试".to_owned(),
                note: None,
                priority: Some(1),
                list_id: Some("work".to_owned()),
                scheduled_date: Some("2026-08-21".to_owned()),
                due_at: Some("2026-08-21T09:00:00Z".to_owned()),
                sort_order: Some(0),
                remind_before: Some(10),
                repeat_rule: None,
                subtasks: None,
                tags: None,
            })
            .unwrap()
    }

    #[test]
    fn mark_task_reminded_records_sync_change_with_payload() {
        let path = temp_db("reminded");
        let database = Database::initialize(path.clone()).unwrap();
        let task = sample_task(&database);
        let mut connection = database.connect().unwrap();

        assert!(mark_task_reminded(&mut connection, &task.id).unwrap());
        assert!(!mark_task_reminded(&mut connection, &task.id).unwrap());

        let reminded_at = connection
            .query_row(
                "SELECT reminded_at FROM tasks WHERE id = ?1",
                params![&task.id],
                |row| row.get::<_, Option<String>>(0),
            )
            .unwrap();
        assert!(reminded_at.is_some());
        let payload_json: String = connection
            .query_row(
                "SELECT payload_json FROM sync_changes WHERE entity = 'task' AND object_id = ?1 ORDER BY revision DESC LIMIT 1",
                params![&task.id],
                |row| row.get(0),
            )
            .unwrap();
        let payload: serde_json::Value = serde_json::from_str(&payload_json).unwrap();
        assert!(payload["remindedAt"].as_str().is_some());
        let change_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sync_changes WHERE entity = 'task' AND object_id = ?1",
                params![&task.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(change_count, 2);

        drop(connection);
        drop(database);
        cleanup_db(&path);
    }

    // ---- P0-02 通知门控与发送/标记一致性 ----

    fn create_test_task(database: &Database, title: &str) -> crate::models::Task {
        TaskRepository::new(database)
            .create(CreateTaskInput {
                title: title.to_owned(),
                note: None,
                priority: None,
                list_id: None,
                scheduled_date: None,
                due_at: None,
                sort_order: Some(0),
                remind_before: None,
                repeat_rule: None,
                subtasks: None,
                tags: None,
            })
            .unwrap()
    }

    #[test]
    fn notification_gate_defaults_to_enabled_and_reads_setting() {
        let path = temp_db("gate");
        let database = Database::initialize(path.clone()).unwrap();
        let connection = database.connect().unwrap();

        // 缺省（未写入设置）视为开启，与前端 parseBoolean 默认值一致
        assert!(notifications_enabled(&connection));

        connection
            .execute(
                "INSERT INTO settings (key, value) VALUES ('notificationsEnabled', 'true')",
                [],
            )
            .unwrap();
        assert!(notifications_enabled(&connection));

        // 关闭开关必须生效（前端写入 JSON.stringify(false) → 裸值 false）
        connection
            .execute(
                "UPDATE settings SET value = 'false' WHERE key = 'notificationsEnabled'",
                [],
            )
            .unwrap();
        assert!(!notifications_enabled(&connection));

        // 字符串形态（历史/误写入）兼容解析
        connection
            .execute(
                "UPDATE settings SET value = '\"false\"' WHERE key = 'notificationsEnabled'",
                [],
            )
            .unwrap();
        assert!(!notifications_enabled(&connection));

        // 损坏 JSON 不能静默吞掉提醒：视为开启
        connection
            .execute(
                "UPDATE settings SET value = 'not-json' WHERE key = 'notificationsEnabled'",
                [],
            )
            .unwrap();
        assert!(notifications_enabled(&connection));

        drop(connection);
        drop(database);
        cleanup_db(&path);
    }

    #[test]
    fn failed_send_leaves_task_unreminded_for_retry() {
        let path = temp_db("send-failed");
        let database = Database::initialize(path.clone()).unwrap();
        let task = create_test_task(&database, "发送失败重试");
        let mut connection = database.connect().unwrap();

        let mut emit_count = 0;
        let result = notify_tasks(
            &mut connection,
            vec![task.clone()],
            &mut |_| Err("channel unavailable".to_owned()),
            &mut |_| emit_count += 1,
        );

        assert!(result.is_ok());
        assert_eq!(emit_count, 0);
        let reminded_at: Option<String> = connection
            .query_row(
                "SELECT reminded_at FROM tasks WHERE id = ?1",
                params![&task.id],
                |row| row.get(0),
            )
            .unwrap();
        assert!(
            reminded_at.is_none(),
            "failed send must not mark the task as reminded"
        );

        drop(connection);
        drop(database);
        cleanup_db(&path);
    }

    #[test]
    fn successful_send_emits_once_and_is_idempotent() {
        let path = temp_db("emit-once");
        let database = Database::initialize(path.clone()).unwrap();
        let task = create_test_task(&database, "幂等 emit");
        let mut connection = database.connect().unwrap();

        let mut emit_count = 0;
        notify_tasks(
            &mut connection,
            vec![task.clone()],
            &mut |_| Ok(()),
            &mut |_| emit_count += 1,
        )
        .unwrap();
        assert_eq!(emit_count, 1);

        // 第二轮处理同一任务（模拟重复轮询/重启补扫）：mark 幂等命中失败，
        // 不应重复 emit。
        notify_tasks(&mut connection, vec![task], &mut |_| Ok(()), &mut |_| {
            emit_count += 1
        })
        .unwrap();
        assert_eq!(emit_count, 1);

        drop(connection);
        drop(database);
        cleanup_db(&path);
    }

    #[test]
    fn focus_notice_disabled_gate_sends_nothing() {
        let mut calls = 0;
        let result = notify_focus_if_enabled(false, &mut || {
            calls += 1;
            Ok(())
        });
        assert_eq!(result, Ok(()));
        assert_eq!(calls, 0, "关闭系统通知时不应发送");
    }

    #[test]
    fn focus_notice_enabled_sends_once_and_propagates_failure() {
        let mut calls = 0;
        let result = notify_focus_if_enabled(true, &mut || {
            calls += 1;
            Ok(())
        });
        assert_eq!(result, Ok(()));
        assert_eq!(calls, 1);

        let failed =
            notify_focus_if_enabled(true, &mut || Err("native notification: boom".to_owned()));
        assert_eq!(failed, Err("native notification: boom".to_owned()));
    }
}
