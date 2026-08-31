// 加密配置探测与轮换。

use super::*;


use chrono::{SecondsFormat, Utc};

use crate::db::{
    sync_repository, Database,
};
use crate::error::{RepositoryError, RepositoryResult};
use crate::sync::crypto::{self};
use crate::sync::manifest::{
    ChangeBatch, EncryptionConfig, Manifest,
};
use crate::sync::webdav::{WebDavClient, WebDavError};

pub async fn fetch_remote_encryption_config(
    server_url: &str,
    remote_path: &str,
    username: Option<String>,
    password: Option<String>,
) -> RepositoryResult<Option<EncryptionConfig>> {
    let client = WebDavClient::new(server_url, username, password)
        .map_err(|error| RepositoryError::Tauri(error.to_string()))?;
    let root = validated_remote_root(remote_path)?;
    let path = format!("{root}/manifest.json");
    Ok(read_remote_manifest(&client, &path)
        .await?
        .and_then(|manifest| manifest.encryption))
}

/// Rotate the collection key without rewriting historical change batches.
///
/// A new snapshot becomes the hand-off point: devices that have not seen the
/// old history can restore it directly, while existing devices can continue
/// to use their retained key until they acknowledge the new snapshot.
pub async fn rotate_encryption(
    database: &Database,
    server_url: &str,
    remote_path: &str,
    username: Option<String>,
    password: Option<String>,
    new_password: &str,
) -> RepositoryResult<()> {
    let connection = database.connect()?;
    let expected_confirmation = confirmation_key(server_url, remote_path);
    if sync_repository::get_state(&connection, "remoteConfirmedFor")?.as_deref()
        != Some(expected_confirmation.as_str())
    {
        return Err(RepositoryError::Validation(
            "remote sync directory is not confirmed",
        ));
    }
    drop(connection);

    let client = WebDavClient::new(server_url, username, password)
        .map_err(|error| RepositoryError::Tauri(error.to_string()))?;
    rotate_encryption_with_client(database, &client, remote_path, new_password).await
}

