use std::collections::HashMap;

use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

use crate::db::attachment_repository::AttachmentRepository;
use crate::db::Database;
use crate::models::{
    Attachment, AttachmentTransferStatus, CreateAttachmentInput, CreateWebLinkAttachmentInput,
};

#[tauri::command]
pub fn list_task_attachments(
    app: AppHandle,
    database: State<'_, Database>,
    task_id: String,
) -> Result<Vec<Attachment>, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    AttachmentRepository::new(&database)
        .list_by_task(&data_dir, &task_id)
        .map_err(|error| error.to_string())
}

/// F1 · T-15：一次取回 `task_id -> 附件数` 映射，供列表页各行查表（避免 N+1）。
#[tauri::command]
pub fn count_task_attachments(
    database: State<'_, Database>,
) -> Result<HashMap<String, i64>, String> {
    AttachmentRepository::new(&database)
        .count_by_tasks()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn add_managed_attachment(
    app: AppHandle,
    database: State<'_, Database>,
    input: CreateAttachmentInput,
) -> Result<Attachment, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    AttachmentRepository::new(&database)
        .create_managed(&data_dir, input)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn add_local_attachment_reference(
    database: State<'_, Database>,
    input: CreateAttachmentInput,
) -> Result<Attachment, String> {
    AttachmentRepository::new(&database)
        .create_local_reference(input)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn add_web_link_attachment(
    database: State<'_, Database>,
    input: CreateWebLinkAttachmentInput,
) -> Result<Attachment, String> {
    AttachmentRepository::new(&database)
        .create_web_link(input)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn delete_attachment(database: State<'_, Database>, id: String) -> Result<(), String> {
    AttachmentRepository::new(&database)
        .soft_delete(&id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn open_attachment(
    app: AppHandle,
    database: State<'_, Database>,
    id: String,
) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let path = AttachmentRepository::new(&database)
        .resolve_local_path(&data_dir, &id)
        .map_err(|error| error.to_string())?;
    app.opener()
        .open_path(path.display().to_string(), None::<String>)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn reveal_attachment(
    app: AppHandle,
    database: State<'_, Database>,
    id: String,
) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let path = AttachmentRepository::new(&database)
        .resolve_local_path(&data_dir, &id)
        .map_err(|error| error.to_string())?;
    app.opener()
        .reveal_item_in_dir(path)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_attachment_transfer_status(
    database: State<'_, Database>,
) -> Result<AttachmentTransferStatus, String> {
    AttachmentRepository::new(&database)
        .transfer_status()
        .map_err(|error| error.to_string())
}
