use tauri::State;

use crate::db::tag_repository::TagRepository;
use crate::db::Database;
use crate::models::{CreateTagInput, Tag, UpdateTagInput};

#[tauri::command]
pub fn list_tags(database: State<'_, Database>) -> Result<Vec<Tag>, String> {
    TagRepository::new(&database)
        .list()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn create_tag(database: State<'_, Database>, input: CreateTagInput) -> Result<Tag, String> {
    TagRepository::new(&database)
        .create(input)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn update_tag(database: State<'_, Database>, input: UpdateTagInput) -> Result<Tag, String> {
    TagRepository::new(&database)
        .update(input)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn delete_tag(database: State<'_, Database>, id: String) -> Result<(), String> {
    TagRepository::new(&database)
        .delete(&id)
        .map_err(|error| error.to_string())
}