pub(crate) async fn rotate_encryption_with_client(
    database: &Database,
    client: &WebDavClient,
    remote_path: &str,
    new_password: &str,
) -> RepositoryResult<()> {
    let mut connection = database.connect()?;
    if sync_repository::pending_count(&connection)? > 0 {
        return Err(RepositoryError::Validation(
            "finish uploading pending sync changes before rotating the encryption key",
        ));
    }
    bootstrap_existing_objects(&mut connection)?;
    if sync_repository::pending_count(&connection)? > 0 {
        return Err(RepositoryError::Validation(
            "finish uploading pending sync changes before rotating the encryption key",
        ));
    }
    let local_config = sync_repository::get_state(&connection, "encryptionConfig")?
        .map(|value| {
            serde_json::from_str::<EncryptionConfig>(&value).map_err(|_| {
                RepositoryError::Validation("invalid local sync encryption configuration")
            })
        })
        .transpose()?;
    if let Some(config) = local_config.as_ref() {
        let _old_context = encryption_context(&connection, Some(config))?;
    }
    let root = validated_remote_root(remote_path)?;
    let manifest_path = format!("{root}/manifest.json");
    let (manifest_value, manifest_etag) = client
        .get_json_with_etag(&manifest_path)
        .await
        .map_err(|error| RepositoryError::Tauri(error.to_string()))?;
    let mut manifest: Manifest = serde_json::from_value(manifest_value)
        .map_err(|_| RepositoryError::Validation("invalid remote manifest"))?;
    validate_manifest(&manifest)?;
    let local_sequence = sync_repository::get_state(&connection, "lastRemoteSequence")?
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(0);
    if local_sequence < manifest.latest_sequence {
        return Err(RepositoryError::Validation(
            "sync with the remote collection before rotating the encryption key",
        ));
    }
    if sync_repository::status(&connection)?.conflict_count > 0 {
        return Err(RepositoryError::Validation(
            "resolve sync conflicts before rotating the encryption key",
        ));
    }
    if manifest.encryption.as_ref() != local_config.as_ref() {
        return Err(RepositoryError::Validation(
            "local and remote encryption configurations do not match",
        ));
    }
    let previous_sequence = manifest.latest_sequence;
    let sequence = previous_sequence
        .checked_add(1)
        .ok_or(RepositoryError::Validation("sync sequence overflow"))?;
    let (new_config, new_key) = crypto::create_config(new_password)?;

    let mut connection = database.connect()?;
    let local_device_id = device_id(&connection)?;
    let synced_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    let mut snapshot = build_snapshot(&mut connection, sequence)?;
    snapshot.created_at = synced_at.clone();
    let new_context = EncryptionContext {
        config: new_config.clone(),
        key: new_key.clone(),
    };
    encrypt_operations(&mut snapshot.operations, Some(&new_context))?;
    let snapshot_payload = encode_snapshot(&snapshot)?;
    let empty_batch = ChangeBatch {
        protocol: PROTOCOL,
        sequence,
        device_id: local_device_id.clone(),
        created_at: synced_at.clone(),
        operations: Vec::new(),
    };
    let batch_path = format!("{root}/changes/{sequence:020}.json");
    let batch_value = serde_json::to_value(&empty_batch)?;
    match client
        .put_json_if_none_match(&batch_path, &batch_value)
        .await
    {
        Ok(()) => {}
        Err(WebDavError::Http(status)) if status == reqwest::StatusCode::PRECONDITION_FAILED => {
            let existing = client
                .get_json(&batch_path)
                .await
                .map_err(|error| RepositoryError::Tauri(error.to_string()))?;
            if existing != batch_value {
                return Err(RepositoryError::Tauri(
                    "remote sequence was claimed by another device; retry key rotation".to_owned(),
                ));
            }
        }
        Err(error) => return Err(RepositoryError::Tauri(error.to_string())),
    }
    let snapshot_path = format!("{root}/snapshots/{sequence:020}.json.gz");
    match client
        .put_snapshot_if_none_match(&snapshot_path, snapshot_payload.clone())
        .await
    {
        Ok(()) => {}
        Err(WebDavError::Http(status)) if status == reqwest::StatusCode::PRECONDITION_FAILED => {
            let existing = client
                .get_snapshot(&snapshot_path)
                .await
                .map_err(|error| RepositoryError::Tauri(error.to_string()))?;
            if existing != snapshot_payload {
                return Err(RepositoryError::Tauri(
                    "remote snapshot sequence was claimed by another device; retry key rotation"
                        .to_owned(),
                ));
            }
        }
        Err(error) => return Err(RepositoryError::Tauri(error.to_string())),
    }
    let verified_snapshot = client
        .get_snapshot(&snapshot_path)
        .await
        .map_err(|error| RepositoryError::Tauri(error.to_string()))?;
    if verified_snapshot != snapshot_payload {
        return Err(RepositoryError::Tauri(
            "remote snapshot verification failed; key rotation was not finalized".to_owned(),
        ));
    }

    refresh_manifest_devices(
        &mut manifest,
        &connection,
        &local_device_id,
        &synced_at,
        sequence,
    )?;
    manifest.encryption = Some(new_config.clone());
    manifest.latest_sequence = sequence;
    manifest.snapshot_sequence = sequence;
    manifest.updated_at = synced_at.clone();
    let verified_manifest = put_manifest(
        client,
        &manifest_path,
        &manifest,
        manifest_etag.as_deref(),
        previous_sequence,
        &local_device_id,
    )
    .await?;

    let mut stored = crate::sync::credentials::load_encryption_keys(&connection)?;
    crypto::add_stored_key(&mut stored, &new_config.key_id, &new_key, true);
    crate::sync::credentials::store_encryption_keys(&connection, &stored)?;
    sync_repository::set_state(
        &connection,
        "encryptionConfig",
        &serde_json::to_string(&new_config)?,
    )?;
    sync_repository::set_state(&connection, "lastRemoteSequence", &sequence.to_string())?;
    sync_repository::set_state(&connection, "lastSyncAt", &synced_at)?;
    sync_repository::clear_state(&connection, "lastError")?;
    sync_repository::update_device_sync(&connection, &local_device_id, &synced_at, sequence)?;

    let already_pruned = remote_pruned_sequence(&connection)?;
    if let Ok(Some(pruned_sequence)) =
        cleanup_remote_history(client, &root, &verified_manifest, already_pruned).await
    {
        sync_repository::set_state(
            &connection,
            "remotePrunedSequence",
            &pruned_sequence.to_string(),
        )?;
    }
    Ok(())
}
