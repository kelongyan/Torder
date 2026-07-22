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
