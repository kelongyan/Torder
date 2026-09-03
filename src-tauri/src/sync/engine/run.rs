// 同步编排主干：InitialSyncMode、run_with_mode、run_with_client_once、上传批次。

use super::*;

use chrono::{SecondsFormat, Utc};
use serde_json::Value;

use crate::db::{recurring_repository::RecurringRuleRepository, sync_repository, Database};
use crate::error::{RepositoryError, RepositoryResult};
use crate::models::SyncChange;
use crate::sync::manifest::{ChangeBatch, ChangeOperation, EncryptionConfig, Manifest};
use crate::sync::webdav::{WebDavClient, WebDavError};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InitialSyncMode {
    Merge,
    Upload,
    Download,
}

impl InitialSyncMode {
    pub fn parse(value: Option<&str>) -> RepositoryResult<Self> {
        match value.unwrap_or("merge") {
            "merge" => Ok(Self::Merge),
            "upload" => Ok(Self::Upload),
            "download" => Ok(Self::Download),
            _ => Err(RepositoryError::Validation("invalid initial sync mode")),
        }
    }
}

pub(crate) fn validate_initial_sync_mode(
    mode: InitialSyncMode,
    pending_changes: i64,
    remote_latest_sequence: i64,
) -> RepositoryResult<()> {
    if mode == InitialSyncMode::Download && pending_changes > 0 {
        return Err(RepositoryError::Validation(
            "download-only sync requires no local pending changes",
        ));
    }
    if mode == InitialSyncMode::Upload && remote_latest_sequence > 0 {
        return Err(RepositoryError::Validation(
            "upload-only sync requires an empty remote sync collection",
        ));
    }
    Ok(())
}

pub async fn run_with_mode(
    database: &Database,
    server_url: &str,
    remote_path: &str,
    username: Option<String>,
    password: Option<String>,
    initial_mode: InitialSyncMode,
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
    client
        .options()
        .await
        .map_err(|error| RepositoryError::Tauri(error.to_string()))?;
    run_with_client_mode(database, &client, remote_path, initial_mode).await
}

/// Disable a remote device in the manifest before marking it disabled locally.
/// This keeps revocation effective for other devices even when the revoked
/// device is currently offline.
pub async fn revoke_remote_device(
    database: &Database,
    server_url: &str,
    remote_path: &str,
    username: Option<String>,
    password: Option<String>,
    target_device_id: &str,
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
    let current_device_id = device_id(&connection)?;
    if current_device_id == target_device_id {
        return Err(RepositoryError::Validation(
            "current sync device cannot be revoked",
        ));
    }
    drop(connection);

    let client = WebDavClient::new(server_url, username, password)
        .map_err(|error| RepositoryError::Tauri(error.to_string()))?;
    client
        .options()
        .await
        .map_err(|error| RepositoryError::Tauri(error.to_string()))?;
    let root = validated_remote_root(remote_path)?;
    let manifest_path = format!("{root}/manifest.json");
    let (value, etag) = client
        .get_json_with_etag(&manifest_path)
        .await
        .map_err(|error| RepositoryError::Tauri(error.to_string()))?;
    let mut manifest: Manifest = serde_json::from_value(value)
        .map_err(|_| RepositoryError::Validation("invalid remote manifest"))?;
    validate_manifest(&manifest)?;
    let remote_device = manifest
        .devices
        .iter_mut()
        .find(|device| device.id == target_device_id)
        .ok_or(RepositoryError::NotFound("sync device"))?;
    remote_device.enabled = false;
    manifest.updated_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    put_manifest(
        &client,
        &manifest_path,
        &manifest,
        etag.as_deref(),
        manifest.latest_sequence,
        &current_device_id,
    )
    .await?;

    let connection = database.connect()?;
    sync_repository::revoke_device(&connection, target_device_id)
}

#[cfg(test)]
pub(crate) async fn revoke_remote_device_with_client(
    database: &Database,
    client: &WebDavClient,
    remote_path: &str,
    target_device_id: &str,
) -> RepositoryResult<()> {
    let connection = database.connect()?;
    let current_device_id = device_id(&connection)?;
    if current_device_id == target_device_id {
        return Err(RepositoryError::Validation(
            "current sync device cannot be revoked",
        ));
    }
    drop(connection);

    let root = validated_remote_root(remote_path)?;
    let manifest_path = format!("{root}/manifest.json");
    let (value, etag) = client
        .get_json_with_etag(&manifest_path)
        .await
        .map_err(|error| RepositoryError::Tauri(error.to_string()))?;
    let mut manifest: Manifest = serde_json::from_value(value)
        .map_err(|_| RepositoryError::Validation("invalid remote manifest"))?;
    validate_manifest(&manifest)?;
    let remote_device = manifest
        .devices
        .iter_mut()
        .find(|device| device.id == target_device_id)
        .ok_or(RepositoryError::NotFound("sync device"))?;
    remote_device.enabled = false;
    manifest.updated_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    put_manifest(
        client,
        &manifest_path,
        &manifest,
        etag.as_deref(),
        manifest.latest_sequence,
        &current_device_id,
    )
    .await?;

    let connection = database.connect()?;
    sync_repository::revoke_device(&connection, target_device_id)
}

