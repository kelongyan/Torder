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
pub fn list_tasks(database: State<'_, Database>) -> Result<Vec<Task>, String> {
    TaskRepository::new(&database)
        .list_all_todo()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_today_tasks(database: State<'_, Database>) -> Result<Vec<Task>, String> {
    TaskRepository::new(&database)
        .list_today()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_completed_tasks(database: State<'_, Database>) -> Result<Vec<Task>, String> {
    TaskRepository::new(&database)
        .list_completed()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_overdue_tasks(database: State<'_, Database>) -> Result<Vec<Task>, String> {
    TaskRepository::new(&database)
        .list_overdue()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_due_reminders(database: State<'_, Database>) -> Result<Vec<Task>, String> {
    TaskRepository::new(&database)
        .list_due_reminders()
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

#[tauri::command]
pub fn update_task(database: State<'_, Database>, input: UpdateTaskInput) -> Result<Task, String> {
    TaskRepository::new(&database)
        .update(input)
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
pub fn mark_task_reminded(database: State<'_, Database>, id: String) -> Result<Task, String> {
    TaskRepository::new(&database)
        .mark_reminded(&id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn snooze_task_reminder(
    database: State<'_, Database>,
    id: String,
    minutes: i64,
) -> Result<Task, String> {
    TaskRepository::new(&database)
        .snooze_reminder(&id, minutes)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn set_task_tags(
    database: State<'_, Database>,
    task_id: String,
    tag_ids: Vec<String>,
) -> Result<(), String> {
    TaskRepository::new(&database)
        .set_tags(&task_id, &tag_ids)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_task_tag_ids(
    database: State<'_, Database>,
    task_id: String,
) -> Result<Vec<String>, String> {
    TaskRepository::new(&database)
        .list_tag_ids(&task_id)
        .map_err(|error| error.to_string())
}
