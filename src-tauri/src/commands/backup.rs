use tauri::{AppHandle, State};

use crate::backup;
use crate::db::Database;

#[tauri::command]
pub fn backup_database(app: AppHandle, database: State<'_, Database>) -> Result<String, String> {
    backup::backup_database(&app, &database).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn export_tasks(
    app: AppHandle,
    database: State<'_, Database>,
    format: String,
) -> Result<String, String> {
    backup::export_tasks(&app, &database, &format).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_backups(app: AppHandle) -> Result<Vec<String>, String> {
    backup::list_backups(&app).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn restore_backup(app: AppHandle, path: String) -> Result<(), String> {
    backup::restore_backup(&app, &path).map_err(|error| error.to_string())
}