#[cfg(test)]
pub(crate) async fn run_with_client(
    database: &Database,
    client: &WebDavClient,
    remote_path: &str,
) -> RepositoryResult<()> {
    run_with_client_mode(database, client, remote_path, InitialSyncMode::Merge).await
}

async fn run_with_client_mode(
    database: &Database,
    client: &WebDavClient,
    remote_path: &str,
    initial_mode: InitialSyncMode,
) -> RepositoryResult<()> {
    // A single remote batch is capped at 500 operations. Keep draining the
    // local queue in the same user-triggered sync so large offline edits do
    // not silently wait for a later lifecycle event.
    let mut first_pass = true;
    loop {
        let mode = if first_pass {
            first_pass = false;
            initial_mode
        } else {
            InitialSyncMode::Merge
        };
        run_with_client_once(database, client, remote_path, mode).await?;
        let connection = database.connect()?;
        if sync_repository::pending_count(&connection)? == 0 {
            return Ok(());
        }
    }
}

async fn run_with_client_once(
    database: &Database,
    client: &WebDavClient,
    remote_path: &str,
    initial_mode: InitialSyncMode,
) -> RepositoryResult<()> {
    let root = validated_remote_root(remote_path)?;
    for path in remote_collection_paths(&root) {
        match client.mkcol(&path).await {
            Ok(()) | Err(WebDavError::Http(reqwest::StatusCode::METHOD_NOT_ALLOWED)) => {}
            Err(WebDavError::Http(reqwest::StatusCode::CONFLICT)) => {}
            Err(error) => return Err(RepositoryError::Tauri(error.to_string())),
        }
    }

    let mut connection = database.connect()?;
    let local_encryption = sync_repository::get_state(&connection, "encryptionConfig")?
        .map(|value| {
            serde_json::from_str::<EncryptionConfig>(&value).map_err(|_| {
                RepositoryError::Validation("invalid local sync encryption configuration")
            })
        })
        .transpose()?;
    let manifest_path = format!("{root}/manifest.json");
    let (mut manifest, manifest_etag) =
        load_or_create_manifest(client, &manifest_path, local_encryption).await?;
    validate_manifest(&manifest)?;
    sync_repository::set_state(&connection, "syncPhase", "download")?;
    let encryption = encryption_context(&connection, manifest.encryption.as_ref())?;

    let local_device_id = device_id(&connection)?;
    sync_repository::ensure_device(&connection, &local_device_id, &device_name(&connection)?)?;
    for device in &manifest.devices {
        sync_repository::import_manifest_device(
            &connection,
            &device.id,
            &device.name,
            &device.last_seen_at,
            device.last_sequence,
            device.enabled,
        )?;
    }
    if !sync_repository::is_device_enabled(&connection, &local_device_id)? {
        return Err(RepositoryError::Validation(
            "this sync device has been revoked",
        ));
    }
    match sync_repository::get_state(&connection, "collectionId")? {
        Some(collection_id) if collection_id != manifest.collection_id => {
            return Err(RepositoryError::Validation("incompatible sync collection"));
        }
        Some(_) => {}
        None => sync_repository::set_state(&connection, "collectionId", &manifest.collection_id)?,
    }
    bootstrap_existing_objects(&mut connection)?;
    let initial_pending = sync_repository::pending_count(&connection)?;
    validate_initial_sync_mode(initial_mode, initial_pending, manifest.latest_sequence)?;
    let last_remote_sequence = sync_repository::get_state(&connection, "lastRemoteSequence")?
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(0);
    if last_remote_sequence > manifest.latest_sequence {
        return Err(RepositoryError::Validation(
            "remote sync history moved backwards",
        ));
    }
    let mut next_remote_sequence = last_remote_sequence
        .checked_add(1)
        .ok_or(RepositoryError::Validation("sync sequence overflow"))?;
    let should_pull = initial_mode != InitialSyncMode::Upload;
    if should_pull && last_remote_sequence < manifest.snapshot_sequence {
        let snapshot_payload = client
            .get_snapshot(&format!(
                "{root}/snapshots/{:020}.json.gz",
                manifest.snapshot_sequence
            ))
            .await
            .map_err(|error| RepositoryError::Tauri(error.to_string()))?;
        let mut snapshot = decode_snapshot(&snapshot_payload)?;
        if snapshot.sequence != manifest.snapshot_sequence {
            return Err(RepositoryError::Validation(
                "invalid remote snapshot sequence",
            ));
        }
        decrypt_operations(&mut snapshot.operations, encryption.as_ref())?;
        apply_snapshot(&mut connection, &snapshot)?;
        sync_repository::set_state(
            &connection,
            "lastRemoteSequence",
            &snapshot.sequence.to_string(),
        )?;
        next_remote_sequence = snapshot
            .sequence
            .checked_add(1)
            .ok_or(RepositoryError::Validation("sync sequence overflow"))?;
    }
    if should_pull {
        for sequence in next_remote_sequence..=manifest.latest_sequence {
            let batch_value = client
                .get_json(&format!("{root}/changes/{sequence:020}.json"))
                .await
                .map_err(|error| RepositoryError::Tauri(error.to_string()))?;
            let mut batch: ChangeBatch = serde_json::from_value(batch_value)
                .map_err(|_| RepositoryError::Validation("invalid remote change batch"))?;
            if !supported_protocol(batch.protocol) || batch.sequence != sequence {
                return Err(RepositoryError::Validation(
                    "invalid remote change sequence",
                ));
            }
            decrypt_operations(&mut batch.operations, encryption.as_ref())?;
            sync_repository::set_state(&connection, "syncPhase", "merge")?;
            apply_batch(&mut connection, &batch)?;
            sync_repository::ensure_device(
                &connection,
                &batch.device_id,
                &remote_device_name(&batch.device_id),
            )?;
            sync_repository::update_device_sync(
                &connection,
                &batch.device_id,
                &batch.created_at,
                sequence,
            )?;
            sync_repository::set_state(&connection, "lastRemoteSequence", &sequence.to_string())?;
        }
    }
    if should_pull {
        sync_repository::set_state(&connection, "syncPhase", "downloadBlobs")?;
        download_pending_attachment_blobs(database, client, &root, encryption.as_ref()).await?;
    }
    if initial_mode == InitialSyncMode::Download {
        RecurringRuleRepository::new(database).generate_due()?;
        let synced_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
        sync_repository::set_state(&connection, "lastSyncAt", &synced_at)?;
        sync_repository::update_device_sync(
            &connection,
            &local_device_id,
            &synced_at,
            manifest.latest_sequence,
        )?;
        sync_repository::clear_state(&connection, "lastError")?;
        sync_repository::clear_state(&connection, "syncPhase")?;
        return Ok(());
    }
    // Remote rule changes can make occurrences immediately due. Generate before
    // collecting pending changes so the resulting task changes join this upload.
    sync_repository::set_state(&connection, "syncPhase", "upload")?;
    RecurringRuleRepository::new(database).generate_due()?;
    let changes = sync_repository::list_pending(&connection, 500)?;
    if changes.is_empty() {
        let synced_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
        let latest_sequence = manifest.latest_sequence;
        refresh_manifest_devices(
            &mut manifest,
            &connection,
            &local_device_id,
            &synced_at,
            latest_sequence,
        )?;
        let previous_sequence = manifest.latest_sequence;
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
        sync_repository::set_state(&connection, "lastSyncAt", &synced_at)?;
        sync_repository::update_device_sync(
            &connection,
            &local_device_id,
            &synced_at,
            manifest.latest_sequence,
        )?;
        sync_repository::clear_state(&connection, "lastError")?;
        sync_repository::clear_state(&connection, "syncPhase")?;
        let already_pruned = remote_pruned_sequence(&connection)?;
        if let Ok(Some(sequence)) =
            cleanup_remote_history(client, &root, &verified_manifest, already_pruned).await
        {
            sync_repository::set_state(&connection, "remotePrunedSequence", &sequence.to_string())?;
        }
        return Ok(());
    }
    upload_attachment_blobs_for_changes(database, client, &root, &changes, encryption.as_ref())
        .await?;
    let pending_total = sync_repository::pending_count(&connection)?;
    let changes = sync_repository::list_pending(&connection, 500)?;
    let sequence = manifest
        .latest_sequence
        .checked_add(1)
        .ok_or(RepositoryError::Validation("sync sequence overflow"))?;
    let (batch, batch_value, operation_count) =
        build_upload_batch(&changes, sequence, &local_device_id, encryption.as_ref())?;
    refresh_manifest_devices(
        &mut manifest,
        &connection,
        &local_device_id,
        &batch.created_at,
        sequence,
    )?;
    let batch_path = format!("{root}/changes/{sequence:020}.json");
    put_change_batch_create_only(
        client,
        &batch_path,
        &batch_value,
        "remote sequence was claimed by another device; retry sync",
    )
    .await?;
    if pending_total <= MAX_BATCH_OPERATIONS as i64 && operation_count == changes.len() {
        let mut snapshot = build_snapshot(&mut connection, sequence)?;
        snapshot.created_at = batch.created_at.clone();
        if snapshot.operations.len() >= SNAPSHOT_MIN_OBJECTS || sequence % SNAPSHOT_INTERVAL == 0 {
            let snapshot_path = format!("{root}/snapshots/{sequence:020}.json.gz");
            encrypt_operations(&mut snapshot.operations, encryption.as_ref())?;
            let snapshot_payload = encode_snapshot(&snapshot)?;
            put_snapshot_create_only(
                client,
                &snapshot_path,
                &snapshot_payload,
                "remote snapshot sequence was claimed by another device; retry sync",
            )
            .await?;
            let verified_snapshot = client
                .get_snapshot(&snapshot_path)
                .await
                .map_err(|error| RepositoryError::Tauri(error.to_string()))?;
            if verified_snapshot != snapshot_payload {
                return Err(RepositoryError::Tauri(
                    "remote snapshot verification failed; local changes remain pending".to_owned(),
                ));
            }
            manifest.snapshot_sequence = sequence;
        }
    }
    let previous_sequence = manifest.latest_sequence;
    manifest.latest_sequence = sequence;
    manifest.updated_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    let verified_manifest = put_manifest(
        client,
        &manifest_path,
        &manifest,
        manifest_etag.as_deref(),
        previous_sequence,
        &local_device_id,
    )
    .await?;
    let verified_batch = client
        .get_json(&batch_path)
        .await
        .map_err(|error| RepositoryError::Tauri(error.to_string()))?;
    if verified_batch != batch_value
        || verified_manifest.collection_id != manifest.collection_id
        || verified_manifest.latest_sequence < sequence
        || verified_manifest.snapshot_sequence < manifest.snapshot_sequence
    {
        return Err(RepositoryError::Tauri(
            "remote write verification failed; local changes remain pending".to_owned(),
        ));
    }
    sync_repository::mark_uploaded(
        &connection,
        &changes[..operation_count]
            .iter()
            .map(|change| change.id.clone())
            .collect::<Vec<_>>(),
        sequence,
    )?;
    sync_repository::set_state(&connection, "lastRemoteSequence", &sequence.to_string())?;
    sync_repository::set_state(&connection, "lastSyncAt", &manifest.updated_at)?;
    sync_repository::update_device_sync(
        &connection,
        &local_device_id,
        &manifest.updated_at,
        sequence,
    )?;
    sync_repository::clear_state(&connection, "lastError")?;
    sync_repository::clear_state(&connection, "syncPhase")?;
    let already_pruned = remote_pruned_sequence(&connection)?;
    if let Ok(Some(sequence)) =
        cleanup_remote_history(client, &root, &verified_manifest, already_pruned).await
    {
        sync_repository::set_state(&connection, "remotePrunedSequence", &sequence.to_string())?;
    }
    Ok(())
}

