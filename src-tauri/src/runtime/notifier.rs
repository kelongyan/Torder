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

    let tasks = due_reminder_tasks(&connection)?;

    if tasks.is_empty() {
        return Ok(());
    }

    for task in tasks {
        send_native_notification(app_handle, &task)?;
        if mark_task_reminded(&mut connection, &task.id)? {
            let event = ReminderEvent {
                task_id: task.id.clone(),
                title: task.title.clone(),
                due_at: task.due_at.clone(),
            };
            let _ = app_handle.emit("task-reminder", event);
        }
    }

    Ok(())
}

fn due_reminder_tasks(connection: &Connection) -> Result<Vec<Task>, String> {
    let mut statement = connection
        .prepare(&format!(
            "{} WHERE remind_at IS NOT NULL
              AND reminded_at IS NULL
              AND deleted_at IS NULL
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
            WHERE id = ?1 AND reminded_at IS NULL
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

    #[test]
    fn mark_task_reminded_records_sync_change_with_payload() {
        let path = std::env::temp_dir().join(format!(
            "torder-notifier-reminded-{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        let database = Database::initialize(path.clone()).unwrap();
        let task = TaskRepository::new(&database)
            .create(CreateTaskInput {
                title: "提醒同步测试".to_owned(),
                note: None,
                priority: Some(1),
                list_id: Some("work".to_owned()),
                due_at: Some("2026-08-21T09:00:00Z".to_owned()),
                sort_order: Some(0),
                remind_before: Some(10),
                repeat_rule: None,
            })
            .unwrap();
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
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(format!("{}-wal", path.display()));
        let _ = std::fs::remove_file(format!("{}-shm", path.display()));
    }
}
