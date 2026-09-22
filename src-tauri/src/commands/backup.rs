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
pub fn preview_backup_import(
    app: AppHandle,
    path: String,
) -> Result<backup::BackupImportPreview, String> {
    backup::preview_backup_import(&app, &path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn import_backup_selection(
    app: AppHandle,
    database: State<'_, Database>,
    path: String,
    include_lists: bool,
    include_tasks: bool,
    include_recurring_rules: bool,
) -> Result<backup::BackupImportResult, String> {
    backup::import_backup_selection(
        &app,
        &database,
        &path,
        include_lists,
        include_tasks,
        include_recurring_rules,
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn restore_backup(app: AppHandle, path: String) -> Result<(), String> {
    backup::restore_backup(&app, &path).map_err(|error| error.to_string())
}

/// 导出完整迁移包到用户选定路径（系统保存对话框返回的绝对路径）。
#[tauri::command]
pub fn export_backup_package(
    app: AppHandle,
    database: State<'_, Database>,
    destination: String,
) -> Result<String, String> {
    backup::export_backup_package(&app, &database, &destination)
        .map_err(|error| error.to_string())
}

/// 预览用户选定的迁移包（比内部备份预览多报设置与日历项计数）。
#[tauri::command]
pub fn preview_migration_package(
    app: AppHandle,
    path: String,
) -> Result<backup::BackupImportPreview, String> {
    backup::preview_migration_package(&app, &path).map_err(|error| error.to_string())
}

/// 从迁移包恢复：`mode` = `merge`（保留现有数据并补齐）或 `replace`（整库替换）。
#[tauri::command]
pub fn import_migration_package(
    app: AppHandle,
    database: State<'_, Database>,
    path: String,
    mode: String,
) -> Result<backup::BackupImportResult, String> {
    let mode = backup::ImportMode::parse(&mode).map_err(|error| error.to_string())?;
    backup::import_migration_package(&app, &database, &path, mode)
        .map_err(|error| error.to_string())
}
