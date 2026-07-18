use tauri::State;

use crate::db::list_repository::ListRepository;
use crate::db::Database;
use crate::models::{CreateListInput, TaskList, UpdateListInput};

#[tauri::command]
pub fn list_lists(database: State<'_, Database>) -> Result<Vec<TaskList>, String> {
    ListRepository::new(&database)
        .list()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn create_list(
    database: State<'_, Database>,
    input: CreateListInput,
) -> Result<TaskList, String> {
    ListRepository::new(&database)
        .create(input)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn update_list(
    database: State<'_, Database>,
    input: UpdateListInput,
) -> Result<TaskList, String> {
    ListRepository::new(&database)
        .update(input)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn delete_list(database: State<'_, Database>, id: String) -> Result<(), String> {
    ListRepository::new(&database)
        .delete(&id)
        .map_err(|error| error.to_string())
}
