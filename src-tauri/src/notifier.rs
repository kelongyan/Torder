use std::path::PathBuf;
use std::time::Duration;

use rusqlite::{params, Connection, TransactionBehavior};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

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
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(60));
        if let Err(error) = check_and_notify(&app_handle, &database_path) {
            eprintln!("notifier error: {error}");
        }
    });
}

fn check_and_notify(app_handle: &AppHandle, database_path: &PathBuf) -> Result<(), String> {
    let mut connection = open_connection(database_path).map_err(|e| format!("db open: {e}"))?;

    // 认领与发送必须原子化：早先的实现用两条独立语句，各自重新求值
    // julianday('now') 且谓词无界，落在两次求值之间的任务会被打上
    // reminded_at 却从未发出事件，那条提醒就永久丢失了。
    // 现在先在一个事务里查出待提醒任务并按 id 精确认领，提交成功后才发送事件。
    // IMMEDIATE 让写锁在 SELECT 之前就拿到，避免读到已被别处认领的行。
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| format!("begin: {e}"))?;

    let tasks: Vec<Task> = {
        let mut statement = transaction
            .prepare(
                r#"
                SELECT id, title, note, status, priority, list_id, due_at,
                       completed_at, sort_order, remind_before, remind_at, reminded_at,
                       repeat_rule, recurring_rule_id, occurrence_at,
                       created_at, updated_at, deleted_at
                FROM tasks
                WHERE remind_at IS NOT NULL
                  AND reminded_at IS NULL
                  AND deleted_at IS NULL
                  AND status = 'todo'
                  AND julianday(remind_at) <= julianday('now')
                "#,
            )
            .map_err(|e| format!("prepare: {e}"))?;

        let rows = statement
            .query_map([], map_task)
            .map_err(|e| format!("query_map: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("collect: {e}"))?;
        rows
    };

    if tasks.is_empty() {
        return Ok(());
    }

    // 只为真正认领成功的任务发送事件，重复认领不会产生重复通知。
    let mut claimed = Vec::with_capacity(tasks.len());
    for task in tasks {
        let updated = transaction
            .execute(
                r#"
                UPDATE tasks
                SET reminded_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                WHERE id = ?1 AND reminded_at IS NULL
                "#,
                params![task.id],
            )
            .map_err(|e| format!("update reminded_at: {e}"))?;
        if updated > 0 {
            claimed.push(task);
        }
    }

    transaction.commit().map_err(|e| format!("commit: {e}"))?;

    for task in &claimed {
        let event = ReminderEvent {
            task_id: task.id.clone(),
            title: task.title.clone(),
            due_at: task.due_at.clone(),
        };
        let _ = app_handle.emit("task-reminder", event);
    }

    Ok(())
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

fn map_task(row: &rusqlite::Row<'_>) -> rusqlite::Result<Task> {
    Ok(Task {
        id: row.get(0)?,
        title: row.get(1)?,
        note: row.get(2)?,
        status: row.get(3)?,
        priority: row.get(4)?,
        list_id: row.get(5)?,
        due_at: row.get(6)?,
        completed_at: row.get(7)?,
        sort_order: row.get(8)?,
        remind_before: row.get(9)?,
        remind_at: row.get(10)?,
        reminded_at: row.get(11)?,
        repeat_rule: row.get(12)?,
        recurring_rule_id: row.get(13)?,
        occurrence_at: row.get(14)?,
        created_at: row.get(15)?,
        updated_at: row.get(16)?,
        deleted_at: row.get(17)?,
    })
}