pub(crate) fn build_upload_batch(
    changes: &[SyncChange],
    sequence: i64,
    device_id: &str,
    encryption: Option<&EncryptionContext>,
) -> RepositoryResult<(ChangeBatch, Value, usize)> {
    let mut operation_count = changes.len();
    loop {
        let operations = changes[..operation_count]
            .iter()
            .map(|change| {
                let payload = serde_json::from_str(&change.payload_json)
                    .map_err(|_| RepositoryError::Validation("invalid local sync payload"))?;
                Ok(ChangeOperation {
                    id: change.id.clone(),
                    entity: change.entity.clone(),
                    object_id: change.object_id.clone(),
                    operation: change.operation.clone(),
                    base_revision: change.base_revision,
                    revision: change.revision,
                    changed_at: change.created_at.clone(),
                    payload,
                })
            })
            .collect::<RepositoryResult<Vec<_>>>()?;
        let batch = ChangeBatch {
            protocol: PROTOCOL,
            sequence,
            device_id: device_id.to_owned(),
            created_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
            operations,
        };
        let mut remote_batch = batch.clone();
        encrypt_operations(&mut remote_batch.operations, encryption)?;
        let batch_value = serde_json::to_value(&remote_batch)?;
        if serde_json::to_vec(&batch_value)?.len() <= MAX_BATCH_JSON_BYTES {
            return Ok((batch, batch_value, operation_count));
        }
        if operation_count <= 1 {
            return Err(RepositoryError::Validation(
                "sync change operation is too large",
            ));
        }
        operation_count -= 1;
    }
}
