use tauri::State;

use crate::db::task_repository::TaskRepository;
use crate::db::Database;
use crate::models::{CreateTaskInput, Task, TaskQueryInput, UpdateTaskInput};

#[tauri::command]
pub fn create_task(database: State<'_, Database>, input: CreateTaskInput) -> Result<Task, String> {
    TaskRepository::new(&database)
        .create(input)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_task(database: State<'_, Database>, id: String) -> Result<Task, String> {
    TaskRepository::new(&database)
        .get(&id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn query_tasks(
    database: State<'_, Database>,
    input: TaskQueryInput,
) -> Result<Vec<Task>, String> {
    TaskRepository::new(&database)
        .query(input)
        .map_err(|error| error.to_string())
}

/// 桌面小窗专用：按日期查精简结果集，IPC 行数通常 < 20。
#[tauri::command]
pub fn query_tasks_for_date(
    database: State<'_, Database>,
    date_key: String,
    include_completed: Option<bool>,
) -> Result<Vec<Task>, String> {
    TaskRepository::new(&database)
        .query_for_widget(&date_key, include_completed.unwrap_or(true))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn update_task(database: State<'_, Database>, input: UpdateTaskInput) -> Result<Task, String> {
    TaskRepository::new(&database)
        .update(input)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn snooze_task_reminder(
    database: State<'_, Database>,
    id: String,
    remind_at: String,
) -> Result<Task, String> {
    TaskRepository::new(&database)
        .snooze_reminder(&id, &remind_at)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn delete_task(database: State<'_, Database>, id: String) -> Result<(), String> {
    TaskRepository::new(&database)
        .soft_delete(&id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn set_task_completed(
    database: State<'_, Database>,
    id: String,
    completed: bool,
) -> Result<Task, String> {
    TaskRepository::new(&database)
        .set_completed(&id, completed)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn restore_task(database: State<'_, Database>, id: String) -> Result<Task, String> {
    TaskRepository::new(&database)
        .restore(&id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn permanent_delete_task(database: State<'_, Database>, id: String) -> Result<(), String> {
    TaskRepository::new(&database)
        .permanent_delete(&id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn empty_trash(database: State<'_, Database>) -> Result<i64, String> {
    TaskRepository::new(&database)
        .empty_trash()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn cleanup_trash(database: State<'_, Database>, retention_days: i64) -> Result<i64, String> {
    TaskRepository::new(&database)
        .cleanup_trash(retention_days)
        .map_err(|error| error.to_string())
}
