use std::path::PathBuf;
use std::time::Duration;

use rusqlite::{params, Connection};
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
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(60));
        if let Err(error) = check_and_notify(&app_handle, &database_path) {
            eprintln!("notifier error: {error}");
        }
    });
}

fn check_and_notify(app_handle: &AppHandle, database_path: &PathBuf) -> Result<(), String> {
    let connection = open_connection(database_path).map_err(|e| format!("db open: {e}"))?;

    let mut statement = connection
        .prepare(
            r#"
            SELECT id, title, note, status, priority, list_id, due_at,
                   completed_at, sort_order, remind_before, remind_at, reminded_at,
                   created_at, updated_at, deleted_at
            FROM tasks
            WHERE remind_at IS NOT NULL
              AND reminded_at IS NULL
              AND deleted_at IS NULL
              AND remind_at <= datetime('now')
            "#,
        )
        .map_err(|e| format!("prepare: {e}"))?;

    let tasks: Vec<Task> = statement
        .query_map([], map_task)
        .map_err(|e| format!("query_map: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("collect: {e}"))?;

    if tasks.is_empty() {
        return Ok(());
    }

    for task in &tasks {
        let event = ReminderEvent {
            task_id: task.id.clone(),
            title: task.title.clone(),
            due_at: task.due_at.clone(),
        };
        let _ = app_handle.emit("task-reminder", event);
    }

    connection
        .execute(
            r#"
            UPDATE tasks
            SET reminded_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE remind_at IS NOT NULL
              AND reminded_at IS NULL
              AND deleted_at IS NULL
              AND remind_at <= datetime('now')
            "#,
            params![],
        )
        .map_err(|e| format!("update reminded_at: {e}"))?;

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
        created_at: row.get(12)?,
        updated_at: row.get(13)?,
        deleted_at: row.get(14)?,
    })
}
