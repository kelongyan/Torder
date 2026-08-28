use chrono::Utc;
use serde_json::json;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::db::{attachment_repository::AttachmentRepository, sync_repository, Database};
use crate::models::{
    SyncChange, SyncCleanupResult, SyncConflict, SyncDevice, SyncRemoteInspection, SyncStatus,
};
use crate::sync::engine;
use crate::sync::service;
use crate::sync::SyncRuntime;

#[tauri::command]
pub fn get_sync_status(database: State<'_, Database>) -> Result<SyncStatus, String> {
    let connection = database.connect().map_err(|error| error.to_string())?;
    sync_repository::status(&connection).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_pending_sync_changes(
    database: State<'_, Database>,
    limit: Option<i64>,
) -> Result<Vec<SyncChange>, String> {
    let connection = database.connect().map_err(|error| error.to_string())?;
    sync_repository::list_pending(&connection, limit.unwrap_or(500))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_sync_conflicts(
    database: State<'_, Database>,
    include_resolved: Option<bool>,
    limit: Option<i64>,
) -> Result<Vec<SyncConflict>, String> {
    let connection = database.connect().map_err(|error| error.to_string())?;
    sync_repository::list_conflicts(
        &connection,
        include_resolved.unwrap_or(false),
        limit.unwrap_or(100),
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_sync_devices(database: State<'_, Database>) -> Result<Vec<SyncDevice>, String> {
    let connection = database.connect().map_err(|error| error.to_string())?;
    sync_repository::list_devices(&connection).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn revoke_sync_device(
    app: AppHandle,
    database: State<'_, Database>,
    runtime: State<'_, SyncRuntime>,
    device_id: String,
) -> Result<(), String> {
    service::revoke_sync_device(&app, &database, &runtime, &device_id).await
}

#[tauri::command]
pub async fn cleanup_sync_history(
    app: AppHandle,
    database: State<'_, Database>,
    runtime: State<'_, SyncRuntime>,
) -> Result<SyncCleanupResult, String> {
    service::cleanup_sync_history(&app, &database, &runtime).await
}

#[tauri::command]
pub fn export_sync_diagnostics(
    app: AppHandle,
    database: State<'_, Database>,
) -> Result<String, String> {
    let connection = database.connect().map_err(|error| error.to_string())?;
    let status = sync_repository::status(&connection).map_err(|error| error.to_string())?;
    let database_status = database.status().map_err(|error| error.to_string())?;
    let enabled_devices = sync_repository::list_devices(&connection)
        .map_err(|error| error.to_string())?
        .into_iter()
        .filter(|device| device.enabled)
        .count();
    let server_host = status
        .server_url
        .as_deref()
        .and_then(|url| reqwest::Url::parse(url).ok())
        .and_then(|url| url.host_str().map(str::to_owned));
    let error_category = status.last_error.as_deref().map(classify_diagnostic_error);
    let attachment_diagnostics = AttachmentRepository::new(&database)
        .diagnostics()
        .map_err(|error| error.to_string())?;
    let payload = json!({
        "format": "torder-sync-diagnostics",
        "formatVersion": 1,
        "generatedAt": Utc::now().to_rfc3339(),
        "appVersion": env!("CARGO_PKG_VERSION"),
        "platform": std::env::consts::OS,
        "schemaVersion": database_status.schema_version,
        "sync": {
            "state": status.state,
            "configured": status.configured,
            "hasCredential": status.has_credential,
            "serverHost": server_host,
            "remotePathConfigured": status.remote_path.is_some(),
            "pendingChanges": status.pending_changes,
            "conflictCount": status.conflict_count,
            "enabledDeviceCount": enabled_devices,
            "lastSyncAt": status.last_sync_at,
            "lastErrorCategory": error_category,
        },
        "attachments": attachment_diagnostics,
    });
    let export_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("exports");
    std::fs::create_dir_all(&export_dir).map_err(|error| error.to_string())?;
    let filename = format!(
        "torder-sync-diagnostics-{}.json",
        Utc::now().format("%Y%m%dT%H%M%SZ")
    );
    let path = export_dir.join(filename);
    let contents = serde_json::to_vec_pretty(&payload).map_err(|error| error.to_string())?;
    std::fs::write(&path, contents).map_err(|error| error.to_string())?;
    Ok(path.display().to_string())
}

fn classify_diagnostic_error(error: &str) -> &'static str {
    if error.contains("HTTP 401") || error.contains("HTTP 403") {
        "authentication"
    } else if error.contains("HTTP 404") || error.contains("HTTP 409") {
        "remote-path"
    } else if error.contains("HTTP 429") || error.contains("HTTP 5") {
        "remote-server"
    } else if error.contains("timed out") || error.contains("timeout") {
        "timeout"
    } else if is_sync_protocol_error(error) {
        "protocol"
    } else {
        "other"
    }
}

fn is_sync_protocol_error(error: &str) -> bool {
    error.contains("incompatible")
        || error.contains("invalid remote")
        || error.contains("invalid sync")
        || error.contains("unsupported sync")
        || error.contains("sync payload")
}

#[tauri::command]
pub fn resolve_sync_conflict(
    app: AppHandle,
    database: State<'_, Database>,
    conflict_id: String,
    resolution: String,
    merged_payload: Option<serde_json::Value>,
) -> Result<(), String> {
    engine::resolve_conflict_with_payload(&database, &conflict_id, &resolution, merged_payload)
        .map_err(|error| error.to_string())?;
    app.emit("sync-completed", ())
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn test_sync_connection(
    database: State<'_, Database>,
    server_url: String,
    username: Option<String>,
    password: Option<String>,
    remote_path: String,
) -> Result<SyncRemoteInspection, String> {
    let connection = database.connect().map_err(|error| error.to_string())?;
    let username = username.or_else(|| {
        sync_repository::get_state(&connection, "username")
            .ok()
            .flatten()
    });
    let password = match password.filter(|value| !value.is_empty()) {
        Some(password) => Some(password),
        None => crate::sync::credentials::load(&connection).map_err(|error| error.to_string())?,
    };
    match tokio::time::timeout(
        Duration::from_secs(35),
        engine::inspect_remote(&server_url, &remote_path, username, password),
    )
    .await
    {
        Ok(result) => result.map_err(|error| error.to_string()),
        Err(_) => Err("WebDAV connection test timed out after 35 seconds".to_owned()),
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn save_sync_config(
    database: State<'_, Database>,
    runtime: State<'_, crate::sync::SyncRuntime>,
    server_url: String,
    remote_path: String,
    username: Option<String>,
    password: Option<String>,
    device_name: Option<String>,
    encryption_enabled: bool,
    encryption_password: Option<String>,
    confirm_remote: bool,
) -> Result<SyncStatus, String> {
    service::save_sync_config(
        &runtime,
        &database,
        server_url,
        remote_path,
        username,
        password,
        device_name,
        encryption_enabled,
        encryption_password,
        confirm_remote,
    )
    .await
}

#[tauri::command]
pub fn remove_sync_config(database: State<'_, Database>) -> Result<(), String> {
    let mut connection = database.connect().map_err(|error| error.to_string())?;
    crate::sync::credentials::remove(&connection).map_err(|error| error.to_string())?;
    crate::sync::credentials::remove_encryption_keys(&connection)
        .map_err(|error| error.to_string())?;
    sync_repository::clear_local_sync_data(&mut connection).map_err(|error| error.to_string())?;
    for key in [
        "serverUrl",
        "remotePath",
        "username",
        "lastSyncAt",
        "lastError",
        "remoteConfirmedFor",
        "collectionId",
        "lastRemoteSequence",
        "remotePrunedSequence",
        "syncPhase",
        "syncStartedAt",
        "encryptionConfig",
    ] {
        sync_repository::clear_state(&connection, key).map_err(|error| error.to_string())?;
    }
    sync_repository::set_state(&connection, "syncStatus", "disabled")
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn rotate_sync_encryption(
    app: AppHandle,
    database: State<'_, Database>,
    runtime: State<'_, SyncRuntime>,
    new_password: String,
) -> Result<(), String> {
    service::rotate_sync_encryption(&app, &database, &runtime, new_password).await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn run_sync(
    app: AppHandle,
    database: State<'_, Database>,
    runtime: State<'_, SyncRuntime>,
    server_url: Option<String>,
    remote_path: Option<String>,
    username: Option<String>,
    password: Option<String>,
    initial_mode: Option<String>,
) -> Result<(), String> {
    service::run_sync(
        &app,
        &database,
        &runtime,
        server_url,
        remote_path,
        username,
        password,
        initial_mode,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::{classify_diagnostic_error, is_sync_protocol_error};

    #[test]
    fn diagnostic_error_categories_are_stable_and_secret_free() {
        assert_eq!(
            classify_diagnostic_error("WebDAV server returned HTTP 401"),
            "authentication"
        );
        assert_eq!(
            classify_diagnostic_error("WebDAV server returned HTTP 404"),
            "remote-path"
        );
        assert_eq!(
            classify_diagnostic_error("WebDAV server returned HTTP 503"),
            "remote-server"
        );
        assert_eq!(
            classify_diagnostic_error("sync timed out after 120 seconds"),
            "timeout"
        );
        assert_eq!(
            classify_diagnostic_error("incompatible sync collection"),
            "protocol"
        );
        assert_eq!(
            classify_diagnostic_error("invalid remote manifest"),
            "protocol"
        );
        assert_eq!(classify_diagnostic_error("password=secret"), "other");
    }

    #[test]
    fn protocol_errors_are_marked_non_retryable() {
        assert!(is_sync_protocol_error("invalid remote manifest"));
        assert!(is_sync_protocol_error("invalid sync change batch"));
        assert!(is_sync_protocol_error("sync payload has unknown field"));
        assert!(!is_sync_protocol_error("WebDAV request timed out"));
    }
}
