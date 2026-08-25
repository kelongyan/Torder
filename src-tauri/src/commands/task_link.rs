use tauri::State;

use crate::db::task_link_repository::TaskLinkRepository;
use crate::db::Database;
use crate::models::{CreateTaskLinkInput, Task, TaskLink};

#[tauri::command]
pub fn list_task_links(
    database: State<'_, Database>,
    task_id: String,
) -> Result<Vec<TaskLink>, String> {
    TaskLinkRepository::new(&database)
        .list_by_task(&task_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn create_task_link(
    database: State<'_, Database>,
    input: CreateTaskLinkInput,
) -> Result<TaskLink, String> {
    TaskLinkRepository::new(&database)
        .create(input)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn delete_task_link(database: State<'_, Database>, id: String) -> Result<(), String> {
    TaskLinkRepository::new(&database)
        .soft_delete(&id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn search_linkable_tasks(
    database: State<'_, Database>,
    source_task_id: String,
    query: Option<String>,
    limit: i64,
) -> Result<Vec<Task>, String> {
    TaskLinkRepository::new(&database)
        .search_linkable_tasks(&source_task_id, query, limit)
        .map_err(|error| error.to_string())
}
