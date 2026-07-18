use std::path::PathBuf;

use tauri::State;

use crate::db::backup_repository::{BackupOperationResult, BackupRepository};
use crate::db::Database;

#[tauri::command]
pub fn export_backup(
    database: State<'_, Database>,
    path: String,
) -> Result<BackupOperationResult, String> {
    BackupRepository::new(&database)
        .export_to_path(&PathBuf::from(path))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn inspect_backup(
    database: State<'_, Database>,
    path: String,
) -> Result<BackupOperationResult, String> {
    BackupRepository::new(&database)
        .inspect_path(&PathBuf::from(path))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn restore_backup(
    database: State<'_, Database>,
    path: String,
) -> Result<BackupOperationResult, String> {
    BackupRepository::new(&database)
        .restore_from_path(&PathBuf::from(path))
        .map_err(|error| error.to_string())
}
