use tauri::{AppHandle, Emitter};

use crate::db::{attachment_repository::AttachmentRepository, sync_repository, Database};
use crate::models::{SyncCleanupResult, SyncStatus};
use crate::sync::credentials;
use crate::sync::engine;
use crate::sync::webdav::WebDavClient;
use crate::sync::SyncRuntime;

pub async fn revoke_sync_device(
    app: &AppHandle,
    database: &Database,
    runtime: &SyncRuntime,
    device_id: &str,
) -> Result<(), String> {
    let _guard = runtime.try_lock().map_err(str::to_owned)?;
    let connection = database.connect().map_err(|error| error.to_string())?;
    let server_url = sync_repository::get_state(&connection, "serverUrl")
        .map_err(|error| error.to_string())?
        .ok_or("sync server URL is not configured")?;
    let remote_path = sync_repository::get_state(&connection, "remotePath")
        .map_err(|error| error.to_string())?
        .ok_or("sync remote path is not configured")?;
    let username =
        sync_repository::get_state(&connection, "username").map_err(|error| error.to_string())?;
    let password = credentials::load(&connection).map_err(|error| error.to_string())?;
    drop(connection);

    let revoke_result = match tokio::time::timeout(
        std::time::Duration::from_secs(120),
        engine::revoke_remote_device(
            database,
            &server_url,
            &remote_path,
            username,
            password,
            device_id,
        ),
    )
    .await
    {
        Ok(result) => result.map_err(|error| error.to_string()),
        Err(_) => Err("device revocation timed out after 120 seconds".to_owned()),
    };
    if let Err(error) = revoke_result {
        record_sync_command_error(database, &error);
        return Err(error);
    }
    app.emit("sync-completed", ())
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub async fn cleanup_sync_history(
    app: &AppHandle,
    database: &Database,
    runtime: &SyncRuntime,
) -> Result<SyncCleanupResult, String> {
    let _guard = runtime.try_lock().map_err(str::to_owned)?;
    let connection = database.connect().map_err(|error| error.to_string())?;
    let server_url = sync_repository::get_state(&connection, "serverUrl")
        .map_err(|error| error.to_string())?
        .ok_or("sync server URL is not configured")?;
    let remote_path = sync_repository::get_state(&connection, "remotePath")
        .map_err(|error| error.to_string())?
        .ok_or("sync remote path is not configured")?;
    let username =
        sync_repository::get_state(&connection, "username").map_err(|error| error.to_string())?;
    let password = credentials::load(&connection).map_err(|error| error.to_string())?;
    drop(connection);

    let cleanup_result = match tokio::time::timeout(
        std::time::Duration::from_secs(120),
        engine::cleanup_remote_history_now(database, &server_url, &remote_path, username, password),
    )
    .await
    {
        Ok(result) => result.map_err(|error| error.to_string()),
        Err(_) => Err("sync history cleanup timed out after 120 seconds".to_owned()),
    };
    let remote_attachment_blobs_removed = match cleanup_result {
        Ok(value) => value,
        Err(error) => {
            record_sync_command_error(database, &error);
            return Err(error);
        }
    };

    let connection = database.connect().map_err(|error| error.to_string())?;
    let mut result =
        sync_repository::prune_history(&connection).map_err(|error| error.to_string())?;
    drop(connection);
    let data_dir = database.data_dir().map_err(|error| error.to_string())?;
    let (attachment_blobs_removed, attachment_bytes_removed) = AttachmentRepository::new(database)
        .cleanup_orphan_blobs(&data_dir, 30)
        .map_err(|error| error.to_string())?;
    result.attachment_blobs_removed = attachment_blobs_removed;
    result.attachment_bytes_removed = attachment_bytes_removed;
    result.remote_attachment_blobs_removed = remote_attachment_blobs_removed;
    app.emit("sync-completed", ())
        .map_err(|error| error.to_string())?;
    Ok(result)
}

pub async fn save_sync_config(
    database: &Database,
    server_url: String,
    remote_path: String,
    username: Option<String>,
    password: Option<String>,
    device_name: Option<String>,
    encryption_enabled: bool,
    encryption_password: Option<String>,
    confirm_remote: bool,
) -> Result<SyncStatus, String> {
    let normalized_server_url = server_url.trim().to_owned();
    let normalized_remote_path = remote_path.trim().to_owned();
    let username_provided = username.is_some();
    let normalized_username = username.and_then(|value| {
        let value = value.trim().to_owned();
        (!value.is_empty()).then_some(value)
    });
    let normalized_password = password.filter(|value| !value.is_empty());
    let normalized_device_name = normalize_device_name(device_name)?;
    WebDavClient::new(&normalized_server_url, None, None).map_err(|error| error.to_string())?;
    let mut connection = database.connect().map_err(|error| error.to_string())?;
    let existing_server_url =
        sync_repository::get_state(&connection, "serverUrl").map_err(|error| error.to_string())?;
    let existing_remote_path =
        sync_repository::get_state(&connection, "remotePath").map_err(|error| error.to_string())?;
    if existing_server_url
        .as_deref()
        .is_some_and(|value| value != normalized_server_url.as_str())
        || existing_remote_path
            .as_deref()
            .is_some_and(|value| value != normalized_remote_path.as_str())
    {
        return Err(
            "remove the existing sync configuration before changing the WebDAV server or directory"
                .to_owned(),
        );
    }
    let stored_username =
        sync_repository::get_state(&connection, "username").map_err(|error| error.to_string())?;
    let webdav_username = if username_provided {
        normalized_username.clone()
    } else {
        stored_username
    };
    let stored_password = credentials::load(&connection).map_err(|error| error.to_string())?;
    let webdav_password = normalized_password.clone().or(stored_password);
    let inspection = engine::inspect_remote(
        &normalized_server_url,
        &normalized_remote_path,
        webdav_username.clone(),
        webdav_password.clone(),
    )
    .await
    .map_err(|error| error.to_string())?;
    let remote_encryption = engine::fetch_remote_encryption_config(
        &normalized_server_url,
        &normalized_remote_path,
        webdav_username,
        webdav_password,
    )
    .await
    .map_err(|error| error.to_string())?;
    let mut encryption_keys_to_store = None;
    let encryption_config = match remote_encryption {
        Some(config) => {
            if !encryption_enabled {
                return Err("remote sync collection requires end-to-end encryption".to_owned());
            }
            if let Some(encryption_password) = encryption_password
                .as_deref()
                .filter(|value| !value.is_empty())
            {
                let key = crate::sync::crypto::derive_key(&config, encryption_password)
                    .map_err(|error| error.to_string())?;
                let mut stored = credentials::load_encryption_keys(&connection)
                    .map_err(|error| error.to_string())?;
                crate::sync::crypto::add_stored_key(&mut stored, &config.key_id, &key, true);
                encryption_keys_to_store = Some(stored);
            } else if !credentials::has_encryption_key(&connection, &config.key_id)
                .map_err(|error| error.to_string())?
            {
                return Err("sync encryption password is required on this device".to_owned());
            }
            Some(config)
        }
        None if encryption_enabled && inspection.initialized => {
            return Err(
                "configure the existing collection first, then enable encryption by rotating the sync key"
                    .to_owned(),
            );
        }
        None if encryption_enabled => {
            let encryption_password = encryption_password
                .as_deref()
                .filter(|value| !value.is_empty())
                .ok_or("sync encryption password is required")?;
            let (config, key) = crate::sync::crypto::create_config(encryption_password)
                .map_err(|error| error.to_string())?;
            let mut stored = credentials::load_encryption_keys(&connection)
                .map_err(|error| error.to_string())?;
            crate::sync::crypto::add_stored_key(&mut stored, &config.key_id, &key, true);
            encryption_keys_to_store = Some(stored);
            Some(config)
        }
        None => None,
    };
    let confirmation_key =
        engine::confirmation_key(&normalized_server_url, &normalized_remote_path);
    let already_confirmed = sync_repository::get_state(&connection, "remoteConfirmedFor")
        .map_err(|error| error.to_string())?
        .as_deref()
        == Some(confirmation_key.as_str());
    if inspection.requires_confirmation && !confirm_remote && !already_confirmed {
        return Err("remote sync directory requires explicit confirmation".to_owned());
    }
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    sync_repository::set_state(&transaction, "serverUrl", &normalized_server_url)
        .map_err(|error| error.to_string())?;
    sync_repository::set_state(&transaction, "remotePath", &normalized_remote_path)
        .map_err(|error| error.to_string())?;
    if username_provided {
        match normalized_username.as_deref() {
            Some(username) => sync_repository::set_state(&transaction, "username", username)
                .map_err(|error| error.to_string())?,
            None => sync_repository::clear_state(&transaction, "username")
                .map_err(|error| error.to_string())?,
        }
    }
    if let Some(device_name) = normalized_device_name {
        sync_repository::set_state(&transaction, "deviceName", &device_name)
            .map_err(|error| error.to_string())?;
    }
    if let Some(password) = normalized_password {
        credentials::store(&transaction, &password).map_err(|error| error.to_string())?;
    }
    if let Some(keys) = encryption_keys_to_store {
        credentials::store_encryption_keys(&transaction, &keys)
            .map_err(|error| error.to_string())?;
    }
    if let Some(config) = encryption_config {
        sync_repository::set_state(
            &transaction,
            "encryptionConfig",
            &serde_json::to_string(&config).map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
    } else {
        // If encryption was previously enabled locally but the confirmed
        // remote collection is now unencrypted, remove the stale key material
        // from the system credential store instead of merely dropping its
        // database pointer.
        credentials::remove_encryption_keys(&transaction).map_err(|error| error.to_string())?;
        sync_repository::clear_state(&transaction, "encryptionConfig")
            .map_err(|error| error.to_string())?;
    }
    sync_repository::set_state(&transaction, "syncStatus", "configured")
        .map_err(|error| error.to_string())?;
    sync_repository::clear_state(&transaction, "lastError").map_err(|error| error.to_string())?;
    sync_repository::clear_state(&transaction, "syncPhase").map_err(|error| error.to_string())?;
    sync_repository::clear_state(&transaction, "syncStartedAt")
        .map_err(|error| error.to_string())?;
    sync_repository::set_state(&transaction, "remoteConfirmedFor", &confirmation_key)
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    sync_repository::status(&connection).map_err(|error| error.to_string())
}

fn normalize_device_name(device_name: Option<String>) -> Result<Option<String>, String> {
    device_name
        .map(|value| {
            let value = value.trim().to_owned();
            if value.is_empty() || value.chars().count() > 128 {
                Err("sync device name must contain 1 to 128 characters".to_owned())
            } else {
                Ok(value)
            }
        })
        .transpose()
}

pub async fn rotate_sync_encryption(
    app: &AppHandle,
    database: &Database,
    runtime: &SyncRuntime,
    new_password: String,
) -> Result<(), String> {
    let _guard = runtime.try_lock().map_err(str::to_owned)?;
    let connection = database.connect().map_err(|error| error.to_string())?;
    let server_url = sync_repository::get_state(&connection, "serverUrl")
        .map_err(|error| error.to_string())?
        .ok_or("sync server URL is not configured")?;
    let remote_path = sync_repository::get_state(&connection, "remotePath")
        .map_err(|error| error.to_string())?
        .ok_or("sync remote path is not configured")?;
    let username =
        sync_repository::get_state(&connection, "username").map_err(|error| error.to_string())?;
    let password = credentials::load(&connection).map_err(|error| error.to_string())?;
    sync_repository::set_state(&connection, "syncStatus", "syncing")
        .map_err(|error| error.to_string())?;
    sync_repository::set_state(&connection, "syncPhase", "prepare")
        .map_err(|error| error.to_string())?;
    sync_repository::set_state(
        &connection,
        "syncStartedAt",
        &chrono::Utc::now().to_rfc3339(),
    )
    .map_err(|error| error.to_string())?;
    drop(connection);

    let sync_result = match tokio::time::timeout(
        std::time::Duration::from_secs(120),
        engine::rotate_encryption(
            database,
            &server_url,
            &remote_path,
            username,
            password,
            &new_password,
        ),
    )
    .await
    {
        Ok(result) => result,
        Err(_) => Err(crate::error::RepositoryError::Tauri(
            "sync encryption key rotation timed out after 120 seconds".to_owned(),
        )),
    };
    match sync_result {
        Ok(()) => {
            let connection = database.connect().map_err(|error| error.to_string())?;
            let status = sync_repository::status(&connection).map_err(|error| error.to_string())?;
            sync_repository::set_state(
                &connection,
                "syncStatus",
                if status.conflict_count > 0 {
                    "needsConflict"
                } else {
                    "success"
                },
            )
            .map_err(|error| error.to_string())?;
            sync_repository::clear_state(&connection, "syncPhase")
                .map_err(|error| error.to_string())?;
            sync_repository::clear_state(&connection, "syncStartedAt")
                .map_err(|error| error.to_string())?;
            app.emit("sync-completed", ())
                .map_err(|error| error.to_string())?;
            Ok(())
        }
        Err(error) => {
            if let Ok(connection) = database.connect() {
                let _ = sync_repository::set_state(&connection, "syncStatus", "error");
                let _ = sync_repository::set_state(&connection, "lastError", &error.to_string());
                let _ = sync_repository::clear_state(&connection, "syncPhase");
                let _ = sync_repository::clear_state(&connection, "syncStartedAt");
            }
            Err(error.to_string())
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub async fn run_sync(
    app: &AppHandle,
    database: &Database,
    runtime: &SyncRuntime,
    server_url: Option<String>,
    remote_path: Option<String>,
    username: Option<String>,
    password: Option<String>,
    initial_mode: Option<String>,
) -> Result<(), String> {
    let _guard = runtime.try_lock().map_err(str::to_owned)?;
    let initial_mode = engine::InitialSyncMode::parse(initial_mode.as_deref())
        .map_err(|error| error.to_string())?;
    let connection = database.connect().map_err(|error| error.to_string())?;
    let server_url = server_url
        .or_else(|| {
            sync_repository::get_state(&connection, "serverUrl")
                .ok()
                .flatten()
        })
        .ok_or("sync server URL is not configured")?;
    let remote_path = remote_path
        .or_else(|| {
            sync_repository::get_state(&connection, "remotePath")
                .ok()
                .flatten()
        })
        .ok_or("sync remote path is not configured")?;
    let username = username.or_else(|| {
        sync_repository::get_state(&connection, "username")
            .ok()
            .flatten()
    });
    let password = match password {
        Some(password) => Some(password),
        None => credentials::load(&connection).map_err(|error| error.to_string())?,
    };
    sync_repository::set_state(&connection, "syncStatus", "syncing")
        .map_err(|error| error.to_string())?;
    sync_repository::set_state(&connection, "syncPhase", "prepare")
        .map_err(|error| error.to_string())?;
    sync_repository::set_state(
        &connection,
        "syncStartedAt",
        &chrono::Utc::now().to_rfc3339(),
    )
    .map_err(|error| error.to_string())?;
    drop(connection);
    let sync_result = match tokio::time::timeout(
        std::time::Duration::from_secs(120),
        engine::run_with_mode(
            database,
            &server_url,
            &remote_path,
            username,
            password,
            initial_mode,
        ),
    )
    .await
    {
        Ok(result) => result,
        Err(_) => Err(crate::error::RepositoryError::Tauri(
            "sync timed out after 120 seconds".to_owned(),
        )),
    };
    match sync_result {
        Ok(()) => {
            let connection = database.connect().map_err(|error| error.to_string())?;
            let status = sync_repository::status(&connection).map_err(|error| error.to_string())?;
            let state = if status.conflict_count > 0 {
                "needsConflict"
            } else {
                "success"
            };
            sync_repository::set_state(&connection, "syncStatus", state)
                .map_err(|error| error.to_string())?;
            sync_repository::clear_state(&connection, "syncPhase")
                .map_err(|error| error.to_string())?;
            sync_repository::clear_state(&connection, "syncStartedAt")
                .map_err(|error| error.to_string())?;
            let _ = sync_repository::prune_history(&connection);
            app.emit("sync-completed", ())
                .map_err(|error| error.to_string())?;
            Ok(())
        }
        Err(error) => {
            if let Ok(connection) = database.connect() {
                let message = error.to_string();
                let state = sync_error_state(&message);
                let _ = sync_repository::set_state(&connection, "syncStatus", state);
                let _ = sync_repository::set_state(&connection, "lastError", &error.to_string());
                let _ = sync_repository::clear_state(&connection, "syncPhase");
                let _ = sync_repository::clear_state(&connection, "syncStartedAt");
            }
            Err(error.to_string())
        }
    }
}

fn is_sync_protocol_error(message: &str) -> bool {
    message.contains("incompatible")
        || message.contains("invalid remote")
        || message.contains("invalid sync")
        || message.contains("unsupported sync")
        || message.contains("sync payload")
}

fn sync_error_state(message: &str) -> &'static str {
    if message.contains("HTTP 401")
        || message.contains("HTTP 403")
        || message.contains("credential")
        || message.contains("password is required")
    {
        "needsAuth"
    } else if is_sync_protocol_error(message) {
        "incompatible"
    } else {
        "error"
    }
}

fn record_sync_command_error(database: &Database, message: &str) {
    if let Ok(connection) = database.connect() {
        let _ = sync_repository::set_state(&connection, "syncStatus", sync_error_state(message));
        let _ = sync_repository::set_state(&connection, "lastError", message);
        let _ = sync_repository::clear_state(&connection, "syncPhase");
        let _ = sync_repository::clear_state(&connection, "syncStartedAt");
    }
}

#[cfg(test)]
mod tests {
    use super::{is_sync_protocol_error, normalize_device_name, sync_error_state};

    #[test]
    fn device_name_is_validated_before_configuration_writes() {
        assert_eq!(
            normalize_device_name(Some("  Windows 工作台  ".to_owned())).unwrap(),
            Some("Windows 工作台".to_owned())
        );
        assert!(normalize_device_name(Some("   ".to_owned())).is_err());
        assert!(normalize_device_name(Some("x".repeat(129))).is_err());
        assert!(normalize_device_name(Some("龙".repeat(128))).is_ok());
        assert!(normalize_device_name(Some("龙".repeat(129))).is_err());
        assert_eq!(normalize_device_name(None).unwrap(), None);
    }

    #[test]
    fn protocol_errors_are_marked_non_retryable() {
        assert!(is_sync_protocol_error("invalid remote manifest"));
        assert!(is_sync_protocol_error("invalid sync change batch"));
        assert!(is_sync_protocol_error("sync payload has unknown field"));
        assert!(!is_sync_protocol_error("WebDAV request timed out"));
    }

    #[test]
    fn command_failures_map_to_visible_sync_states() {
        assert_eq!(
            sync_error_state("WebDAV server returned HTTP 401"),
            "needsAuth"
        );
        assert_eq!(sync_error_state("invalid remote manifest"), "incompatible");
        assert_eq!(
            sync_error_state("remote sync lock is held; retry later"),
            "error"
        );
    }
}
