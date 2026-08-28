#![allow(clippy::items_after_test_module)]

use std::collections::BTreeSet;
use std::fs;

use chrono::{SecondsFormat, Utc};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::db::{
    attachment_repository::{
        attachment_tmp_dir, blob_absolute_path, managed_blob_relative_path, sha256_file,
        AttachmentBlobTransfer, AttachmentRepository, MAX_ATTACHMENT_FILE_BYTES,
    },
    recurring_repository::RecurringRuleRepository,
    sync_repository, Database,
};
use crate::error::{RepositoryError, RepositoryResult};
use crate::models::{SyncChange, SyncRemoteInspection};
use crate::sync::crypto::{self, EncryptionKey};
use crate::sync::manifest::{
    ChangeBatch, ChangeOperation, EncryptionConfig, Manifest, ManifestDevice,
};
use crate::sync::webdav::{WebDavClient, WebDavError};

mod apply;
mod crypto_ops;
mod validate;
pub(crate) use apply::{
    apply_batch, apply_snapshot, build_snapshot, current_payload, decode_snapshot, encode_snapshot,
    resolve_conflict_with_payload,
};
pub(crate) use crypto_ops::{decrypt_operations, encrypt_operations, encryption_context};
pub(crate) use validate::*;

const PROTOCOL: i64 = 2;
const MAX_BATCH_OPERATIONS: usize = 500;
const MAX_BATCH_JSON_BYTES: usize = 1024 * 1024;
const MAX_SNAPSHOT_OPERATIONS: usize = 50_000;
const MAX_SNAPSHOT_JSON_BYTES: u64 = 32 * 1024 * 1024;
const SNAPSHOT_INTERVAL: i64 = 100;
const SNAPSHOT_MIN_OBJECTS: usize = 100;

#[derive(Clone)]
pub(crate) struct EncryptionContext {
    config: EncryptionConfig,
    key: EncryptionKey,
}
const MAX_JSON_DEPTH: usize = 16;
const MAX_STRING_LENGTH: usize = 16 * 1024;
const MAX_ID_LENGTH: usize = 128;

pub async fn inspect_remote(
    server_url: &str,
    remote_path: &str,
    username: Option<String>,
    password: Option<String>,
) -> RepositoryResult<SyncRemoteInspection> {
    let client = WebDavClient::new(server_url, username, password)
        .map_err(|error| RepositoryError::Tauri(error.to_string()))?;
    client
        .options()
        .await
        .map_err(|error| RepositoryError::Tauri(error.to_string()))?;
    let root = validated_remote_root(remote_path)?;
    match client.propfind_hrefs(&root).await {
        Ok(hrefs) => {
            let root_name = root.rsplit('/').next().unwrap_or(&root);
            let unknown_entries = hrefs
                .into_iter()
                .filter_map(|href| {
                    let name = href.trim_end_matches('/').rsplit('/').next().unwrap_or("");
                    (!name.is_empty()
                        && name != root_name
                        && !matches!(
                            name,
                            "manifest.json" | "changes" | "snapshots" | "locks" | "attachments"
                        ))
                    .then(|| name.to_owned())
                })
                .take(20)
                .collect::<Vec<_>>();
            let manifest_path = format!("{root}/manifest.json");
            let manifest = read_remote_manifest(&client, &manifest_path).await?;
            let initialized = manifest.is_some();
            let encryption_key_id = manifest
                .as_ref()
                .and_then(|manifest| manifest.encryption.as_ref())
                .map(|config| config.key_id.clone());
            Ok(SyncRemoteInspection {
                initialized,
                requires_confirmation: !initialized || !unknown_entries.is_empty(),
                unknown_entries,
                encryption_enabled: encryption_key_id.is_some(),
                encryption_key_id,
            })
        }
        Err(WebDavError::Http(status)) if missing_remote_collection(status) => {
            Ok(uninitialized_remote_inspection())
        }
        Err(WebDavError::Http(status))
            if status == reqwest::StatusCode::METHOD_NOT_ALLOWED
                || status == reqwest::StatusCode::NOT_IMPLEMENTED =>
        {
            let manifest = read_remote_manifest(&client, &format!("{root}/manifest.json")).await?;
            let initialized = manifest.is_some();
            let encryption_key_id = manifest
                .as_ref()
                .and_then(|manifest| manifest.encryption.as_ref())
                .map(|config| config.key_id.clone());
            Ok(SyncRemoteInspection {
                initialized,
                requires_confirmation: !initialized,
                unknown_entries: if initialized {
                    Vec::new()
                } else {
                    vec!["服务器不支持目录列表，无法确认目录内容".to_owned()]
                },
                encryption_enabled: encryption_key_id.is_some(),
                encryption_key_id,
            })
        }
        Err(error) => Err(RepositoryError::Tauri(error.to_string())),
    }
}

fn missing_remote_collection(status: reqwest::StatusCode) -> bool {
    status == reqwest::StatusCode::NOT_FOUND || status == reqwest::StatusCode::CONFLICT
}

fn uninitialized_remote_inspection() -> SyncRemoteInspection {
    SyncRemoteInspection {
        initialized: false,
        requires_confirmation: true,
        unknown_entries: Vec::new(),
        encryption_enabled: false,
        encryption_key_id: None,
    }
}

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

async fn rotate_encryption_with_client(
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

async fn read_remote_manifest(
    client: &WebDavClient,
    path: &str,
) -> RepositoryResult<Option<Manifest>> {
    match client.get_json(path).await {
        Ok(value) => {
            let manifest: Manifest = serde_json::from_value(value)
                .map_err(|_| RepositoryError::Validation("invalid remote manifest"))?;
            validate_manifest(&manifest)?;
            Ok(Some(manifest))
        }
        Err(WebDavError::Http(status)) if missing_remote_collection(status) => Ok(None),
        Err(error) => Err(RepositoryError::Tauri(error.to_string())),
    }
}

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

fn validate_initial_sync_mode(
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
async fn revoke_remote_device_with_client(
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
async fn run_with_client(
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
            if batch.protocol != PROTOCOL || batch.sequence != sequence {
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
                    "remote sequence was claimed by another device; retry sync".to_owned(),
                ));
            }
        }
        Err(error) => return Err(RepositoryError::Tauri(error.to_string())),
    }
    if pending_total <= MAX_BATCH_OPERATIONS as i64 && operation_count == changes.len() {
        let mut snapshot = build_snapshot(&mut connection, sequence)?;
        snapshot.created_at = batch.created_at.clone();
        if snapshot.operations.len() >= SNAPSHOT_MIN_OBJECTS || sequence % SNAPSHOT_INTERVAL == 0 {
            let snapshot_path = format!("{root}/snapshots/{sequence:020}.json.gz");
            encrypt_operations(&mut snapshot.operations, encryption.as_ref())?;
            let snapshot_payload = encode_snapshot(&snapshot)?;
            match client
                .put_snapshot_if_none_match(&snapshot_path, snapshot_payload.clone())
                .await
            {
                Ok(()) => {}
                Err(WebDavError::Http(status))
                    if status == reqwest::StatusCode::PRECONDITION_FAILED =>
                {
                    let existing = client
                        .get_snapshot(&snapshot_path)
                        .await
                        .map_err(|error| RepositoryError::Tauri(error.to_string()))?;
                    if existing != snapshot_payload {
                        return Err(RepositoryError::Tauri(
                            "remote snapshot sequence was claimed by another device; retry sync"
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

fn build_upload_batch(
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

async fn upload_attachment_blobs_for_changes(
    database: &Database,
    client: &WebDavClient,
    root: &str,
    changes: &[SyncChange],
    encryption: Option<&EncryptionContext>,
) -> RepositoryResult<()> {
    let blob_ids = attachment_blob_ids_from_changes(changes)?;
    if blob_ids.is_empty() {
        return Ok(());
    }
    let data_dir = database.data_dir()?;
    let repository = AttachmentRepository::new(database);
    let blobs = repository.list_blobs_by_ids(&blob_ids)?;
    for blob in blobs {
        match upload_attachment_blob(&repository, &data_dir, client, root, &blob, encryption).await
        {
            Ok(()) => {}
            Err(error) => {
                if !error.to_string().contains("attachment file not found") {
                    let _ = repository.mark_blob_failed(&blob.id, &error.to_string());
                }
                return Err(error);
            }
        }
    }
    repository.refresh_pending_attachment_changes()?;
    Ok(())
}

async fn upload_attachment_blob(
    repository: &AttachmentRepository<'_>,
    data_dir: &std::path::Path,
    client: &WebDavClient,
    root: &str,
    blob: &AttachmentBlobTransfer,
    encryption: Option<&EncryptionContext>,
) -> RepositoryResult<()> {
    let remote_path = blob
        .remote_path
        .clone()
        .unwrap_or_else(|| managed_blob_relative_path(&blob.id));
    validate_attachment_remote_path(&remote_path)?;
    let local_path = blob_absolute_path(data_dir, &blob.local_relative_path)?;
    if !local_path.is_file() {
        repository.mark_blob_missing(&blob.id, "attachment file not found")?;
        return Err(RepositoryError::NotFound("attachment file"));
    }
    let (content_sha256, size_bytes) = sha256_file(&local_path)?;
    if content_sha256 != blob.content_sha256 || size_bytes != blob.size_bytes {
        repository.mark_blob_missing(&blob.id, "attachment file integrity mismatch")?;
        return Err(RepositoryError::Validation(
            "attachment file integrity mismatch",
        ));
    }
    let plaintext = fs::read(&local_path)?;
    if plaintext.len() as u64 > MAX_ATTACHMENT_FILE_BYTES {
        return Err(RepositoryError::Validation("attachment file is too large"));
    }
    let (payload, encryption_key_id) = if let Some(context) = encryption {
        let key_id = context.config.key_id.as_str();
        let aad = attachment_blob_associated_data(blob, key_id);
        (
            crypto::encrypt_bytes(&plaintext, &context.key, &aad)?,
            Some(key_id),
        )
    } else {
        (plaintext, None)
    };
    let remote_blob_path = format!("{root}/{remote_path}");
    ensure_remote_parent_collections(client, &remote_blob_path).await?;
    match client
        .put_blob_if_none_match(&remote_blob_path, payload.clone())
        .await
    {
        Ok(()) => {}
        Err(WebDavError::Http(status)) if status == reqwest::StatusCode::PRECONDITION_FAILED => {
            let existing = client
                .get_blob(&remote_blob_path)
                .await
                .map_err(|error| RepositoryError::Tauri(error.to_string()))?;
            if !remote_payload_matches_blob(&existing, blob, encryption_key_id, encryption)? {
                return Err(RepositoryError::Tauri(
                    "remote attachment blob already exists with different content; local changes remain pending".to_owned(),
                ));
            }
        }
        Err(error) => return Err(RepositoryError::Tauri(error.to_string())),
    }
    let verified = client
        .get_blob(&remote_blob_path)
        .await
        .map_err(|error| RepositoryError::Tauri(error.to_string()))?;
    if !remote_payload_matches_blob(&verified, blob, encryption_key_id, encryption)? {
        return Err(RepositoryError::Tauri(
            "remote attachment blob verification failed; local changes remain pending".to_owned(),
        ));
    }
    repository.mark_blob_uploaded(&blob.id, &remote_path, encryption_key_id)?;
    Ok(())
}

async fn download_pending_attachment_blobs(
    database: &Database,
    client: &WebDavClient,
    root: &str,
    encryption: Option<&EncryptionContext>,
) -> RepositoryResult<()> {
    let data_dir = database.data_dir()?;
    let repository = AttachmentRepository::new(database);
    let blobs = repository.list_pending_downloads(500)?;
    for blob in blobs {
        if let Err(error) = download_attachment_blob(
            database,
            &repository,
            &data_dir,
            client,
            root,
            &blob,
            encryption,
        )
        .await
        {
            repository.mark_blob_failed(&blob.id, &error.to_string())?;
        }
    }
    Ok(())
}

async fn download_attachment_blob(
    database: &Database,
    repository: &AttachmentRepository<'_>,
    data_dir: &std::path::Path,
    client: &WebDavClient,
    root: &str,
    blob: &AttachmentBlobTransfer,
    encryption: Option<&EncryptionContext>,
) -> RepositoryResult<()> {
    let local_relative_path = managed_blob_relative_path(&blob.id);
    let target = blob_absolute_path(data_dir, &local_relative_path)?;
    if target.is_file() {
        let (content_sha256, size_bytes) = sha256_file(&target)?;
        if content_sha256 == blob.content_sha256 && size_bytes == blob.size_bytes {
            repository.mark_blob_downloaded(&blob.id, &local_relative_path)?;
            return Ok(());
        }
    }
    let remote_path = blob
        .remote_path
        .as_deref()
        .ok_or(RepositoryError::Validation(
            "attachment remote path is missing",
        ))?;
    validate_attachment_remote_path(remote_path)?;
    let remote_payload = client
        .get_blob(&format!("{root}/{remote_path}"))
        .await
        .map_err(|error| RepositoryError::Tauri(error.to_string()))?;
    let plaintext = decrypt_remote_attachment_blob(database, blob, &remote_payload, encryption)?;
    if !attachment_blob_bytes_match(&plaintext, blob) {
        return Err(RepositoryError::Validation(
            "attachment blob integrity mismatch",
        ));
    }
    let parent = target
        .parent()
        .ok_or(RepositoryError::Validation("invalid attachment path"))?;
    fs::create_dir_all(parent)?;
    let tmp_dir = attachment_tmp_dir(data_dir);
    fs::create_dir_all(&tmp_dir)?;
    let tmp_path = tmp_dir.join(format!("{}.part", uuid::Uuid::new_v4()));
    if let Err(error) = fs::write(&tmp_path, &plaintext) {
        let _ = fs::remove_file(&tmp_path);
        return Err(error.into());
    }
    if target.exists() {
        fs::remove_file(&target)?;
    }
    if let Err(error) = fs::rename(&tmp_path, &target) {
        let _ = fs::remove_file(&tmp_path);
        return Err(error.into());
    }
    repository.mark_blob_downloaded(&blob.id, &local_relative_path)
}

fn attachment_blob_ids_from_changes(changes: &[SyncChange]) -> RepositoryResult<Vec<String>> {
    let mut ids = BTreeSet::new();
    for change in changes {
        if change.entity != "attachment" || change.operation == "delete" {
            continue;
        }
        let payload: Value = serde_json::from_str(&change.payload_json)
            .map_err(|_| RepositoryError::Validation("invalid local sync payload"))?;
        if payload.get("kind").and_then(Value::as_str) == Some("managed") {
            let blob_id = payload.get("blobId").and_then(Value::as_str).ok_or(
                RepositoryError::Validation("managed attachment payload is incomplete"),
            )?;
            ids.insert(blob_id.to_owned());
        }
    }
    Ok(ids.into_iter().collect())
}

fn decrypt_remote_attachment_blob(
    database: &Database,
    blob: &AttachmentBlobTransfer,
    payload: &[u8],
    encryption: Option<&EncryptionContext>,
) -> RepositoryResult<Vec<u8>> {
    let Some(key_id) = blob
        .encryption_key_id
        .as_deref()
        .or_else(|| encryption.map(|context| context.config.key_id.as_str()))
    else {
        return Ok(payload.to_vec());
    };
    let key = if let Some(context) = encryption.filter(|context| context.config.key_id == key_id) {
        context.key.clone()
    } else {
        let connection = database.connect()?;
        let stored = crate::sync::credentials::load_encryption_keys(&connection)?;
        crypto::stored_key(&stored, key_id)?.ok_or(RepositoryError::Validation(
            "sync encryption password is required on this device",
        ))?
    };
    let aad = attachment_blob_associated_data(blob, key_id);
    crypto::decrypt_bytes(payload, &key, &aad)
}

fn remote_payload_matches_blob(
    payload: &[u8],
    blob: &AttachmentBlobTransfer,
    encryption_key_id: Option<&str>,
    encryption: Option<&EncryptionContext>,
) -> RepositoryResult<bool> {
    let plaintext = if let (Some(key_id), Some(context)) = (encryption_key_id, encryption) {
        let aad = attachment_blob_associated_data(blob, key_id);
        crypto::decrypt_bytes(payload, &context.key, &aad)?
    } else {
        payload.to_vec()
    };
    Ok(attachment_blob_bytes_match(&plaintext, blob))
}

fn attachment_blob_bytes_match(payload: &[u8], blob: &AttachmentBlobTransfer) -> bool {
    payload.len() as i64 == blob.size_bytes && sha256_bytes(payload) == blob.content_sha256
}

fn sha256_bytes(payload: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(payload);
    let digest = hasher.finalize();
    let mut encoded = String::with_capacity(digest.len() * 2);
    for byte in digest {
        encoded.push_str(&format!("{byte:02x}"));
    }
    encoded
}

fn attachment_blob_associated_data(blob: &AttachmentBlobTransfer, key_id: &str) -> Vec<u8> {
    format!(
        "attachmentBlob|{}|{}|{}|{}",
        blob.id, blob.content_sha256, blob.size_bytes, key_id
    )
    .into_bytes()
}

fn validate_attachment_remote_path(path: &str) -> RepositoryResult<()> {
    if !path.starts_with("attachments/blobs/")
        || path.contains('\\')
        || path.starts_with('/')
        || path.contains(':')
        || path.contains('?')
        || path.contains('#')
        || path.chars().any(char::is_control)
        || path
            .split('/')
            .any(|segment| segment.is_empty() || segment == "." || segment == "..")
    {
        return Err(RepositoryError::Validation("invalid attachment path"));
    }
    Ok(())
}

async fn ensure_remote_parent_collections(
    client: &WebDavClient,
    remote_blob_path: &str,
) -> RepositoryResult<()> {
    let Some(parent) = remote_blob_path.rsplit_once('/').map(|(parent, _)| parent) else {
        return Err(RepositoryError::Validation("invalid attachment path"));
    };
    let mut current = String::new();
    for segment in parent.split('/') {
        if !current.is_empty() {
            current.push('/');
        }
        current.push_str(segment);
        match client.mkcol(&current).await {
            Ok(())
            | Err(WebDavError::Http(reqwest::StatusCode::METHOD_NOT_ALLOWED))
            | Err(WebDavError::Http(reqwest::StatusCode::CONFLICT)) => {}
            Err(error) => return Err(RepositoryError::Tauri(error.to_string())),
        }
    }
    Ok(())
}

pub async fn cleanup_remote_history_now(
    database: &Database,
    server_url: &str,
    remote_path: &str,
    username: Option<String>,
    password: Option<String>,
) -> RepositoryResult<i64> {
    let connection = database.connect()?;
    let expected_confirmation = confirmation_key(server_url, remote_path);
    if sync_repository::get_state(&connection, "remoteConfirmedFor")?.as_deref()
        != Some(expected_confirmation.as_str())
    {
        return Err(RepositoryError::Validation(
            "remote sync directory is not confirmed",
        ));
    }
    let already_pruned = remote_pruned_sequence(&connection)?;
    drop(connection);

    let client = WebDavClient::new(server_url, username, password)
        .map_err(|error| RepositoryError::Tauri(error.to_string()))?;
    client
        .options()
        .await
        .map_err(|error| RepositoryError::Tauri(error.to_string()))?;
    let root = validated_remote_root(remote_path)?;
    let manifest_path = format!("{root}/manifest.json");
    let value = client
        .get_json(&manifest_path)
        .await
        .map_err(|error| RepositoryError::Tauri(error.to_string()))?;
    let manifest: Manifest = serde_json::from_value(value)
        .map_err(|_| RepositoryError::Validation("invalid remote manifest"))?;
    validate_manifest(&manifest)?;
    let remote_attachment_blobs_removed =
        cleanup_remote_attachment_blobs(database, &client, &root, &manifest).await?;
    if let Some(sequence) =
        cleanup_remote_history(&client, &root, &manifest, already_pruned).await?
    {
        let connection = database.connect()?;
        sync_repository::set_state(&connection, "remotePrunedSequence", &sequence.to_string())?;
    }
    Ok(remote_attachment_blobs_removed)
}

async fn cleanup_remote_history(
    client: &WebDavClient,
    root: &str,
    manifest: &Manifest,
    already_pruned: i64,
) -> RepositoryResult<Option<i64>> {
    if manifest.snapshot_sequence == 0
        || manifest
            .devices
            .iter()
            .filter(|device| device.enabled)
            .any(|device| device.last_sequence < manifest.snapshot_sequence)
    {
        return Ok(None);
    }
    let already_pruned = already_pruned.min(manifest.snapshot_sequence);
    for sequence in (already_pruned + 1)..=manifest.snapshot_sequence {
        match client
            .delete(&format!("{root}/changes/{sequence:020}.json"))
            .await
        {
            Ok(()) | Err(WebDavError::Http(reqwest::StatusCode::NOT_FOUND)) => {}
            Err(error) => return Err(RepositoryError::Tauri(error.to_string())),
        }
    }
    Ok(Some(manifest.snapshot_sequence))
}

#[derive(Debug)]
struct RemoteAttachmentCleanupCandidate {
    remote_path: String,
    delete_sequence: i64,
}

async fn cleanup_remote_attachment_blobs(
    database: &Database,
    client: &WebDavClient,
    root: &str,
    manifest: &Manifest,
) -> RepositoryResult<i64> {
    let connection = database.connect()?;
    let candidates = remote_attachment_cleanup_candidates(&connection, manifest)?;
    drop(connection);

    let mut removed = 0_i64;
    for candidate in candidates {
        validate_attachment_remote_path(&candidate.remote_path)?;
        match client
            .delete(&format!("{root}/{}", candidate.remote_path))
            .await
        {
            Ok(()) | Err(WebDavError::Http(reqwest::StatusCode::NOT_FOUND)) => {
                removed += 1;
            }
            Err(error) => return Err(RepositoryError::Tauri(error.to_string())),
        }
    }
    Ok(removed)
}

fn remote_attachment_cleanup_candidates(
    connection: &rusqlite::Connection,
    manifest: &Manifest,
) -> RepositoryResult<Vec<RemoteAttachmentCleanupCandidate>> {
    let mut statement = connection.prepare(
        r#"
        SELECT b.remote_path, MAX(c.remote_sequence) AS delete_sequence
        FROM attachment_blobs AS b
        INNER JOIN task_attachments AS a ON a.blob_id = b.id
        INNER JOIN sync_changes AS c ON c.entity = 'attachment'
          AND c.object_id = a.id
          AND c.operation = 'delete'
        WHERE b.remote_path IS NOT NULL
          AND a.deleted_at IS NOT NULL
          AND c.uploaded_at IS NOT NULL
          AND c.remote_sequence IS NOT NULL
          AND julianday(a.deleted_at) < julianday('now', '-30 days')
          AND NOT EXISTS (
            SELECT 1 FROM task_attachments AS live
            WHERE live.blob_id = b.id AND live.deleted_at IS NULL
          )
        GROUP BY b.id, b.remote_path
        "#,
    )?;
    let rows = statement
        .query_map([], |row| {
            Ok(RemoteAttachmentCleanupCandidate {
                remote_path: row.get(0)?,
                delete_sequence: row.get(1)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows
        .into_iter()
        .filter(|candidate| {
            manifest
                .devices
                .iter()
                .filter(|device| device.enabled)
                .all(|device| device.last_sequence >= candidate.delete_sequence)
        })
        .collect())
}

fn remote_pruned_sequence(connection: &rusqlite::Connection) -> RepositoryResult<i64> {
    Ok(
        sync_repository::get_state(connection, "remotePrunedSequence")?
            .and_then(|value| value.parse::<i64>().ok())
            .unwrap_or(0),
    )
}

fn validated_remote_root(remote_path: &str) -> RepositoryResult<String> {
    let root = remote_path.trim_matches('/');
    if root.is_empty()
        || root.contains('?')
        || root.contains('#')
        || root.chars().any(char::is_control)
        || root
            .split('/')
            .any(|segment| segment == "." || segment == "..")
    {
        return Err(RepositoryError::Validation("invalid WebDAV remote path"));
    }
    Ok(root.to_owned())
}

fn remote_collection_paths(root: &str) -> Vec<String> {
    let mut paths = Vec::new();
    let mut current = String::new();
    for segment in root.split('/') {
        if !current.is_empty() {
            current.push('/');
        }
        current.push_str(segment);
        paths.push(current.clone());
    }
    paths.extend([
        format!("{root}/changes"),
        format!("{root}/snapshots"),
        format!("{root}/locks"),
    ]);
    paths
}

pub fn confirmation_key(server_url: &str, remote_path: &str) -> String {
    format!(
        "{}|{}",
        server_url.trim().trim_end_matches('/'),
        remote_path.trim().trim_matches('/')
    )
}

async fn load_or_create_manifest(
    client: &WebDavClient,
    manifest_path: &str,
    local_encryption: Option<EncryptionConfig>,
) -> RepositoryResult<(Manifest, Option<String>)> {
    match client.get_json_with_etag(manifest_path).await {
        Ok((value, etag)) => {
            let manifest = serde_json::from_value(value)
                .map_err(|_| RepositoryError::Validation("invalid remote manifest"))?;
            Ok((manifest, etag))
        }
        Err(WebDavError::Http(status)) if missing_remote_collection(status) => {
            let candidate = Manifest {
                protocol: PROTOCOL,
                collection_id: uuid::Uuid::new_v4().to_string(),
                format: "torder-sync".to_owned(),
                schema_version: 2,
                latest_sequence: 0,
                snapshot_sequence: 0,
                updated_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
                encryption: local_encryption,
                devices: Vec::new(),
            };
            match client
                .put_json_if_none_match(manifest_path, &serde_json::to_value(&candidate)?)
                .await
            {
                Ok(()) | Err(WebDavError::Http(reqwest::StatusCode::PRECONDITION_FAILED)) => {}
                Err(error) => return Err(RepositoryError::Tauri(error.to_string())),
            }
            let (value, etag) = client
                .get_json_with_etag(manifest_path)
                .await
                .map_err(|error| RepositoryError::Tauri(error.to_string()))?;
            let manifest = serde_json::from_value(value)
                .map_err(|_| RepositoryError::Validation("invalid remote manifest"))?;
            Ok((manifest, etag))
        }
        Err(error) => Err(RepositoryError::Tauri(error.to_string())),
    }
}

fn map_conditional_write_error(error: WebDavError) -> RepositoryError {
    match error {
        WebDavError::Http(status) if status == reqwest::StatusCode::PRECONDITION_FAILED => {
            RepositoryError::Tauri("remote manifest changed; retry sync".to_owned())
        }
        error => RepositoryError::Tauri(error.to_string()),
    }
}

async fn put_manifest(
    client: &WebDavClient,
    manifest_path: &str,
    manifest: &Manifest,
    etag: Option<&str>,
    expected_previous_sequence: i64,
    lock_device_id: &str,
) -> RepositoryResult<Manifest> {
    let manifest_value = serde_json::to_value(manifest)?;
    let lock_path = etag.is_none().then(|| soft_lock_path(manifest_path));
    if let Some(path) = lock_path.as_deref() {
        acquire_soft_lock(client, path, lock_device_id).await?;
    }
    let write_result: RepositoryResult<()> = async {
        if let Some(etag) = etag {
            client
                .put_json_if_match(manifest_path, &manifest_value, etag)
                .await
                .map_err(map_conditional_write_error)?;
        } else {
            let (current_value, current_etag) = client
                .get_json_with_etag(manifest_path)
                .await
                .map_err(|error| RepositoryError::Tauri(error.to_string()))?;
            let current: Manifest = serde_json::from_value(current_value)
                .map_err(|_| RepositoryError::Validation("invalid remote manifest"))?;
            validate_manifest(&current)?;
            if current.collection_id != manifest.collection_id
                || current.latest_sequence != expected_previous_sequence
            {
                return Err(RepositoryError::Tauri(
                    "remote manifest changed; retry sync".to_owned(),
                ));
            }
            if let Some(etag) = current_etag.as_deref() {
                client
                    .put_json_if_match(manifest_path, &manifest_value, etag)
                    .await
                    .map_err(map_conditional_write_error)?;
            } else {
                client
                    .put_json(manifest_path, &manifest_value)
                    .await
                    .map_err(|error| RepositoryError::Tauri(error.to_string()))?;
            }
        }
        Ok(())
    }
    .await;
    if let Some(path) = lock_path.as_deref() {
        let release_result = release_soft_lock(client, path).await;
        if write_result.is_ok() {
            release_result?;
        }
    }
    write_result?;
    let verified = client
        .get_json(manifest_path)
        .await
        .map_err(|error| RepositoryError::Tauri(error.to_string()))?;
    let verified: Manifest = serde_json::from_value(verified)
        .map_err(|_| RepositoryError::Validation("invalid remote manifest"))?;
    validate_manifest(&verified)?;
    let devices_verified = manifest.devices.iter().all(|expected| {
        verified.devices.iter().any(|actual| {
            actual.id == expected.id
                && actual.enabled == expected.enabled
                && actual.last_seen_at >= expected.last_seen_at
                && actual.last_sequence >= expected.last_sequence
        })
    });
    if verified.collection_id != manifest.collection_id
        || verified.latest_sequence < manifest.latest_sequence
        || verified.snapshot_sequence < manifest.snapshot_sequence
        || verified.encryption != manifest.encryption
        || !devices_verified
    {
        return Err(RepositoryError::Tauri(
            "remote manifest verification failed".to_owned(),
        ));
    }
    Ok(verified)
}

fn soft_lock_path(manifest_path: &str) -> String {
    manifest_path
        .strip_suffix("/manifest.json")
        .map(|root| format!("{root}/locks/sync.lock"))
        .unwrap_or_else(|| "locks/sync.lock".to_owned())
}

async fn acquire_soft_lock(
    client: &WebDavClient,
    lock_path: &str,
    device_id: &str,
) -> RepositoryResult<()> {
    let expires_at = (Utc::now() + chrono::Duration::minutes(2)).to_rfc3339();
    let payload = json!({
        "deviceId": device_id,
        "expiresAt": expires_at,
    });
    match client.put_json_if_none_match(lock_path, &payload).await {
        Ok(()) => Ok(()),
        Err(WebDavError::Http(status)) if status == reqwest::StatusCode::PRECONDITION_FAILED => {
            let existing = client
                .get_json(lock_path)
                .await
                .map_err(|error| RepositoryError::Tauri(error.to_string()))?;
            let expires_at = existing
                .get("expiresAt")
                .and_then(serde_json::Value::as_str)
                .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
                .map(|value| value.with_timezone(&Utc));
            if expires_at.is_none_or(|value| value > Utc::now()) {
                return Err(RepositoryError::Tauri(
                    "remote sync lock is held; retry later".to_owned(),
                ));
            }
            match client.delete(lock_path).await {
                Ok(()) | Err(WebDavError::Http(reqwest::StatusCode::NOT_FOUND)) => {}
                Err(error) => return Err(RepositoryError::Tauri(error.to_string())),
            }
            client
                .put_json_if_none_match(lock_path, &payload)
                .await
                .map_err(|error| RepositoryError::Tauri(error.to_string()))
        }
        Err(error) => Err(RepositoryError::Tauri(error.to_string())),
    }
}

async fn release_soft_lock(client: &WebDavClient, lock_path: &str) -> RepositoryResult<()> {
    match client.delete(lock_path).await {
        Ok(()) | Err(WebDavError::Http(reqwest::StatusCode::NOT_FOUND)) => Ok(()),
        Err(error) => Err(RepositoryError::Tauri(error.to_string())),
    }
}

fn refresh_manifest_devices(
    manifest: &mut Manifest,
    connection: &rusqlite::Connection,
    local_device_id: &str,
    synced_at: &str,
    local_sequence: i64,
) -> RepositoryResult<()> {
    let devices = sync_repository::list_devices(connection)?;
    for device in devices {
        let last_seen_at = device.last_sync_at.as_deref().unwrap_or(synced_at);
        upsert_manifest_device(
            manifest,
            &device.id,
            &device.name,
            last_seen_at,
            device.last_remote_sequence,
            device.enabled,
        );
    }
    upsert_manifest_device(
        manifest,
        local_device_id,
        &device_name(connection)?,
        synced_at,
        local_sequence,
        true,
    );
    Ok(())
}

fn upsert_manifest_device(
    manifest: &mut Manifest,
    id: &str,
    name: &str,
    last_seen_at: &str,
    last_sequence: i64,
    enabled: bool,
) {
    if let Some(device) = manifest.devices.iter_mut().find(|device| device.id == id) {
        device.name = name.to_owned();
        if device.last_seen_at.as_str() < last_seen_at {
            device.last_seen_at = last_seen_at.to_owned();
        }
        device.last_sequence = device.last_sequence.max(last_sequence);
        device.enabled = enabled;
    } else {
        manifest.devices.push(ManifestDevice {
            id: id.to_owned(),
            name: name.to_owned(),
            last_seen_at: last_seen_at.to_owned(),
            last_sequence,
            enabled,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initial_sync_mode_defaults_to_merge_and_rejects_unknown_values() {
        assert_eq!(
            InitialSyncMode::parse(None).unwrap(),
            InitialSyncMode::Merge
        );
        assert_eq!(
            InitialSyncMode::parse(Some("upload")).unwrap(),
            InitialSyncMode::Upload
        );
        assert_eq!(
            InitialSyncMode::parse(Some("download")).unwrap(),
            InitialSyncMode::Download
        );
        assert!(InitialSyncMode::parse(Some("overwrite")).is_err());
        assert!(validate_initial_sync_mode(InitialSyncMode::Upload, 3, 0).is_ok());
        assert!(validate_initial_sync_mode(InitialSyncMode::Upload, 3, 1).is_err());
        assert!(validate_initial_sync_mode(InitialSyncMode::Download, 0, 1).is_ok());
        assert!(validate_initial_sync_mode(InitialSyncMode::Download, 1, 1).is_err());
    }
    use crate::sync::credentials;
    use crate::sync::engine::apply::resolve_conflict;
    use crate::sync::manifest::Snapshot;
    use std::io::{Read, Write};
    use std::net::{SocketAddr, TcpListener};
    use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
    use std::thread::JoinHandle;

    fn operation(id: &str, entity: &str, object_id: &str, payload: Value) -> ChangeOperation {
        ChangeOperation {
            id: id.to_owned(),
            entity: entity.to_owned(),
            object_id: object_id.to_owned(),
            operation: "upsert".to_owned(),
            base_revision: 0,
            revision: 1,
            changed_at: "2026-08-21T00:00:00.000Z".to_owned(),
            payload,
        }
    }

    fn keyring_test_guard() -> MutexGuard<'static, ()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(())).lock().unwrap()
    }

    #[test]
    fn generated_occurrence_sync_payload_contains_full_insert_fields() {
        let path = std::env::temp_dir().join(format!(
            "torder-sync-occurrence-payload-{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        let database = Database::initialize(path.clone()).unwrap();
        let repository = RecurringRuleRepository::new(&database);
        repository
            .create(crate::models::CreateRecurringRuleInput {
                source_task_id: None,
                title: "每日同步载荷".to_owned(),
                note: None,
                priority: 1,
                list_id: "work".to_owned(),
                frequency: "daily".to_owned(),
                interval_count: 1,
                weekdays: Vec::new(),
                month_day: None,
                first_due_at: "2026-01-01T00:00:00Z".to_owned(),
                timezone: "UTC".to_owned(),
                generate_ahead_minutes: 0,
                remind_before: None,
                end_at: None,
            })
            .unwrap();
        let result = repository.generate_due().unwrap();
        assert!(result.generated_count >= 1);

        let connection = database.connect().unwrap();
        let payload_json: String = connection
            .query_row(
                "SELECT payload_json FROM sync_changes WHERE entity = 'task' ORDER BY revision DESC LIMIT 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let payload: Value = serde_json::from_str(&payload_json).unwrap();
        // 接收端 has_full_insert_payload 要求这些字段齐全；缺失任一都会让本地无该任务的
        // 设备拒收整批（"sync partial payload requires existing object"），同步永久卡死
        for field in ["title", "status", "priority", "listId", "sortOrder", "deletedAt"] {
            assert!(
                payload.get(field).is_some(),
                "generated occurrence payload misses required field: {field}"
            );
        }

        drop(connection);
        drop(database);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(format!("{}-wal", path.display()));
        let _ = std::fs::remove_file(format!("{}-shm", path.display()));
    }

    #[test]
    fn apply_batch_skips_duplicate_recurring_occurrence() {
        let path = std::env::temp_dir().join(format!(
            "torder-sync-occurrence-duplicate-{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        let database = Database::initialize(path.clone()).unwrap();
        let repository = RecurringRuleRepository::new(&database);
        let rule = repository
            .create(crate::models::CreateRecurringRuleInput {
                source_task_id: None,
                title: "双设备同期次".to_owned(),
                note: None,
                priority: 1,
                list_id: "work".to_owned(),
                frequency: "daily".to_owned(),
                interval_count: 1,
                weekdays: Vec::new(),
                month_day: None,
                first_due_at: "2026-01-01T09:00:00Z".to_owned(),
                timezone: "UTC".to_owned(),
                generate_ahead_minutes: 0,
                remind_before: None,
                end_at: None,
            })
            .unwrap();
        repository.generate_due().unwrap();
        // generate_due 每次只落最后一个到期期次，取本地实际生成的值作为远端批次的期次
        let occurrence: String = {
            let connection = database.connect().unwrap();
            let value = connection
                .query_row(
                    "SELECT occurrence_at FROM tasks WHERE recurring_rule_id = ?1 AND deleted_at IS NULL ORDER BY occurrence_at DESC LIMIT 1",
                    rusqlite::params![rule.id],
                    |row| row.get(0),
                )
                .unwrap();
            drop(connection);
            value
        };

        let batch = ChangeBatch {
            protocol: PROTOCOL,
            sequence: 1,
            device_id: "remote-device".to_owned(),
            created_at: "2026-01-02T00:00:00.000Z".to_owned(),
            operations: vec![operation(
                "remote-occurrence-change",
                "task",
                "remote-occurrence-task",
                json!({
                    "id": "remote-occurrence-task", "title": "远端生成的同期次实例",
                    "status": "todo", "priority": 1, "listId": "work", "sortOrder": 0,
                    "dueAt": occurrence, "recurringRuleId": rule.id,
                    "occurrenceAt": occurrence, "deletedAt": null,
                    "subtasks": [], "tags": []
                }),
            )],
        };

        let mut connection = database.connect().unwrap();
        // 修复前：INSERT 命中部分唯一索引 (rule, occurrence)，整批回滚、同步卡死；
        // 修复后：本地已有同 (规则, 期次) 存活行时幂等跳过
        apply_batch(&mut connection, &batch).unwrap();

        let live_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM tasks WHERE recurring_rule_id = ?1 AND occurrence_at = ?2 AND deleted_at IS NULL AND purged_at IS NULL",
                rusqlite::params![rule.id, occurrence],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(live_count, 1);
        let remote_exists: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM tasks WHERE id = 'remote-occurrence-task'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(remote_exists, 0);

        drop(connection);
        drop(database);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(format!("{}-wal", path.display()));
        let _ = std::fs::remove_file(format!("{}-shm", path.display()));
    }

    #[test]
    fn missing_webdav_collections_are_uninitialized() {
        assert!(missing_remote_collection(reqwest::StatusCode::NOT_FOUND));
        assert!(missing_remote_collection(reqwest::StatusCode::CONFLICT));
        assert!(!missing_remote_collection(
            reqwest::StatusCode::UNAUTHORIZED
        ));
    }

    #[test]
    fn remote_collection_paths_create_nested_parents_first() {
        assert_eq!(
            remote_collection_paths("Torder/mobile"),
            vec![
                "Torder",
                "Torder/mobile",
                "Torder/mobile/changes",
                "Torder/mobile/snapshots",
                "Torder/mobile/locks",
            ]
        );
        assert_eq!(
            remote_collection_paths(".torder"),
            vec![
                ".torder",
                ".torder/changes",
                ".torder/snapshots",
                ".torder/locks",
            ]
        );
    }

    #[test]
    fn rejects_invalid_remote_payload_fields_and_limits() {
        let invalid_payloads = [
            operation(
                "bad-status",
                "task",
                "task-id",
                json!({ "id": "task-id", "status": "unknown" }),
            ),
            operation(
                "bad-priority",
                "task",
                "task-id",
                json!({ "id": "task-id", "priority": 3 }),
            ),
            operation(
                "bad-frequency",
                "recurringRule",
                "rule-id",
                json!({ "id": "rule-id", "frequency": "yearly" }),
            ),
            operation(
                "bad-weekdays",
                "recurringRule",
                "rule-id",
                json!({ "id": "rule-id", "weekdays": [7] }),
            ),
            operation(
                "bad-event-date",
                "calendarEvent",
                "event-id",
                json!({ "id": "event-id", "startDate": "2026-02-30" }),
            ),
            operation(
                "bad-event-type",
                "calendarEvent",
                "event-id",
                json!({ "id": "event-id", "eventType": "meeting" }),
            ),
            operation(
                "mismatched-id",
                "list",
                "list-id",
                json!({ "id": "other-id" }),
            ),
            operation(
                "unknown-field",
                "task",
                "task-id",
                json!({ "id": "task-id", "password": "must-not-sync" }),
            ),
            operation(
                "bad-attachment-kind",
                "attachment",
                "attachment-id",
                json!({ "id": "attachment-id", "taskId": "task-id", "kind": "localReference", "displayName": "本机路径", "sortOrder": 0, "deletedAt": null }),
            ),
            operation(
                "bad-attachment-url",
                "attachment",
                "attachment-id",
                json!({ "id": "attachment-id", "taskId": "task-id", "kind": "webLink", "displayName": "链接", "externalUrl": "file:///secret", "sortOrder": 0, "deletedAt": null }),
            ),
            operation(
                "long-title",
                "task",
                "task-id",
                json!({ "id": "task-id", "title": "x".repeat(513) }),
            ),
        ];

        for operation in invalid_payloads {
            assert!(validate_operation(&operation).is_err(), "{}", operation.id);
        }

        let mut nested = json!(null);
        for _ in 0..=MAX_JSON_DEPTH {
            nested = json!({ "value": nested });
        }
        let deeply_nested = operation(
            "deeply-nested",
            "task",
            "task-id",
            json!({ "id": "task-id", "note": nested }),
        );
        assert!(validate_operation(&deeply_nested).is_err());
    }

    #[test]
    fn rejects_unknown_protocol_fields_in_manifest_and_change_batches() {
        let manifest = json!({
            "protocol": PROTOCOL,
            "collectionId": uuid::Uuid::new_v4().to_string(),
            "format": "torder-sync",
            "schemaVersion": 2,
            "latestSequence": 0,
            "updatedAt": "2026-08-21T00:00:00.000Z",
            "unexpected": true
        });
        assert!(serde_json::from_value::<Manifest>(manifest).is_err());

        let batch = json!({
            "protocol": PROTOCOL,
            "sequence": 1,
            "deviceId": "remote-device",
            "createdAt": "2026-08-21T00:00:00.000Z",
            "operations": [],
            "unexpected": true
        });
        assert!(serde_json::from_value::<ChangeBatch>(batch).is_err());
    }

    #[test]
    fn rejects_change_batch_over_operation_limit() {
        let repeated = operation(
            "change-id",
            "task",
            "task-id",
            json!({ "id": "task-id", "title": "valid" }),
        );
        let batch = ChangeBatch {
            protocol: PROTOCOL,
            sequence: 1,
            device_id: "remote-device".to_owned(),
            created_at: "2026-08-21T00:00:00.000Z".to_owned(),
            operations: vec![repeated; MAX_BATCH_OPERATIONS + 1],
        };
        let mut connection = rusqlite::Connection::open_in_memory().unwrap();

        assert!(apply_batch(&mut connection, &batch).is_err());
    }

    #[test]
    fn rejects_remote_list_name_collision_without_mutating_local_data() {
        let path = std::env::temp_dir().join(format!(
            "torder-sync-list-name-collision-{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        let database = Database::initialize(path.clone()).unwrap();
        let mut connection = database.connect().unwrap();
        connection
            .execute(
                "INSERT INTO lists (id, name, color, sort_order, is_default) VALUES ('local-list', 'Inbox', '#123456', 4, 0)",
                [],
            )
            .unwrap();
        let batch = ChangeBatch {
            protocol: PROTOCOL,
            sequence: 1,
            device_id: "remote-device".to_owned(),
            created_at: "2026-08-21T00:00:00.000Z".to_owned(),
            operations: vec![
                operation(
                    "remote-list-change",
                    "list",
                    "remote-list",
                    json!({
                        "id": "remote-list", "name": "inbox", "color": "#654321",
                        "sortOrder": 5, "isDefault": false, "deletedAt": null
                    }),
                ),
                operation(
                    "remote-task-change",
                    "task",
                    "remote-task",
                    json!({
                        "id": "remote-task", "title": "不应部分导入", "status": "todo",
                        "priority": 1, "listId": "remote-list", "sortOrder": 0,
                        "deletedAt": null
                    }),
                ),
            ],
        };

        let error = apply_batch(&mut connection, &batch)
            .unwrap_err()
            .to_string();
        assert!(error.contains("sync list name conflicts"), "{error}");
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM lists WHERE id = 'remote-list'",
                    [],
                    |row| { row.get::<_, i64>(0) }
                )
                .unwrap(),
            0
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM tasks WHERE id = 'remote-task'",
                    [],
                    |row| { row.get::<_, i64>(0) }
                )
                .unwrap(),
            0
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT name FROM lists WHERE id = 'local-list'",
                    [],
                    |row| { row.get::<_, String>(0) }
                )
                .unwrap(),
            "Inbox"
        );
        assert_eq!(sync_repository::pending_count(&connection).unwrap(), 0);
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM sync_conflicts WHERE id = 'list-name-conflict:remote-list-change' AND resolved_at IS NULL",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            1
        );

        connection
            .execute(
                "UPDATE lists SET name = 'Local Inbox' WHERE id = 'local-list'",
                [],
            )
            .unwrap();
        apply_batch(&mut connection, &batch).unwrap();
        assert_eq!(
            connection
                .query_row(
                    "SELECT name FROM lists WHERE id = 'remote-list'",
                    [],
                    |row| { row.get::<_, String>(0) }
                )
                .unwrap(),
            "inbox"
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM tasks WHERE id = 'remote-task'",
                    [],
                    |row| { row.get::<_, i64>(0) }
                )
                .unwrap(),
            1
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT resolution FROM sync_conflicts WHERE id = 'list-name-conflict:remote-list-change'",
                    [],
                    |row| row.get::<_, Option<String>>(0),
                )
                .unwrap()
                .as_deref(),
            Some("retryAfterRename")
        );

        drop(connection);
        drop(database);
        cleanup_database(&path);
    }

    #[test]
    fn upload_batch_splits_when_serialized_payload_exceeds_one_megabyte() {
        let large_title = "x".repeat(15_000);
        let changes = (0..100)
            .map(|index| SyncChange {
                id: format!("change-{index}"),
                entity: "task".to_owned(),
                object_id: format!("task-{index}"),
                operation: "upsert".to_owned(),
                base_revision: 0,
                revision: 1,
                payload_json: serde_json::to_string(&json!({
                    "id": format!("task-{index}"),
                    "title": large_title,
                }))
                .unwrap(),
                created_at: "2026-08-21T00:00:00.000Z".to_owned(),
                uploaded_at: None,
                remote_sequence: None,
            })
            .collect::<Vec<_>>();

        let (_, batch_value, operation_count) =
            build_upload_batch(&changes, 1, "local-device", None).unwrap();
        assert!(operation_count < changes.len());
        assert!(serde_json::to_vec(&batch_value).unwrap().len() <= MAX_BATCH_JSON_BYTES);
    }

    #[test]
    fn rejects_corrupt_local_sync_payload_instead_of_uploading_a_placeholder() {
        let changes = vec![SyncChange {
            id: "corrupt-change".to_owned(),
            entity: "task".to_owned(),
            object_id: "task-1".to_owned(),
            operation: "upsert".to_owned(),
            base_revision: 0,
            revision: 1,
            payload_json: "not-json".to_owned(),
            created_at: "2026-08-21T00:00:00.000Z".to_owned(),
            uploaded_at: None,
            remote_sequence: None,
        }];

        assert!(matches!(
            build_upload_batch(&changes, 1, "local-device", None),
            Err(RepositoryError::Validation("invalid local sync payload"))
        ));
    }

    #[test]
    fn remote_task_payload_preserves_reminded_at() {
        let path = std::env::temp_dir().join(format!(
            "torder-sync-reminded-at-{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        let database = Database::initialize(path.clone()).unwrap();
        let mut connection = database.connect().unwrap();
        let reminded_at = "2026-08-21T08:30:00.000Z";
        let batch = ChangeBatch {
            protocol: PROTOCOL,
            sequence: 1,
            device_id: "remote-device".to_owned(),
            created_at: "2026-08-21T08:31:00.000Z".to_owned(),
            operations: vec![operation(
                "task-reminded-at",
                "task",
                "remote-task",
                json!({
                    "id": "remote-task",
                    "title": "已提醒任务",
                    "status": "todo",
                    "priority": 1,
                    "listId": "work",
                    "sortOrder": 0,
                    "remindedAt": reminded_at,
                    "deletedAt": null
                }),
            )],
        };

        apply_batch(&mut connection, &batch).unwrap();

        assert_eq!(
            connection
                .query_row(
                    "SELECT reminded_at FROM tasks WHERE id = 'remote-task'",
                    [],
                    |row| row.get::<_, Option<String>>(0),
                )
                .unwrap()
                .as_deref(),
            Some(reminded_at)
        );
        drop(connection);
        drop(database);
        cleanup_database(&path);
    }

    #[test]
    fn rejects_partial_remote_payload_without_local_base() {
        let path = std::env::temp_dir().join(format!(
            "torder-sync-partial-missing-base-{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        let database = Database::initialize(path.clone()).unwrap();
        let mut connection = database.connect().unwrap();
        let batch = ChangeBatch {
            protocol: PROTOCOL,
            sequence: 1,
            device_id: "remote-device".to_owned(),
            created_at: "2026-08-21T08:31:00.000Z".to_owned(),
            operations: vec![operation(
                "partial-remote-task",
                "task",
                "remote-task",
                json!({
                    "id": "remote-task",
                    "title": "只有标题的增量"
                }),
            )],
        };

        let error = apply_batch(&mut connection, &batch).unwrap_err();

        assert!(matches!(
            error,
            RepositoryError::Validation("sync partial payload requires existing object")
        ));
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM tasks WHERE id = 'remote-task'",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            0
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM sync_changes WHERE id = 'partial-remote-task'",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            0
        );
        drop(connection);
        drop(database);
        cleanup_database(&path);
    }

    #[test]
    fn applies_remote_attachment_metadata_after_task() {
        let path = std::env::temp_dir().join(format!(
            "torder-sync-attachment-{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        let database = Database::initialize(path.clone()).unwrap();
        let mut connection = database.connect().unwrap();
        let attachment_payload = json!({
            "id": "remote-attachment",
            "taskId": "remote-task",
            "kind": "managed",
            "blobId": "remote-blob",
            "displayName": "合同.pdf",
            "originalName": "合同.pdf",
            "externalUrl": null,
            "contentSha256": "abc123",
            "sizeBytes": 12,
            "mimeType": "application/pdf",
            "remotePath": "attachments/blobs/re/remote-blob.bin",
            "sortOrder": 0,
            "createdAt": "2026-08-21T00:00:00.000Z",
            "updatedAt": "2026-08-21T00:00:00.000Z",
            "deletedAt": null,
        });
        let task_payload = json!({
            "id": "remote-task",
            "title": "带附件任务",
            "status": "todo",
            "priority": 1,
            "listId": "work",
            "sortOrder": 0,
            "createdAt": "2026-08-21T00:00:00.000Z",
            "updatedAt": "2026-08-21T00:00:00.000Z",
            "deletedAt": null,
        });
        let batch = ChangeBatch {
            protocol: PROTOCOL,
            sequence: 1,
            device_id: "remote-device".to_owned(),
            created_at: "2026-08-21T00:00:00.000Z".to_owned(),
            operations: vec![
                operation(
                    "remote-attachment-op",
                    "attachment",
                    "remote-attachment",
                    attachment_payload,
                ),
                operation("remote-task-op", "task", "remote-task", task_payload),
            ],
        };

        apply_batch(&mut connection, &batch).unwrap();

        let row: (String, String, String) = connection
            .query_row(
                "SELECT a.task_id, b.sync_state, b.remote_path FROM task_attachments AS a INNER JOIN attachment_blobs AS b ON b.id = a.blob_id WHERE a.id = 'remote-attachment'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(row.0, "remote-task");
        assert_eq!(row.1, "pendingDownload");
        assert_eq!(row.2, "attachments/blobs/re/remote-blob.bin");
        let payload = current_payload(
            &connection.unchecked_transaction().unwrap(),
            "attachment",
            "remote-attachment",
        )
        .unwrap();
        assert_eq!(payload["displayName"], "合同.pdf");
        assert_eq!(payload["sizeBytes"], 12);

        drop(connection);
        drop(database);
        cleanup_database(&path);
    }

    #[test]
    fn applies_remote_task_link_after_referenced_tasks() {
        let path = std::env::temp_dir().join(format!(
            "torder-sync-task-link-{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        let database = Database::initialize(path.clone()).unwrap();
        let mut connection = database.connect().unwrap();
        let source_task_payload = json!({
            "id": "remote-source-task",
            "title": "远端源任务",
            "status": "todo",
            "priority": 1,
            "listId": "work",
            "sortOrder": 0,
            "createdAt": "2026-08-21T00:00:00.000Z",
            "updatedAt": "2026-08-21T00:00:00.000Z",
            "deletedAt": null,
        });
        let target_task_payload = json!({
            "id": "remote-target-task",
            "title": "远端目标任务",
            "status": "todo",
            "priority": 1,
            "listId": "work",
            "sortOrder": 1000,
            "createdAt": "2026-08-21T00:00:00.000Z",
            "updatedAt": "2026-08-21T00:00:00.000Z",
            "deletedAt": null,
        });
        let task_link_payload = json!({
            "id": "remote-task-link",
            "sourceTaskId": "remote-source-task",
            "targetTaskId": "remote-target-task",
            "relationType": "reference",
            "sortOrder": 0,
            "createdAt": "2026-08-21T00:00:00.000Z",
            "updatedAt": "2026-08-21T00:00:00.000Z",
            "deletedAt": null,
        });
        let batch = ChangeBatch {
            protocol: PROTOCOL,
            sequence: 1,
            device_id: "remote-device".to_owned(),
            created_at: "2026-08-21T00:00:00.000Z".to_owned(),
            operations: vec![
                operation(
                    "remote-task-link-op",
                    "taskLink",
                    "remote-task-link",
                    task_link_payload,
                ),
                operation(
                    "remote-target-task-op",
                    "task",
                    "remote-target-task",
                    target_task_payload,
                ),
                operation(
                    "remote-source-task-op",
                    "task",
                    "remote-source-task",
                    source_task_payload,
                ),
            ],
        };

        apply_batch(&mut connection, &batch).unwrap();

        let row: (String, String, String) = connection
            .query_row(
                r#"
                SELECT l.source_task_id, l.target_task_id, target.title
                FROM task_links AS l
                INNER JOIN tasks AS target ON target.id = l.target_task_id
                WHERE l.id = 'remote-task-link'
                "#,
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(row.0, "remote-source-task");
        assert_eq!(row.1, "remote-target-task");
        assert_eq!(row.2, "远端目标任务");

        drop(connection);
        drop(database);
        cleanup_database(&path);
    }

    #[test]
    fn rejects_remote_task_link_self_reference() {
        let change = operation(
            "self-task-link-op",
            "taskLink",
            "self-task-link",
            json!({
                "id": "self-task-link",
                "sourceTaskId": "task-1",
                "targetTaskId": "task-1",
                "relationType": "reference",
                "sortOrder": 0,
                "deletedAt": null,
            }),
        );

        assert!(matches!(
            validate_operation(&change),
            Err(RepositoryError::Validation(
                "task link cannot reference itself"
            ))
        ));
    }

    #[test]
    fn applies_dependency_ordered_batch_and_replay_is_idempotent() {
        let path = std::env::temp_dir().join(format!(
            "torder-sync-engine-{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        let database = Database::initialize(path.clone()).unwrap();
        let mut connection = database.connect().unwrap();
        let batch = ChangeBatch {
            protocol: PROTOCOL,
            sequence: 1,
            device_id: "remote-device".to_owned(),
            created_at: "2026-08-21T00:00:00.000Z".to_owned(),
            // Deliberately use the reverse dependency order to exercise sorting.
            operations: vec![
                operation(
                    "event-change",
                    "calendarEvent",
                    "remote-event",
                    json!({
                        "id": "remote-event", "title": "远端会议", "eventType": "other",
                        "startDate": "2026-09-01", "endDate": "2026-09-02", "note": null,
                        "createdAt": "2026-08-21T00:00:00.000Z",
                        "updatedAt": "2026-08-21T01:00:00.000Z",
                        "deletedAt": null
                    }),
                ),
                operation(
                    "task-change",
                    "task",
                    "remote-task",
                    json!({
                        "id": "remote-task", "title": "远端任务", "status": "todo", "priority": 2,
                        "listId": "remote-list", "dueAt": null, "completedAt": null, "sortOrder": 0,
                        "remindBefore": null, "remindAt": null, "repeatRule": null,
                        "recurringRuleId": "remote-rule", "occurrenceAt": null, "deletedAt": null
                    }),
                ),
                operation(
                    "rule-change",
                    "recurringRule",
                    "remote-rule",
                    json!({
                        "id": "remote-rule", "title": "远端循环", "note": null, "priority": 1,
                        "listId": "remote-list", "frequency": "weekly", "intervalCount": 1,
                        "weekdays": [1], "monthDay": null, "firstDueAt": "2026-09-01T09:00:00Z",
                        "nextDueAt": "2026-09-08T09:00:00Z", "timezone": "Asia/Shanghai",
                        "generateAheadMinutes": 0, "remindBefore": null, "endAt": null,
                        "enabled": true, "deletedAt": null
                    }),
                ),
                operation(
                    "list-change",
                    "list",
                    "remote-list",
                    json!({
                        "id": "remote-list", "name": "远端清单", "color": "#123456", "sortOrder": 4,
                        "isDefault": false, "deletedAt": null
                    }),
                ),
            ],
        };

        apply_batch(&mut connection, &batch).unwrap();
        assert_eq!(
            connection
                .query_row(
                    "SELECT name FROM lists WHERE id = 'remote-list'",
                    [],
                    |row| row.get::<_, String>(0)
                )
                .unwrap(),
            "远端清单"
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT list_id FROM recurring_rules WHERE id = 'remote-rule'",
                    [],
                    |row| row.get::<_, String>(0)
                )
                .unwrap(),
            "remote-list"
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT recurring_rule_id FROM tasks WHERE id = 'remote-task'",
                    [],
                    |row| row.get::<_, Option<String>>(0)
                )
                .unwrap()
                .as_deref(),
            Some("remote-rule")
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT title, event_type FROM calendar_events WHERE id = 'remote-event'",
                    [],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                )
                .unwrap(),
            ("远端会议".to_owned(), "other".to_owned())
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT created_at, updated_at FROM calendar_events WHERE id = 'remote-event'",
                    [],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                )
                .unwrap(),
            (
                "2026-08-21T00:00:00.000Z".to_owned(),
                "2026-08-21T01:00:00.000Z".to_owned()
            )
        );

        apply_batch(&mut connection, &batch).unwrap();
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM sync_changes WHERE remote_sequence = 1",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            4
        );

        drop(connection);
        drop(database);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(format!("{}-wal", path.display()));
        let _ = std::fs::remove_file(format!("{}-shm", path.display()));
    }

    #[test]
    fn incremental_remote_payload_preserves_existing_fields() {
        let path =
            std::env::temp_dir().join(format!("torder-sync-merge-{}.sqlite", uuid::Uuid::new_v4()));
        let database = Database::initialize(path.clone()).unwrap();
        let mut connection = database.connect().unwrap();
        let initial = ChangeBatch {
            protocol: PROTOCOL,
            sequence: 1,
            device_id: "remote-device".to_owned(),
            created_at: "2026-08-21T00:00:00.000Z".to_owned(),
            operations: vec![operation(
                "rule-full",
                "recurringRule",
                "remote-rule",
                json!({
                    "id": "remote-rule", "title": "完整规则", "note": "保留备注", "priority": 2,
                    "listId": "work", "frequency": "daily", "intervalCount": 1, "weekdays": [],
                    "monthDay": null, "firstDueAt": "2026-09-01T09:00:00Z", "nextDueAt": "2026-09-02T09:00:00Z",
                    "timezone": "UTC", "generateAheadMinutes": 5, "remindBefore": 10,
                    "endAt": null, "enabled": true, "deletedAt": null
                }),
            )],
        };
        apply_batch(&mut connection, &initial).unwrap();
        let incremental = ChangeBatch {
            protocol: PROTOCOL,
            sequence: 2,
            device_id: "remote-device".to_owned(),
            created_at: "2026-08-21T01:00:00.000Z".to_owned(),
            operations: vec![ChangeOperation {
                id: "rule-disable".to_owned(),
                entity: "recurringRule".to_owned(),
                object_id: "remote-rule".to_owned(),
                operation: "upsert".to_owned(),
                base_revision: 1,
                revision: 2,
                changed_at: "2026-08-21T01:00:00.000Z".to_owned(),
                payload: json!({ "id": "remote-rule", "enabled": false }),
            }],
        };
        apply_batch(&mut connection, &incremental).unwrap();
        let values = connection.query_row("SELECT title, note, priority, enabled FROM recurring_rules WHERE id = 'remote-rule'", [], |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?, row.get::<_, i64>(2)?, row.get::<_, i64>(3)?))).unwrap();
        assert_eq!(
            values,
            ("完整规则".to_owned(), Some("保留备注".to_owned()), 2, 0)
        );

        drop(connection);
        drop(database);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(format!("{}-wal", path.display()));
        let _ = std::fs::remove_file(format!("{}-shm", path.display()));
    }

    #[test]
    fn resolving_conflict_keeps_local_and_records_new_revision() {
        let path = std::env::temp_dir().join(format!(
            "torder-sync-conflict-local-{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        let database = Database::initialize(path.clone()).unwrap();
        let task = crate::db::task_repository::TaskRepository::new(&database)
            .create(crate::models::CreateTaskInput {
                title: "本地标题".to_owned(),
                note: None,
                priority: Some(1),
                list_id: Some("work".to_owned()),
                scheduled_date: None,
                due_at: None,
                sort_order: None,
                remind_before: None,
                repeat_rule: None,
                subtasks: None,
                tags: None,
            })
            .unwrap();
        let mut connection = database.connect().unwrap();
        let remote = ChangeBatch {
            protocol: PROTOCOL,
            sequence: 1,
            device_id: "remote-device".to_owned(),
            created_at: "2026-08-21T01:00:00.000Z".to_owned(),
            operations: vec![operation(
                "remote-task-update",
                "task",
                &task.id,
                json!({ "id": task.id, "title": "远端标题" }),
            )],
        };
        apply_batch(&mut connection, &remote).unwrap();
        let conflict_id = connection
            .query_row(
                "SELECT id FROM sync_conflicts WHERE resolved_at IS NULL",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap();
        drop(connection);

        resolve_conflict(&database, &conflict_id, "keepLocal").unwrap();
        let connection = database.connect().unwrap();
        assert_eq!(
            connection
                .query_row(
                    "SELECT title FROM tasks WHERE id = ?1",
                    rusqlite::params![task.id],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "本地标题"
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT resolution FROM sync_conflicts WHERE id = ?1",
                    rusqlite::params![conflict_id],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "keepLocal"
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT revision FROM sync_objects WHERE entity = 'task' AND object_id = ?1",
                    rusqlite::params![task.id],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            2
        );

        drop(connection);
        drop(database);
        cleanup_database(&path);
    }

    #[test]
    fn unresolved_conflict_blocks_later_remote_revisions_until_resolution() {
        let path = std::env::temp_dir().join(format!(
            "torder-sync-conflict-follow-up-{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        let database = Database::initialize(path.clone()).unwrap();
        let task = crate::db::task_repository::TaskRepository::new(&database)
            .create(crate::models::CreateTaskInput {
                title: "本地标题".to_owned(),
                note: None,
                priority: Some(1),
                list_id: Some("work".to_owned()),
                scheduled_date: None,
                due_at: None,
                sort_order: None,
                remind_before: None,
                repeat_rule: None,
                subtasks: None,
                tags: None,
            })
            .unwrap();
        let mut connection = database.connect().unwrap();
        apply_batch(
            &mut connection,
            &ChangeBatch {
                protocol: PROTOCOL,
                sequence: 1,
                device_id: "remote-device".to_owned(),
                created_at: "2026-08-21T01:00:00.000Z".to_owned(),
                operations: vec![operation(
                    "remote-task-update-1",
                    "task",
                    &task.id,
                    json!({ "id": task.id, "title": "远端标题 1" }),
                )],
            },
        )
        .unwrap();

        let follow_up = ChangeOperation {
            id: "remote-task-update-2".to_owned(),
            entity: "task".to_owned(),
            object_id: task.id.clone(),
            operation: "upsert".to_owned(),
            base_revision: 1,
            revision: 2,
            changed_at: "2026-08-21T02:00:00.000Z".to_owned(),
            payload: json!({ "id": task.id, "title": "远端标题 2" }),
        };
        apply_batch(
            &mut connection,
            &ChangeBatch {
                protocol: PROTOCOL,
                sequence: 2,
                device_id: "remote-device".to_owned(),
                created_at: "2026-08-21T02:00:00.000Z".to_owned(),
                operations: vec![follow_up],
            },
        )
        .unwrap();

        assert_eq!(
            connection
                .query_row(
                    "SELECT title FROM tasks WHERE id = ?1",
                    rusqlite::params![task.id],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "本地标题"
        );
        let conflict = connection
            .query_row(
                "SELECT remote_revision, remote_payload_json FROM sync_conflicts WHERE entity = 'task' AND object_id = ?1 AND resolved_at IS NULL",
                rusqlite::params![task.id],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
            )
            .unwrap();
        assert_eq!(conflict.0, 2);
        assert_eq!(
            serde_json::from_str::<Value>(&conflict.1).unwrap()["title"],
            "远端标题 2"
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM sync_conflicts WHERE entity = 'task' AND object_id = ?1 AND resolved_at IS NULL",
                    rusqlite::params![task.id],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            1
        );

        drop(connection);
        drop(database);
        cleanup_database(&path);
    }

    #[test]
    fn resolving_conflict_accepts_remote_payload_and_records_new_revision() {
        let path = std::env::temp_dir().join(format!(
            "torder-sync-conflict-remote-{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        let database = Database::initialize(path.clone()).unwrap();
        let task = crate::db::task_repository::TaskRepository::new(&database)
            .create(crate::models::CreateTaskInput {
                title: "本地标题".to_owned(),
                note: Some("本地备注".to_owned()),
                priority: Some(1),
                list_id: Some("work".to_owned()),
                scheduled_date: None,
                due_at: None,
                sort_order: None,
                remind_before: None,
                repeat_rule: None,
                subtasks: None,
                tags: None,
            })
            .unwrap();
        let mut connection = database.connect().unwrap();
        let remote = ChangeBatch {
            protocol: PROTOCOL,
            sequence: 1,
            device_id: "remote-device".to_owned(),
            created_at: "2026-08-21T01:00:00.000Z".to_owned(),
            operations: vec![operation(
                "remote-task-update",
                "task",
                &task.id,
                json!({ "id": task.id, "title": "远端标题", "priority": 2 }),
            )],
        };
        apply_batch(&mut connection, &remote).unwrap();
        let conflict_id = connection
            .query_row(
                "SELECT id FROM sync_conflicts WHERE resolved_at IS NULL",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap();
        drop(connection);

        resolve_conflict(&database, &conflict_id, "acceptRemote").unwrap();
        let connection = database.connect().unwrap();
        let resolved = connection
            .query_row(
                "SELECT title, note, priority FROM tasks WHERE id = ?1",
                rusqlite::params![task.id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, i64>(2)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(
            resolved,
            ("远端标题".to_owned(), Some("本地备注".to_owned()), 2)
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT resolution FROM sync_conflicts WHERE id = ?1",
                    rusqlite::params![conflict_id],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "acceptRemote"
        );
        assert_eq!(sync_repository::pending_count(&connection).unwrap(), 2);

        drop(connection);
        drop(database);
        cleanup_database(&path);
    }

    #[test]
    fn resolving_conflict_can_merge_or_copy_without_destroying_original() {
        let path = std::env::temp_dir().join(format!(
            "torder-sync-conflict-copy-{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        let database = Database::initialize(path.clone()).unwrap();
        let task = crate::db::task_repository::TaskRepository::new(&database)
            .create(crate::models::CreateTaskInput {
                title: "本地任务".to_owned(),
                note: Some("本地备注".to_owned()),
                priority: Some(1),
                list_id: Some("work".to_owned()),
                scheduled_date: None,
                due_at: None,
                sort_order: None,
                remind_before: None,
                repeat_rule: None,
                subtasks: None,
                tags: None,
            })
            .unwrap();
        let mut connection = database.connect().unwrap();
        let remote = ChangeBatch {
            protocol: PROTOCOL,
            sequence: 1,
            device_id: "remote-device".to_owned(),
            created_at: "2026-08-21T01:00:00.000Z".to_owned(),
            operations: vec![operation(
                "remote-task-copy",
                "task",
                &task.id,
                json!({ "id": task.id, "title": "远端任务", "priority": 2 }),
            )],
        };
        apply_batch(&mut connection, &remote).unwrap();
        let conflict_id = connection
            .query_row(
                "SELECT id FROM sync_conflicts WHERE resolved_at IS NULL",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap();
        drop(connection);

        resolve_conflict_with_payload(
            &database,
            &conflict_id,
            "merge",
            Some(json!({ "id": task.id, "title": "合并任务", "note": "保留备注" })),
        )
        .unwrap();
        let mut connection = database.connect().unwrap();
        assert_eq!(
            connection
                .query_row(
                    "SELECT title, note FROM tasks WHERE id = ?1",
                    rusqlite::params![task.id],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
                )
                .unwrap(),
            ("合并任务".to_owned(), Some("保留备注".to_owned()))
        );
        let remote_copy = ChangeBatch {
            protocol: PROTOCOL,
            sequence: 2,
            device_id: "remote-device".to_owned(),
            created_at: "2026-08-21T02:00:00.000Z".to_owned(),
            operations: vec![operation(
                "remote-task-copy-second",
                "task",
                &task.id,
                json!({ "id": task.id, "title": "远端副本", "priority": 2 }),
            )],
        };
        apply_batch(&mut connection, &remote_copy).unwrap();
        let second_conflict_id = connection
            .query_row(
                "SELECT id FROM sync_conflicts WHERE resolution IS NULL LIMIT 1",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap();
        drop(connection);
        resolve_conflict(&database, &second_conflict_id, "copy").unwrap();
        let connection = database.connect().unwrap();
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM tasks", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            2
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT title FROM tasks WHERE id = ?1",
                    rusqlite::params![task.id],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "合并任务"
        );
        let copied = connection
            .query_row(
                "SELECT tasks.title, sync_objects.revision
                 FROM tasks
                 JOIN sync_objects ON sync_objects.entity = 'task'
                   AND sync_objects.object_id = tasks.id
                 WHERE tasks.id <> ?1",
                rusqlite::params![task.id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
            )
            .unwrap();
        assert_eq!(copied, ("远端副本".to_owned(), 1));
        drop(connection);
        drop(database);
        cleanup_database(&path);
    }

    #[test]
    fn webdav_flow_initializes_manifest_uploads_and_verifies_changes() {
        let (address, requests, handle) = spawn_mock_dav(MockDavConfig::default(), 11);
        let client = WebDavClient::new_for_test(address);
        let path = std::env::temp_dir().join(format!(
            "torder-sync-webdav-upload-{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        let database = Database::initialize(path.clone()).unwrap();
        crate::db::task_repository::TaskRepository::new(&database)
            .create(crate::models::CreateTaskInput {
                title: "待上传任务".to_owned(),
                note: None,
                priority: Some(1),
                list_id: Some("work".to_owned()),
                scheduled_date: None,
                due_at: None,
                sort_order: None,
                remind_before: None,
                repeat_rule: None,
                subtasks: None,
                tags: None,
            })
            .unwrap();

        tauri::async_runtime::block_on(run_with_client(&database, &client, "sync")).unwrap();

        let connection = database.connect().unwrap();
        assert_eq!(sync_repository::pending_count(&connection).unwrap(), 0);
        assert_eq!(
            sync_repository::get_state(&connection, "lastRemoteSequence")
                .unwrap()
                .as_deref(),
            Some("1")
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT last_remote_sequence FROM sync_devices WHERE enabled = 1",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            1
        );
        let requests = requests.lock().unwrap();
        assert!(requests.iter().any(|request| {
            request.method == "PUT"
                && request.path.ends_with("/manifest.json")
                && request.raw_headers.contains("if-none-match: *")
        }));
        assert!(requests.iter().any(|request| {
            request.method == "PUT"
                && request.path.ends_with("/manifest.json")
                && request.raw_headers.contains("if-match: \"v1\"")
        }));
        drop(requests);
        handle.join().unwrap();
        drop(connection);
        drop(database);
        cleanup_database(&path);
    }

    #[test]
    fn encrypted_managed_attachment_uploads_blob_before_metadata_without_plaintext() {
        let _keyring_guard = keyring_test_guard();
        let (config, key) = crypto::create_config("attachment sync password").unwrap();
        let dir = std::env::temp_dir().join(format!(
            "torder-sync-attachment-upload-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let database = Database::initialize(dir.join("torder.sqlite")).unwrap();
        configure_local_encryption(&database, &config, &key);
        let task = crate::db::task_repository::TaskRepository::new(&database)
            .create(crate::models::CreateTaskInput {
                title: "带附件任务".to_owned(),
                note: None,
                priority: Some(1),
                list_id: Some("work".to_owned()),
                scheduled_date: None,
                due_at: None,
                sort_order: None,
                remind_before: None,
                repeat_rule: None,
                subtasks: None,
                tags: None,
            })
            .unwrap();
        let source_path = dir.join("source-secret.txt");
        std::fs::write(&source_path, b"attachment plaintext secret").unwrap();
        let attachment = AttachmentRepository::new(&database)
            .create_managed(
                &dir,
                crate::models::CreateAttachmentInput {
                    task_id: task.id,
                    source_path: source_path.display().to_string(),
                    display_name: Some("secret.txt".to_owned()),
                },
            )
            .unwrap();

        let (address, requests, handle) = spawn_mock_dav(MockDavConfig::default(), 17);
        let client = WebDavClient::new_for_test(address);
        tauri::async_runtime::block_on(run_with_client(&database, &client, "sync")).unwrap();

        let requests = requests.lock().unwrap();
        let blob_put_index = requests
            .iter()
            .position(|request| {
                request.method == "PUT" && request.path.contains("/attachments/blobs/")
            })
            .unwrap();
        let change_put_index = requests
            .iter()
            .position(|request| request.method == "PUT" && request.path.contains("/changes/"))
            .unwrap();
        assert!(blob_put_index < change_put_index);
        let blob_put = &requests[blob_put_index];
        assert!(!blob_put
            .body
            .windows("attachment plaintext secret".len())
            .any(|window| window == b"attachment plaintext secret"));
        drop(requests);
        handle.join().unwrap();

        let connection = database.connect().unwrap();
        let blob_row: (String, Option<String>) = connection
            .query_row(
                "SELECT sync_state, encryption_key_id FROM attachment_blobs WHERE id = ?1",
                rusqlite::params![attachment.blob_id.unwrap()],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(blob_row.0, "uploaded");
        assert_eq!(blob_row.1.as_deref(), Some(config.key_id.as_str()));
        credentials::remove_encryption_keys(&connection).unwrap();
        drop(connection);
        drop(database);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn remote_attachment_metadata_downloads_blob_to_managed_storage() {
        let dir = std::env::temp_dir().join(format!(
            "torder-sync-attachment-download-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let database = Database::initialize(dir.join("torder.sqlite")).unwrap();
        let payload = b"remote attachment body".to_vec();
        let attachment_payload = json!({
            "id": "remote-attachment-download",
            "taskId": "remote-task-download",
            "kind": "managed",
            "blobId": "remote-blob-download",
            "displayName": "remote.txt",
            "originalName": "remote.txt",
            "contentSha256": sha256_bytes(&payload),
            "sizeBytes": payload.len() as i64,
            "mimeType": "text/plain",
            "remotePath": "attachments/blobs/re/remote-blob-download.bin",
            "sortOrder": 0,
            "deletedAt": null
        });
        let batch = serde_json::to_value(ChangeBatch {
            protocol: PROTOCOL,
            sequence: 1,
            device_id: "remote-device".to_owned(),
            created_at: "2026-08-21T00:00:00.000Z".to_owned(),
            operations: vec![
                operation(
                    "remote-task-download-op",
                    "task",
                    "remote-task-download",
                    json!({
                        "id": "remote-task-download",
                        "title": "远端附件任务",
                        "status": "todo",
                        "priority": 1,
                        "listId": "work",
                        "sortOrder": 0,
                        "deletedAt": null
                    }),
                ),
                operation(
                    "remote-attachment-download-op",
                    "attachment",
                    "remote-attachment-download",
                    attachment_payload,
                ),
            ],
        })
        .unwrap();
        let manifest = json!({
            "protocol": PROTOCOL,
            "collectionId": uuid::Uuid::new_v4().to_string(),
            "format": "torder-sync",
            "schemaVersion": 2,
            "latestSequence": 1,
            "updatedAt": "2026-08-21T00:00:00.000Z"
        });
        let (address, _requests, handle) = spawn_mock_dav(
            MockDavConfig {
                manifest: Some(manifest),
                batch: Some(batch),
                blob: Some(payload.clone()),
                ..MockDavConfig::default()
            },
            9,
        );
        let client = WebDavClient::new_for_test(address);
        tauri::async_runtime::block_on(run_with_client(&database, &client, "sync")).unwrap();

        let local_path = dir.join("attachments/blobs/re/remote-blob-download.bin");
        assert_eq!(std::fs::read(&local_path).unwrap(), payload);
        let connection = database.connect().unwrap();
        assert_eq!(
            connection
                .query_row(
                    "SELECT sync_state FROM attachment_blobs WHERE id = 'remote-blob-download'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "downloaded"
        );
        handle.join().unwrap();
        drop(connection);
        drop(database);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn remote_attachment_hash_mismatch_marks_blob_failed_without_writing_file() {
        let dir = std::env::temp_dir().join(format!(
            "torder-sync-attachment-mismatch-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let database = Database::initialize(dir.join("torder.sqlite")).unwrap();
        let expected = b"expected attachment body".to_vec();
        let wrong = b"wrong attachment body".to_vec();
        let attachment_payload = json!({
            "id": "remote-attachment-mismatch",
            "taskId": "remote-task-mismatch",
            "kind": "managed",
            "blobId": "remote-blob-mismatch",
            "displayName": "remote.txt",
            "contentSha256": sha256_bytes(&expected),
            "sizeBytes": expected.len() as i64,
            "remotePath": "attachments/blobs/re/remote-blob-mismatch.bin",
            "sortOrder": 0,
            "deletedAt": null
        });
        let batch = serde_json::to_value(ChangeBatch {
            protocol: PROTOCOL,
            sequence: 1,
            device_id: "remote-device".to_owned(),
            created_at: "2026-08-21T00:00:00.000Z".to_owned(),
            operations: vec![
                operation(
                    "remote-task-mismatch-op",
                    "task",
                    "remote-task-mismatch",
                    json!({
                        "id": "remote-task-mismatch",
                        "title": "远端坏附件任务",
                        "status": "todo",
                        "priority": 1,
                        "listId": "work",
                        "sortOrder": 0,
                        "deletedAt": null
                    }),
                ),
                operation(
                    "remote-attachment-mismatch-op",
                    "attachment",
                    "remote-attachment-mismatch",
                    attachment_payload,
                ),
            ],
        })
        .unwrap();
        let manifest = json!({
            "protocol": PROTOCOL,
            "collectionId": uuid::Uuid::new_v4().to_string(),
            "format": "torder-sync",
            "schemaVersion": 2,
            "latestSequence": 1,
            "updatedAt": "2026-08-21T00:00:00.000Z"
        });
        let (address, _requests, handle) = spawn_mock_dav(
            MockDavConfig {
                manifest: Some(manifest),
                batch: Some(batch),
                blob: Some(wrong),
                ..MockDavConfig::default()
            },
            9,
        );
        let client = WebDavClient::new_for_test(address);
        tauri::async_runtime::block_on(run_with_client(&database, &client, "sync")).unwrap();

        assert!(!dir
            .join("attachments/blobs/re/remote-blob-mismatch.bin")
            .exists());
        let connection = database.connect().unwrap();
        let row: (String, Option<String>) = connection
            .query_row(
                "SELECT sync_state, last_error FROM attachment_blobs WHERE id = 'remote-blob-mismatch'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(row.0, "failed");
        assert!(row.1.unwrap().contains("integrity mismatch"));
        handle.join().unwrap();
        drop(connection);
        drop(database);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn remote_device_revocation_updates_manifest_before_local_state() {
        let path = std::env::temp_dir().join(format!(
            "torder-sync-revoke-device-{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        let database = Database::initialize(path.clone()).unwrap();
        let collection_id = uuid::Uuid::new_v4().to_string();
        let manifest = json!({
            "protocol": PROTOCOL,
            "collectionId": collection_id,
            "format": "torder-sync",
            "schemaVersion": 2,
            "latestSequence": 1,
            "snapshotSequence": 0,
            "updatedAt": "2026-08-21T00:00:00.000Z",
            "devices": [
                { "id": "local-device", "name": "本机", "lastSeenAt": "2026-08-21T00:00:00.000Z", "lastSequence": 1, "enabled": true },
                { "id": "remote-device", "name": "手机", "lastSeenAt": "2026-08-21T00:00:00.000Z", "lastSequence": 1, "enabled": true }
            ]
        });
        let connection = database.connect().unwrap();
        sync_repository::set_state(&connection, "deviceId", "local-device").unwrap();
        sync_repository::set_state(
            &connection,
            "remoteConfirmedFor",
            &confirmation_key("http://test", "sync"),
        )
        .unwrap();
        sync_repository::ensure_device(&connection, "local-device", "本机").unwrap();
        sync_repository::ensure_device(&connection, "remote-device", "手机").unwrap();
        let (address, requests, handle) = spawn_mock_dav(
            MockDavConfig {
                manifest: Some(manifest),
                ..MockDavConfig::default()
            },
            3,
        );
        let client = WebDavClient::new_for_test(address);
        tauri::async_runtime::block_on(revoke_remote_device_with_client(
            &database,
            &client,
            "sync",
            "remote-device",
        ))
        .unwrap();
        let requests = requests.lock().unwrap();
        let updated_manifest: Value = requests
            .iter()
            .find(|request| request.method == "PUT" && request.path.ends_with("/manifest.json"))
            .map(|request| serde_json::from_slice(&request.body).unwrap())
            .unwrap();
        assert_eq!(
            updated_manifest["devices"]
                .as_array()
                .unwrap()
                .iter()
                .find(|device| device["id"] == "remote-device")
                .unwrap()["enabled"],
            false
        );
        drop(requests);
        handle.join().unwrap();

        let connection = database.connect().unwrap();
        assert!(!sync_repository::is_device_enabled(&connection, "remote-device").unwrap());
        drop(connection);
        drop(client);
        drop(database);
        cleanup_database(&path);
    }

    #[test]
    fn encrypted_upload_hides_payload_and_rotation_publishes_new_snapshot() {
        let _keyring_guard = keyring_test_guard();
        let (old_config, old_key) =
            crypto::create_config("old sync password").expect("create old key");
        let path = std::env::temp_dir().join(format!(
            "torder-sync-webdav-encrypted-{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        let database = Database::initialize(path.clone()).unwrap();
        crate::db::task_repository::TaskRepository::new(&database)
            .create(crate::models::CreateTaskInput {
                title: "只有本机可见的任务标题".to_owned(),
                note: Some("敏感备注".to_owned()),
                priority: Some(1),
                list_id: Some("work".to_owned()),
                scheduled_date: None,
                due_at: None,
                sort_order: None,
                remind_before: None,
                repeat_rule: None,
                subtasks: None,
                tags: None,
            })
            .unwrap();
        configure_local_encryption(&database, &old_config, &old_key);

        let (address, requests, handle) = spawn_mock_dav(MockDavConfig::default(), 11);
        let client = WebDavClient::new_for_test(address);
        tauri::async_runtime::block_on(run_with_client(&database, &client, "sync")).unwrap();

        let (manifest_value, uploaded_batch) = {
            let requests = requests.lock().unwrap();
            let manifest = requests
                .iter()
                .rev()
                .find(|request| request.method == "PUT" && request.path.ends_with("/manifest.json"))
                .map(|request| serde_json::from_slice::<Value>(&request.body).unwrap())
                .unwrap();
            let batch = requests
                .iter()
                .find(|request| request.method == "PUT" && request.path.contains("/changes/"))
                .map(|request| serde_json::from_slice::<Value>(&request.body).unwrap())
                .unwrap();
            (manifest, batch)
        };
        let uploaded_json = serde_json::to_string(&uploaded_batch).unwrap();
        assert!(!uploaded_json.contains("只有本机可见的任务标题"));
        assert!(uploaded_batch["operations"][0]["payload"]["$encrypted"].is_object());
        handle.join().unwrap();

        let (new_address, rotation_requests, rotation_handle) = spawn_mock_dav(
            MockDavConfig {
                manifest: Some(manifest_value),
                ..MockDavConfig::default()
            },
            8,
        );
        let rotation_client = WebDavClient::new_for_test(new_address);
        tauri::async_runtime::block_on(rotate_encryption_with_client(
            &database,
            &rotation_client,
            "sync",
            "new sync password",
        ))
        .unwrap();

        let connection = database.connect().unwrap();
        let new_config: EncryptionConfig = serde_json::from_str(
            &sync_repository::get_state(&connection, "encryptionConfig")
                .unwrap()
                .unwrap(),
        )
        .unwrap();
        assert_ne!(new_config.key_id, old_config.key_id);
        assert_eq!(
            sync_repository::get_state(&connection, "lastRemoteSequence")
                .unwrap()
                .as_deref(),
            Some("2")
        );
        assert!(credentials::has_encryption_key(&connection, &new_config.key_id).unwrap());
        let requests = rotation_requests.lock().unwrap();
        let rotated_manifest_value: Value = requests
            .iter()
            .rev()
            .find(|request| request.method == "PUT" && request.path.ends_with("/manifest.json"))
            .map(|request| serde_json::from_slice(&request.body).unwrap())
            .unwrap();
        let rotated_manifest: Manifest =
            serde_json::from_value(rotated_manifest_value.clone()).unwrap();
        assert_eq!(rotated_manifest.latest_sequence, 2);
        assert_eq!(rotated_manifest.snapshot_sequence, 2);
        assert_eq!(rotated_manifest.encryption, Some(new_config.clone()));
        let empty_batch: ChangeBatch = requests
            .iter()
            .find(|request| {
                request.method == "PUT"
                    && request.path.ends_with("/changes/00000000000000000002.json")
            })
            .map(|request| serde_json::from_slice(&request.body).unwrap())
            .unwrap();
        assert!(empty_batch.operations.is_empty());
        let rotated_snapshot = requests
            .iter()
            .find(|request| {
                request.method == "PUT"
                    && request
                        .path
                        .ends_with("/snapshots/00000000000000000002.json.gz")
            })
            .map(|request| request.body.clone())
            .unwrap();
        drop(requests);
        rotation_handle.join().unwrap();

        let new_device_path = std::env::temp_dir().join(format!(
            "torder-sync-webdav-new-device-{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        let new_device = Database::initialize(new_device_path.clone()).unwrap();
        let new_device_key = crypto::derive_key(&new_config, "new sync password").unwrap();
        configure_local_encryption(&new_device, &new_config, &new_device_key);
        let (new_device_address, _new_device_requests, new_device_handle) = spawn_mock_dav(
            MockDavConfig {
                manifest: Some(rotated_manifest_value),
                snapshot: Some(rotated_snapshot),
                ..MockDavConfig::default()
            },
            10,
        );
        let new_device_client = WebDavClient::new_for_test(new_device_address);
        tauri::async_runtime::block_on(run_with_client(&new_device, &new_device_client, "sync"))
            .unwrap();
        let new_device_connection = new_device.connect().unwrap();
        assert_eq!(
            new_device_connection
                .query_row(
                    "SELECT title FROM tasks WHERE title = '只有本机可见的任务标题'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "只有本机可见的任务标题"
        );
        credentials::remove_encryption_keys(&new_device_connection).unwrap();
        drop(new_device_connection);
        new_device_handle.join().unwrap();
        drop(new_device);
        cleanup_database(&new_device_path);
        credentials::remove_encryption_keys(&connection).unwrap();
        drop(connection);
        drop(database);
        cleanup_database(&path);
    }

    #[test]
    fn encrypted_remote_batch_requires_the_right_key_and_preserves_local_state_on_failure() {
        let _keyring_guard = keyring_test_guard();
        let (config, key) = crypto::create_config("remote sync password").unwrap();
        let encrypted_operation = operation(
            "encrypted-remote-task",
            "task",
            "encrypted-remote-task",
            json!({
                "id": "encrypted-remote-task",
                "title": "远端加密任务",
                "status": "todo",
                "priority": 1,
                "listId": "work",
                "sortOrder": 0,
                "deletedAt": null
            }),
        );
        let context = EncryptionContext {
            config: config.clone(),
            key: key.clone(),
        };
        let mut encrypted_operations = vec![encrypted_operation];
        encrypt_operations(&mut encrypted_operations, Some(&context)).unwrap();
        let batch = serde_json::to_value(ChangeBatch {
            protocol: PROTOCOL,
            sequence: 1,
            device_id: "remote-device".to_owned(),
            created_at: "2026-08-21T00:00:00.000Z".to_owned(),
            operations: encrypted_operations,
        })
        .unwrap();
        let manifest = json!({
            "protocol": PROTOCOL,
            "collectionId": uuid::Uuid::new_v4().to_string(),
            "format": "torder-sync",
            "schemaVersion": 2,
            "latestSequence": 1,
            "updatedAt": "2026-08-21T00:00:00.000Z",
            "encryption": config,
        });

        let correct_path = std::env::temp_dir().join(format!(
            "torder-sync-webdav-encrypted-pull-{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        let correct_database = Database::initialize(correct_path.clone()).unwrap();
        configure_local_encryption(&correct_database, &config, &key);
        let (address, _requests, handle) = spawn_mock_dav(
            MockDavConfig {
                manifest: Some(manifest.clone()),
                batch: Some(batch.clone()),
                ..MockDavConfig::default()
            },
            8,
        );
        let client = WebDavClient::new_for_test(address);
        tauri::async_runtime::block_on(run_with_client(&correct_database, &client, "sync"))
            .unwrap();
        let connection = correct_database.connect().unwrap();
        assert_eq!(
            connection
                .query_row(
                    "SELECT title FROM tasks WHERE id = 'encrypted-remote-task'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "远端加密任务"
        );
        credentials::remove_encryption_keys(&connection).unwrap();
        drop(connection);
        handle.join().unwrap();
        drop(correct_database);
        cleanup_database(&correct_path);

        let (_wrong_config, wrong_key) = crypto::create_config("wrong password").unwrap();
        let wrong_path = std::env::temp_dir().join(format!(
            "torder-sync-webdav-encrypted-wrong-{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        let wrong_database = Database::initialize(wrong_path.clone()).unwrap();
        configure_local_encryption(&wrong_database, &config, &wrong_key);
        let (wrong_address, _wrong_requests, wrong_handle) = spawn_mock_dav(
            MockDavConfig {
                manifest: Some(manifest),
                batch: Some(batch),
                ..MockDavConfig::default()
            },
            6,
        );
        let wrong_client = WebDavClient::new_for_test(wrong_address);
        let error =
            tauri::async_runtime::block_on(run_with_client(&wrong_database, &wrong_client, "sync"))
                .unwrap_err()
                .to_string();
        assert!(
            error.contains("incorrect") || error.contains("damaged"),
            "{error}"
        );
        let connection = wrong_database.connect().unwrap();
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM tasks WHERE id = 'encrypted-remote-task'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            0
        );
        assert!(
            sync_repository::get_state(&connection, "lastRemoteSequence")
                .unwrap()
                .is_none()
        );
        credentials::remove_encryption_keys(&connection).unwrap();
        drop(connection);
        wrong_handle.join().unwrap();
        drop(wrong_database);
        cleanup_database(&wrong_path);
    }

    #[test]
    fn plaintext_collection_can_be_migrated_to_encryption_by_rotation() {
        let _keyring_guard = keyring_test_guard();
        let path = std::env::temp_dir().join(format!(
            "torder-sync-webdav-plaintext-migration-{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        let database = Database::initialize(path.clone()).unwrap();
        let (address, requests, handle) = spawn_mock_dav(
            MockDavConfig {
                manifest: Some(empty_manifest()),
                ..MockDavConfig::default()
            },
            7,
        );
        let client = WebDavClient::new_for_test(address);
        tauri::async_runtime::block_on(rotate_encryption_with_client(
            &database,
            &client,
            "sync",
            "migrate sync password",
        ))
        .unwrap();
        let connection = database.connect().unwrap();
        let config: EncryptionConfig = serde_json::from_str(
            &sync_repository::get_state(&connection, "encryptionConfig")
                .unwrap()
                .unwrap(),
        )
        .unwrap();
        assert!(credentials::has_encryption_key(&connection, &config.key_id).unwrap());
        let manifest: Manifest = requests
            .lock()
            .unwrap()
            .iter()
            .rev()
            .find(|request| request.method == "PUT" && request.path.ends_with("/manifest.json"))
            .map(|request| serde_json::from_slice(&request.body).unwrap())
            .unwrap();
        assert_eq!(manifest.encryption, Some(config));
        credentials::remove_encryption_keys(&connection).unwrap();
        drop(connection);
        handle.join().unwrap();
        drop(database);
        cleanup_database(&path);
    }

    #[test]
    fn encrypted_snapshot_restores_business_objects_without_remote_plaintext() {
        let _keyring_guard = keyring_test_guard();
        let (config, key) = crypto::create_config("snapshot sync password").unwrap();
        let mut snapshot_operation = operation(
            "snapshot-1-0",
            "task",
            "encrypted-snapshot-task",
            json!({
                "id": "encrypted-snapshot-task",
                "title": "只存在于加密快照",
                "status": "todo",
                "priority": 1,
                "listId": "work",
                "sortOrder": 0,
                "deletedAt": null
            }),
        );
        let context = EncryptionContext {
            config: config.clone(),
            key: key.clone(),
        };
        encrypt_operations(
            std::slice::from_mut(&mut snapshot_operation),
            Some(&context),
        )
        .unwrap();
        let snapshot = Snapshot {
            protocol: PROTOCOL,
            sequence: 1,
            created_at: "2026-08-21T00:00:00.000Z".to_owned(),
            operations: vec![snapshot_operation],
        };
        let encoded_snapshot = encode_snapshot(&snapshot).unwrap();
        assert!(!String::from_utf8_lossy(&encoded_snapshot).contains("只存在于加密快照"));
        let manifest = json!({
            "protocol": PROTOCOL,
            "collectionId": uuid::Uuid::new_v4().to_string(),
            "format": "torder-sync",
            "schemaVersion": 2,
            "latestSequence": 1,
            "snapshotSequence": 1,
            "updatedAt": "2026-08-21T00:00:00.000Z",
            "encryption": config,
        });
        let path = std::env::temp_dir().join(format!(
            "torder-sync-webdav-encrypted-snapshot-{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        let database = Database::initialize(path.clone()).unwrap();
        configure_local_encryption(&database, &config, &key);
        let (address, _requests, handle) = spawn_mock_dav(
            MockDavConfig {
                manifest: Some(manifest),
                snapshot: Some(encoded_snapshot),
                ..MockDavConfig::default()
            },
            9,
        );
        let client = WebDavClient::new_for_test(address);
        tauri::async_runtime::block_on(run_with_client(&database, &client, "sync")).unwrap();
        let connection = database.connect().unwrap();
        assert_eq!(
            connection
                .query_row(
                    "SELECT title FROM tasks WHERE id = 'encrypted-snapshot-task'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "只存在于加密快照"
        );
        credentials::remove_encryption_keys(&connection).unwrap();
        drop(connection);
        handle.join().unwrap();
        drop(database);
        cleanup_database(&path);
    }

    #[test]
    fn webdav_flow_pulls_remote_batch_before_finishing() {
        let collection_id = uuid::Uuid::new_v4().to_string();
        let manifest = json!({
            "protocol": PROTOCOL,
            "collectionId": collection_id,
            "format": "torder-sync",
            "schemaVersion": 2,
            "latestSequence": 1,
            "updatedAt": "2026-08-21T00:00:00.000Z"
        });
        let batch = serde_json::to_value(ChangeBatch {
            protocol: PROTOCOL,
            sequence: 1,
            device_id: "remote-device".to_owned(),
            created_at: "2026-08-21T00:00:00.000Z".to_owned(),
            operations: vec![operation(
                "remote-list-change",
                "list",
                "remote-list",
                json!({
                    "id": "remote-list",
                    "name": "远端同步清单",
                    "color": "#123456",
                    "sortOrder": 0,
                    "isDefault": false,
                    "deletedAt": null
                }),
            )],
        })
        .unwrap();
        let config = MockDavConfig {
            manifest: Some(manifest),
            batch: Some(batch),
            ..MockDavConfig::default()
        };
        let (address, requests, handle) = spawn_mock_dav(config, 8);
        let client = WebDavClient::new_for_test(address);
        let path = std::env::temp_dir().join(format!(
            "torder-sync-webdav-pull-{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        let database = Database::initialize(path.clone()).unwrap();

        tauri::async_runtime::block_on(run_with_client(&database, &client, "sync")).unwrap();

        let connection = database.connect().unwrap();
        assert_eq!(
            connection
                .query_row(
                    "SELECT name FROM lists WHERE id = 'remote-list'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "远端同步清单"
        );
        assert_eq!(
            sync_repository::get_state(&connection, "lastRemoteSequence")
                .unwrap()
                .as_deref(),
            Some("1")
        );
        let devices = sync_repository::list_devices(&connection).unwrap();
        assert!(devices
            .iter()
            .any(|device| device.current && device.enabled));
        assert!(devices.iter().any(|device| {
            device.id == "remote-device" && device.enabled && device.last_remote_sequence == 1
        }));
        sync_repository::revoke_device(&connection, "remote-device").unwrap();
        assert!(!sync_repository::is_device_enabled(&connection, "remote-device").unwrap());
        let current_device = devices.iter().find(|device| device.current).unwrap();
        assert!(sync_repository::revoke_device(&connection, &current_device.id).is_err());
        let requests = requests.lock().unwrap();
        let manifest_update = requests
            .iter()
            .rev()
            .find(|request| request.method == "PUT" && request.path.ends_with("/manifest.json"))
            .unwrap();
        let manifest: Manifest = serde_json::from_slice(&manifest_update.body).unwrap();
        assert!(manifest
            .devices
            .iter()
            .any(|device| device.id == current_device.id && device.enabled));
        assert!(manifest
            .devices
            .iter()
            .any(|device| device.id == "remote-device" && device.enabled));
        drop(requests);
        handle.join().unwrap();
        drop(connection);
        drop(database);
        cleanup_database(&path);
    }

    #[test]
    fn webdav_flow_restores_compressed_snapshot_before_pruned_history() {
        let snapshot = Snapshot {
            protocol: PROTOCOL,
            sequence: 1,
            created_at: "2026-08-21T00:00:00.000Z".to_owned(),
            operations: vec![operation(
                "snapshot-1-0",
                "task",
                "snapshot-task",
                json!({
                    "id": "snapshot-task",
                    "title": "来自压缩快照",
                    "status": "todo",
                    "priority": 1,
                    "listId": "work",
                    "sortOrder": 0,
                    "deletedAt": null
                }),
            )],
        };
        let manifest = json!({
            "protocol": PROTOCOL,
            "collectionId": uuid::Uuid::new_v4().to_string(),
            "format": "torder-sync",
            "schemaVersion": 2,
            "latestSequence": 1,
            "snapshotSequence": 1,
            "updatedAt": "2026-08-21T00:00:00.000Z"
        });
        let config = MockDavConfig {
            manifest: Some(manifest),
            snapshot: Some(encode_snapshot(&snapshot).unwrap()),
            ..MockDavConfig::default()
        };
        let (address, requests, handle) = spawn_mock_dav(config, 9);
        let client = WebDavClient::new_for_test(address);
        let path = std::env::temp_dir().join(format!(
            "torder-sync-webdav-snapshot-{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        let database = Database::initialize(path.clone()).unwrap();

        tauri::async_runtime::block_on(run_with_client(&database, &client, "sync")).unwrap();

        let connection = database.connect().unwrap();
        assert_eq!(
            connection
                .query_row(
                    "SELECT title FROM tasks WHERE id = 'snapshot-task'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "来自压缩快照"
        );
        assert_eq!(
            sync_repository::get_state(&connection, "lastRemoteSequence")
                .unwrap()
                .as_deref(),
            Some("1")
        );
        let requests = requests.lock().unwrap();
        assert!(requests.iter().any(|request| {
            request.method == "GET"
                && request
                    .path
                    .ends_with("/snapshots/00000000000000000001.json.gz")
        }));
        assert!(requests.iter().any(|request| {
            request.method == "DELETE"
                && request.path.ends_with("/changes/00000000000000000001.json")
        }));
        drop(requests);
        handle.join().unwrap();
        drop(connection);
        drop(database);
        cleanup_database(&path);
    }

    #[test]
    fn webdav_manifest_revocation_blocks_the_current_device() {
        let manifest = json!({
            "protocol": PROTOCOL,
            "collectionId": uuid::Uuid::new_v4().to_string(),
            "format": "torder-sync",
            "schemaVersion": 2,
            "latestSequence": 0,
            "updatedAt": "2026-08-21T00:00:00.000Z",
            "devices": [{
                "id": "local-device",
                "name": "已撤销设备",
                "lastSeenAt": "2026-08-21T00:00:00.000Z",
                "enabled": false
            }]
        });
        let config = MockDavConfig {
            manifest: Some(manifest),
            ..MockDavConfig::default()
        };
        let (address, _requests, handle) = spawn_mock_dav(config, 5);
        let client = WebDavClient::new_for_test(address);
        let path = std::env::temp_dir().join(format!(
            "torder-sync-webdav-revoked-{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        let database = Database::initialize(path.clone()).unwrap();
        sync_repository::set_state(&database.connect().unwrap(), "deviceId", "local-device")
            .unwrap();

        let error = tauri::async_runtime::block_on(run_with_client(&database, &client, "sync"))
            .unwrap_err()
            .to_string();

        assert!(error.contains("revoked"), "{error}");
        handle.join().unwrap();
        drop(database);
        cleanup_database(&path);
    }

    #[test]
    fn webdav_flow_generates_occurrence_after_pulling_recurring_rule() {
        let manifest = json!({
            "protocol": PROTOCOL,
            "collectionId": uuid::Uuid::new_v4().to_string(),
            "format": "torder-sync",
            "schemaVersion": 2,
            "latestSequence": 1,
            "updatedAt": "2026-08-21T00:00:00.000Z"
        });
        let batch = serde_json::to_value(ChangeBatch {
            protocol: PROTOCOL,
            sequence: 1,
            device_id: "remote-device".to_owned(),
            created_at: "2026-08-21T00:00:00.000Z".to_owned(),
            operations: vec![operation(
                "remote-rule-change",
                "recurringRule",
                "remote-rule",
                json!({
                    "id": "remote-rule",
                    "title": "远端到期循环任务",
                    "priority": 1,
                    "listId": "work",
                    "frequency": "daily",
                    "intervalCount": 1,
                    "weekdays": [],
                    "monthDay": null,
                    "firstDueAt": "2026-08-20T09:00:00Z",
                    "nextDueAt": "2026-08-20T09:00:00Z",
                    "timezone": "UTC",
                    "generateAheadMinutes": 0,
                    "remindBefore": null,
                    "endAt": null,
                    "enabled": true,
                    "deletedAt": null
                }),
            )],
        })
        .unwrap();
        let config = MockDavConfig {
            manifest: Some(manifest),
            batch: Some(batch),
            ..MockDavConfig::default()
        };
        let (address, _requests, handle) = spawn_mock_dav(config, 10);
        let client = WebDavClient::new_for_test(address);
        let path = std::env::temp_dir().join(format!(
            "torder-sync-webdav-recurring-{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        let database = Database::initialize(path.clone()).unwrap();

        tauri::async_runtime::block_on(run_with_client(&database, &client, "sync")).unwrap();

        let connection = database.connect().unwrap();
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM tasks WHERE recurring_rule_id = 'remote-rule'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            1
        );
        assert_eq!(sync_repository::pending_count(&connection).unwrap(), 0);
        assert_eq!(
            sync_repository::get_state(&connection, "lastRemoteSequence")
                .unwrap()
                .as_deref(),
            Some("2")
        );
        handle.join().unwrap();
        drop(connection);
        drop(database);
        cleanup_database(&path);
    }

    #[test]
    fn webdav_manifest_conflict_keeps_local_changes_pending() {
        let config = MockDavConfig {
            manifest: Some(empty_manifest()),
            fail_manifest_update: true,
            ..MockDavConfig::default()
        };
        let (address, _requests, handle) = spawn_mock_dav(config, 7);
        let client = WebDavClient::new_for_test(address);
        let path = std::env::temp_dir().join(format!(
            "torder-sync-webdav-conflict-{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        let database = Database::initialize(path.clone()).unwrap();
        create_pending_task(&database);

        let result = tauri::async_runtime::block_on(run_with_client(&database, &client, "sync"));

        assert!(result
            .unwrap_err()
            .to_string()
            .contains("remote manifest changed"));
        assert_eq!(
            sync_repository::pending_count(&database.connect().unwrap()).unwrap(),
            1
        );
        handle.join().unwrap();
        drop(database);
        cleanup_database(&path);
    }

    #[test]
    fn webdav_verification_failure_keeps_local_changes_pending() {
        let config = MockDavConfig {
            manifest: Some(empty_manifest()),
            corrupt_batch_read: true,
            ..MockDavConfig::default()
        };
        let (address, _requests, handle) = spawn_mock_dav(config, 9);
        let client = WebDavClient::new_for_test(address);
        let path = std::env::temp_dir().join(format!(
            "torder-sync-webdav-verify-{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        let database = Database::initialize(path.clone()).unwrap();
        create_pending_task(&database);

        let result = tauri::async_runtime::block_on(run_with_client(&database, &client, "sync"));

        let error = result.unwrap_err().to_string();
        assert!(
            error.contains("remote write verification failed"),
            "{error}"
        );
        assert_eq!(
            sync_repository::pending_count(&database.connect().unwrap()).unwrap(),
            1
        );
        handle.join().unwrap();
        drop(database);
        cleanup_database(&path);
    }

    #[test]
    fn soft_lock_reclaims_expired_lock_and_rejects_active_lock() {
        let expired_config = MockDavConfig {
            lock_payload: Some(json!({
                "deviceId": "other-device",
                "expiresAt": "2020-01-01T00:00:00Z"
            })),
            ..MockDavConfig::default()
        };
        let (address, requests, handle) = spawn_mock_dav(expired_config, 4);
        let client = WebDavClient::new_for_test(address);
        tauri::async_runtime::block_on(acquire_soft_lock(
            &client,
            "sync/locks/sync.lock",
            "local-device",
        ))
        .unwrap();
        let methods = requests
            .lock()
            .unwrap()
            .iter()
            .map(|request| request.method.clone())
            .collect::<Vec<_>>();
        assert_eq!(methods, vec!["PUT", "GET", "DELETE", "PUT"]);
        handle.join().unwrap();

        let active_config = MockDavConfig {
            lock_payload: Some(json!({
                "deviceId": "other-device",
                "expiresAt": "2999-01-01T00:00:00Z"
            })),
            ..MockDavConfig::default()
        };
        let (address, _requests, handle) = spawn_mock_dav(active_config, 2);
        let client = WebDavClient::new_for_test(address);
        let error = tauri::async_runtime::block_on(acquire_soft_lock(
            &client,
            "sync/locks/sync.lock",
            "local-device",
        ))
        .unwrap_err()
        .to_string();
        assert!(error.contains("remote sync lock is held"));
        handle.join().unwrap();
    }

    #[test]
    fn manifest_without_etag_is_guarded_by_soft_lock() {
        let initial_manifest = empty_manifest();
        let config = MockDavConfig {
            manifest: Some(initial_manifest.clone()),
            manifest_without_etag: true,
            ..MockDavConfig::default()
        };
        let (address, requests, handle) = spawn_mock_dav(config, 5);
        let client = WebDavClient::new_for_test(address);
        let manifest: Manifest = serde_json::from_value(initial_manifest).unwrap();
        tauri::async_runtime::block_on(put_manifest(
            &client,
            "sync/manifest.json",
            &manifest,
            None,
            0,
            "local-device",
        ))
        .unwrap();
        let requests = requests.lock().unwrap();
        assert_eq!(requests[0].method, "PUT");
        assert!(requests[0].path.contains("/locks/sync.lock"));
        assert_eq!(requests[1].method, "GET");
        assert_eq!(requests[2].method, "PUT");
        assert_eq!(requests[3].method, "DELETE");
        assert_eq!(requests[4].method, "GET");
        drop(requests);
        handle.join().unwrap();
    }

    #[test]
    fn history_cleanup_requires_age_and_all_active_devices_acknowledgement() {
        let path = std::env::temp_dir().join(format!(
            "torder-sync-cleanup-{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        let database = Database::initialize(path.clone()).unwrap();
        let connection = database.connect().unwrap();
        sync_repository::ensure_device(&connection, "local-device", "本机").unwrap();
        sync_repository::update_device_sync(
            &connection,
            "local-device",
            "2026-08-21T00:00:00.000Z",
            10,
        )
        .unwrap();
        sync_repository::ensure_device(&connection, "lagging-device", "旧设备").unwrap();
        sync_repository::update_device_sync(
            &connection,
            "lagging-device",
            "2026-08-21T00:00:00.000Z",
            9,
        )
        .unwrap();
        connection
            .execute(
                "INSERT INTO sync_changes (id, entity, object_id, operation, base_revision, revision, payload_json, created_at, uploaded_at, remote_sequence) VALUES ('old-change', 'task', 'old-task', 'delete', 1, 2, '{}', '2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z', 10)",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO sync_objects (entity, object_id, revision, last_changed_at, deleted_at) VALUES ('task', 'old-task', 2, '2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z')",
                [],
            )
            .unwrap();
        let blocked = sync_repository::prune_history(&connection).unwrap();
        assert_eq!(blocked.changes_removed, 0);
        assert_eq!(blocked.tombstones_removed, 0);
        sync_repository::update_device_sync(
            &connection,
            "lagging-device",
            "2026-08-21T00:00:00.000Z",
            10,
        )
        .unwrap();
        let result = sync_repository::prune_history(&connection).unwrap();
        assert_eq!(result.changes_removed, 1);
        assert_eq!(result.tombstones_removed, 1);
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM sync_changes WHERE id = 'old-change'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            0
        );

        drop(connection);
        drop(database);
        cleanup_database(&path);
    }

    #[test]
    fn compressed_snapshot_round_trips_and_restores_business_state() {
        let source_path = std::env::temp_dir().join(format!(
            "torder-sync-snapshot-source-{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        let source = Database::initialize(source_path.clone()).unwrap();
        crate::db::task_repository::TaskRepository::new(&source)
            .create(crate::models::CreateTaskInput {
                title: "快照任务".to_owned(),
                note: Some("不会包含凭据".to_owned()),
                priority: Some(2),
                list_id: Some("work".to_owned()),
                scheduled_date: None,
                due_at: None,
                sort_order: None,
                remind_before: None,
                repeat_rule: None,
                subtasks: None,
                tags: None,
            })
            .unwrap();
        let mut source_connection = source.connect().unwrap();
        let mut snapshot = build_snapshot(&mut source_connection, 7).unwrap();
        snapshot.created_at = "2026-08-21T00:00:00.000Z".to_owned();
        let encoded = encode_snapshot(&snapshot).unwrap();
        assert_eq!(encoded, encode_snapshot(&snapshot).unwrap());
        let decoded = decode_snapshot(&encoded).unwrap();
        assert_eq!(decoded.sequence, 7);
        assert_eq!(decoded.operations.len(), 1);

        let target_path = std::env::temp_dir().join(format!(
            "torder-sync-snapshot-target-{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        let target = Database::initialize(target_path.clone()).unwrap();
        let mut target_connection = target.connect().unwrap();
        apply_snapshot(&mut target_connection, &decoded).unwrap();
        assert_eq!(
            target_connection
                .query_row(
                    "SELECT title FROM tasks WHERE title = '快照任务'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "快照任务"
        );
        let mut repeated_snapshot = decoded.clone();
        repeated_snapshot.sequence = 8;
        repeated_snapshot.operations[0].id = "snapshot-8-0".to_owned();
        apply_snapshot(&mut target_connection, &repeated_snapshot).unwrap();
        assert_eq!(
            target_connection
                .query_row(
                    "SELECT COUNT(*) FROM sync_conflicts WHERE resolved_at IS NULL",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            0
        );
        assert!(decode_snapshot(b"not-gzip").is_err());

        drop(source_connection);
        drop(target_connection);
        drop(source);
        drop(target);
        cleanup_database(&source_path);
        cleanup_database(&target_path);
    }

    #[test]
    fn remote_history_cleanup_waits_for_every_enabled_device_ack() {
        let manifest = Manifest {
            protocol: PROTOCOL,
            collection_id: uuid::Uuid::new_v4().to_string(),
            format: "torder-sync".to_owned(),
            schema_version: 2,
            latest_sequence: 2,
            snapshot_sequence: 2,
            updated_at: "2026-08-21T00:00:00.000Z".to_owned(),
            encryption: None,
            devices: vec![ManifestDevice {
                id: "device-a".to_owned(),
                name: "设备 A".to_owned(),
                last_seen_at: "2026-08-21T00:00:00.000Z".to_owned(),
                last_sequence: 1,
                enabled: true,
            }],
        };
        let (address, requests, handle) = spawn_mock_dav(MockDavConfig::default(), 2);
        let client = WebDavClient::new_for_test(address);
        assert_eq!(
            tauri::async_runtime::block_on(cleanup_remote_history(&client, "sync", &manifest, 0))
                .unwrap(),
            None
        );
        let mut acknowledged = manifest;
        acknowledged.devices[0].last_sequence = 2;
        assert_eq!(
            tauri::async_runtime::block_on(cleanup_remote_history(
                &client,
                "sync",
                &acknowledged,
                0,
            ))
            .unwrap(),
            Some(2)
        );
        let requests = requests.lock().unwrap();
        assert_eq!(requests.len(), 2);
        assert!(requests
            .iter()
            .all(|request| request.method == "DELETE" && request.path.contains("/changes/")));
        drop(requests);
        handle.join().unwrap();
    }

    #[test]
    fn remote_attachment_cleanup_waits_for_every_enabled_device_ack() {
        let path = std::env::temp_dir().join(format!(
            "torder-sync-attachment-cleanup-{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        let database = Database::initialize(path.clone()).unwrap();
        let connection = database.connect().unwrap();
        connection
            .execute(
                "INSERT INTO tasks (id, title, status, priority, list_id, sort_order) VALUES ('task-1', '附件任务', 'todo', 1, 'work', 0)",
                [],
            )
            .unwrap();
        connection
            .execute(
                r#"
                INSERT INTO attachment_blobs (
                    id, content_sha256, size_bytes, local_relative_path,
                    remote_path, sync_state, created_at, updated_at
                ) VALUES (
                    'blob-1',
                    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                    8,
                    'attachments/blobs/bl/blob-1.bin',
                    'attachments/blobs/bl/blob-1.bin',
                    'uploaded',
                    '2020-01-01T00:00:00.000Z',
                    '2020-01-01T00:00:00.000Z'
                )
                "#,
                [],
            )
            .unwrap();
        connection
            .execute(
                r#"
                INSERT INTO task_attachments (
                    id, task_id, kind, blob_id, display_name,
                    created_at, updated_at, deleted_at
                ) VALUES (
                    'attachment-1',
                    'task-1',
                    'managed',
                    'blob-1',
                    '合同.pdf',
                    '2020-01-01T00:00:00.000Z',
                    '2020-01-01T00:00:00.000Z',
                    '2020-01-01T00:00:00.000Z'
                )
                "#,
                [],
            )
            .unwrap();
        connection
            .execute(
                r#"
                INSERT INTO sync_changes (
                    id, entity, object_id, operation, base_revision, revision,
                    payload_json, created_at, uploaded_at, remote_sequence
                ) VALUES (
                    'change-1',
                    'attachment',
                    'attachment-1',
                    'delete',
                    1,
                    2,
                    '{}',
                    '2020-01-01T00:00:00.000Z',
                    '2020-01-01T00:00:00.000Z',
                    10
                )
                "#,
                [],
            )
            .unwrap();

        let mut manifest = Manifest {
            protocol: PROTOCOL,
            collection_id: uuid::Uuid::new_v4().to_string(),
            format: "torder-sync".to_owned(),
            schema_version: 2,
            latest_sequence: 10,
            snapshot_sequence: 0,
            updated_at: "2026-08-21T00:00:00.000Z".to_owned(),
            encryption: None,
            devices: vec![
                ManifestDevice {
                    id: "device-a".to_owned(),
                    name: "设备 A".to_owned(),
                    last_seen_at: "2026-08-21T00:00:00.000Z".to_owned(),
                    last_sequence: 9,
                    enabled: true,
                },
                ManifestDevice {
                    id: "device-disabled".to_owned(),
                    name: "停用设备".to_owned(),
                    last_seen_at: "2026-08-21T00:00:00.000Z".to_owned(),
                    last_sequence: 0,
                    enabled: false,
                },
            ],
        };
        assert!(remote_attachment_cleanup_candidates(&connection, &manifest)
            .unwrap()
            .is_empty());
        manifest.devices[0].last_sequence = 10;
        let candidates = remote_attachment_cleanup_candidates(&connection, &manifest).unwrap();
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].remote_path, "attachments/blobs/bl/blob-1.bin");
        drop(connection);

        let (address, requests, handle) = spawn_mock_dav(
            MockDavConfig {
                blob: Some(b"old body".to_vec()),
                ..MockDavConfig::default()
            },
            1,
        );
        let client = WebDavClient::new_for_test(address);
        let removed = tauri::async_runtime::block_on(cleanup_remote_attachment_blobs(
            &database, &client, "sync", &manifest,
        ))
        .unwrap();
        assert_eq!(removed, 1);
        let requests = requests.lock().unwrap();
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].method, "DELETE");
        assert!(requests[0]
            .path
            .contains("/sync/attachments/blobs/bl/blob-1.bin"));
        drop(requests);
        handle.join().unwrap();
        drop(database);
        cleanup_database(&path);
    }

    #[test]
    fn bootstrap_tracks_existing_objects_once_without_default_list_noise() {
        let path = std::env::temp_dir().join(format!(
            "torder-sync-bootstrap-{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        let database = Database::initialize(path.clone()).unwrap();
        let mut connection = database.connect().unwrap();
        connection
            .execute(
                "INSERT INTO lists (id, name, color, sort_order, is_default) VALUES ('legacy-list', '旧清单', '#123456', 4, 0)",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO tasks (id, title, status, priority, list_id, sort_order) VALUES ('legacy-task', '升级前任务', 'todo', 1, 'legacy-list', 0)",
                [],
            )
            .unwrap();

        bootstrap_existing_objects(&mut connection).unwrap();
        bootstrap_existing_objects(&mut connection).unwrap();

        assert_eq!(sync_repository::pending_count(&connection).unwrap(), 2);
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM sync_objects WHERE entity = 'list' AND object_id IN ('work', 'personal', 'study')",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            0
        );
        let list_change = sync_repository::list_pending(&connection, 10)
            .unwrap()
            .into_iter()
            .find(|change| change.object_id == "legacy-list")
            .unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&list_change.payload_json)
                .unwrap()
                .get("isDefault"),
            Some(&Value::Bool(false))
        );

        drop(connection);
        drop(database);
        cleanup_database(&path);
    }

    fn empty_manifest() -> Value {
        json!({
            "protocol": PROTOCOL,
            "collectionId": uuid::Uuid::new_v4().to_string(),
            "format": "torder-sync",
            "schemaVersion": 2,
            "latestSequence": 0,
            "updatedAt": "2026-08-21T00:00:00.000Z"
        })
    }

    fn create_pending_task(database: &Database) {
        crate::db::task_repository::TaskRepository::new(database)
            .create(crate::models::CreateTaskInput {
                title: "待同步任务".to_owned(),
                note: None,
                priority: Some(1),
                list_id: Some("work".to_owned()),
                scheduled_date: None,
                due_at: None,
                sort_order: None,
                remind_before: None,
                repeat_rule: None,
                subtasks: None,
                tags: None,
            })
            .unwrap();
    }

    fn configure_local_encryption(
        database: &Database,
        config: &EncryptionConfig,
        key: &crypto::EncryptionKey,
    ) {
        let connection = database.connect().unwrap();
        sync_repository::set_state(
            &connection,
            "encryptionConfig",
            &serde_json::to_string(config).unwrap(),
        )
        .unwrap();
        let mut stored = crypto::StoredKeys::default();
        crypto::add_stored_key(&mut stored, &config.key_id, key, true);
        credentials::store_encryption_keys(&connection, &stored).unwrap();
    }

    #[derive(Default)]
    struct MockDavConfig {
        manifest: Option<Value>,
        batch: Option<Value>,
        snapshot: Option<Vec<u8>>,
        blob: Option<Vec<u8>>,
        fail_manifest_update: bool,
        corrupt_batch_read: bool,
        manifest_without_etag: bool,
        lock_payload: Option<Value>,
    }

    #[derive(Debug)]
    struct MockRequest {
        method: String,
        path: String,
        raw_headers: String,
        body: Vec<u8>,
    }

    struct MockResponse {
        status: u16,
        body: Vec<u8>,
        etag: Option<&'static str>,
    }

    fn spawn_mock_dav(
        config: MockDavConfig,
        expected_requests: usize,
    ) -> (SocketAddr, Arc<Mutex<Vec<MockRequest>>>, JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let requests = Arc::new(Mutex::new(Vec::new()));
        let captured = Arc::clone(&requests);
        let handle = std::thread::spawn(move || {
            let mut manifest = config.manifest;
            let mut batch = config.batch;
            let mut snapshot = config.snapshot;
            let mut blob = config.blob;
            let mut lock_payload = config.lock_payload;
            let mut manifest_version = if manifest.is_some() { 1 } else { 0 };
            for _ in 0..expected_requests {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(std::time::Duration::from_secs(2)))
                    .unwrap();
                let request = read_mock_request(&mut stream);
                let response = if request.path.contains("/locks/sync.lock") {
                    match request.method.as_str() {
                        "PUT" if lock_payload.is_some() => MockResponse {
                            status: 412,
                            body: Vec::new(),
                            etag: None,
                        },
                        "PUT" => {
                            lock_payload = Some(serde_json::from_slice(&request.body).unwrap());
                            MockResponse {
                                status: 201,
                                body: Vec::new(),
                                etag: None,
                            }
                        }
                        "GET" => match lock_payload.as_ref() {
                            Some(value) => MockResponse {
                                status: 200,
                                body: serde_json::to_vec(value).unwrap(),
                                etag: None,
                            },
                            None => MockResponse {
                                status: 404,
                                body: Vec::new(),
                                etag: None,
                            },
                        },
                        "DELETE" => {
                            lock_payload = None;
                            MockResponse {
                                status: 204,
                                body: Vec::new(),
                                etag: None,
                            }
                        }
                        _ => MockResponse {
                            status: 500,
                            body: Vec::new(),
                            etag: None,
                        },
                    }
                } else if request.method == "MKCOL" {
                    MockResponse {
                        status: 201,
                        body: Vec::new(),
                        etag: None,
                    }
                } else if request.path.ends_with("/manifest.json") && request.method == "GET" {
                    match manifest.as_ref() {
                        Some(value) => MockResponse {
                            status: 200,
                            body: serde_json::to_vec(value).unwrap(),
                            etag: (!config.manifest_without_etag).then_some({
                                if manifest_version <= 1 {
                                    "\"v1\""
                                } else {
                                    "\"v2\""
                                }
                            }),
                        },
                        None => MockResponse {
                            status: 404,
                            body: Vec::new(),
                            etag: None,
                        },
                    }
                } else if request.path.ends_with("/manifest.json") && request.method == "PUT" {
                    if config.fail_manifest_update && manifest.is_some() {
                        MockResponse {
                            status: 412,
                            body: Vec::new(),
                            etag: None,
                        }
                    } else {
                        manifest = Some(serde_json::from_slice(&request.body).unwrap());
                        manifest_version += 1;
                        MockResponse {
                            status: 201,
                            body: Vec::new(),
                            etag: None,
                        }
                    }
                } else if request.path.contains("/changes/") && request.method == "PUT" {
                    batch = Some(serde_json::from_slice(&request.body).unwrap());
                    MockResponse {
                        status: 201,
                        body: Vec::new(),
                        etag: None,
                    }
                } else if request.path.contains("/changes/") && request.method == "GET" {
                    if config.corrupt_batch_read {
                        MockResponse {
                            status: 200,
                            body: b"{}".to_vec(),
                            etag: None,
                        }
                    } else {
                        match batch.as_ref() {
                            Some(value) => MockResponse {
                                status: 200,
                                body: serde_json::to_vec(value).unwrap(),
                                etag: None,
                            },
                            None => MockResponse {
                                status: 404,
                                body: Vec::new(),
                                etag: None,
                            },
                        }
                    }
                } else if request.path.contains("/attachments/blobs/") && request.method == "PUT" {
                    if blob.is_some() {
                        MockResponse {
                            status: 412,
                            body: Vec::new(),
                            etag: None,
                        }
                    } else {
                        blob = Some(request.body.clone());
                        MockResponse {
                            status: 201,
                            body: Vec::new(),
                            etag: None,
                        }
                    }
                } else if request.path.contains("/attachments/blobs/") && request.method == "GET" {
                    match blob.as_ref() {
                        Some(value) => MockResponse {
                            status: 200,
                            body: value.clone(),
                            etag: None,
                        },
                        None => MockResponse {
                            status: 404,
                            body: Vec::new(),
                            etag: None,
                        },
                    }
                } else if request.path.contains("/attachments/blobs/") && request.method == "DELETE"
                {
                    blob = None;
                    MockResponse {
                        status: 204,
                        body: Vec::new(),
                        etag: None,
                    }
                } else if request.path.contains("/snapshots/") && request.method == "PUT" {
                    snapshot = Some(request.body.clone());
                    MockResponse {
                        status: 201,
                        body: Vec::new(),
                        etag: None,
                    }
                } else if request.path.contains("/snapshots/") && request.method == "GET" {
                    match snapshot.as_ref() {
                        Some(value) => MockResponse {
                            status: 200,
                            body: value.clone(),
                            etag: None,
                        },
                        None => MockResponse {
                            status: 404,
                            body: Vec::new(),
                            etag: None,
                        },
                    }
                } else if request.path.contains("/changes/") && request.method == "DELETE" {
                    MockResponse {
                        status: 204,
                        body: Vec::new(),
                        etag: None,
                    }
                } else {
                    MockResponse {
                        status: 500,
                        body: Vec::new(),
                        etag: None,
                    }
                };
                write_mock_response(&mut stream, response);
                captured.lock().unwrap().push(request);
            }
        });
        (address, requests, handle)
    }

    fn read_mock_request(stream: &mut std::net::TcpStream) -> MockRequest {
        let mut request = Vec::new();
        let mut buffer = [0_u8; 4096];
        loop {
            let count = stream.read(&mut buffer).unwrap_or(0);
            if count == 0 {
                break;
            }
            request.extend_from_slice(&buffer[..count]);
            let Some(header_end) = request.windows(4).position(|value| value == b"\r\n\r\n") else {
                continue;
            };
            let headers = String::from_utf8_lossy(&request[..header_end + 4]);
            let content_length = headers
                .lines()
                .find_map(|line| {
                    line.to_ascii_lowercase()
                        .strip_prefix("content-length:")
                        .and_then(|value| value.trim().parse::<usize>().ok())
                })
                .unwrap_or(0);
            if request.len() >= header_end + 4 + content_length {
                break;
            }
        }
        let header_end = request
            .windows(4)
            .position(|value| value == b"\r\n\r\n")
            .unwrap();
        let raw_headers = String::from_utf8_lossy(&request[..header_end]).to_ascii_lowercase();
        let mut request_line = raw_headers.lines().next().unwrap().split_whitespace();
        MockRequest {
            method: request_line.next().unwrap().to_ascii_uppercase(),
            path: request_line.next().unwrap().to_owned(),
            raw_headers,
            body: request[header_end + 4..].to_vec(),
        }
    }

    fn write_mock_response(stream: &mut std::net::TcpStream, response: MockResponse) {
        let reason = match response.status {
            200 => "OK",
            201 => "Created",
            204 => "No Content",
            404 => "Not Found",
            412 => "Precondition Failed",
            _ => "Internal Server Error",
        };
        let etag = response
            .etag
            .map(|value| format!("ETag: {value}\r\n"))
            .unwrap_or_default();
        let encoded = format!(
            "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\n{}Content-Length: {}\r\nConnection: close\r\n\r\n",
            response.status,
            reason,
            etag,
            response.body.len()
        );
        stream.write_all(encoded.as_bytes()).unwrap();
        stream.write_all(&response.body).unwrap();
    }

    fn cleanup_database(path: &std::path::Path) {
        let _ = std::fs::remove_file(path);
        let _ = std::fs::remove_file(format!("{}-wal", path.display()));
        let _ = std::fs::remove_file(format!("{}-shm", path.display()));
    }
}

fn device_id(connection: &rusqlite::Connection) -> RepositoryResult<String> {
    if let Some(value) = sync_repository::get_state(connection, "deviceId")? {
        return Ok(value);
    }
    let value = uuid::Uuid::new_v4().to_string();
    sync_repository::set_state(connection, "deviceId", &value)?;
    Ok(value)
}

fn device_name(connection: &rusqlite::Connection) -> RepositoryResult<String> {
    Ok(sync_repository::get_state(connection, "deviceName")?
        .unwrap_or_else(|| format!("Torder · {}", std::env::consts::OS)))
}

fn remote_device_name(id: &str) -> String {
    let short_id = id.chars().take(8).collect::<String>();
    format!("远端设备 · {short_id}")
}

fn bootstrap_existing_objects(connection: &mut rusqlite::Connection) -> RepositoryResult<()> {
    let transaction = connection.transaction()?;
    for (entity, query) in [
        (
            "list",
            "SELECT item.id FROM lists AS item LEFT JOIN sync_objects AS object ON object.entity = 'list' AND object.object_id = item.id WHERE object.object_id IS NULL AND item.is_default = 0",
        ),
        (
            "recurringRule",
            "SELECT item.id FROM recurring_rules AS item LEFT JOIN sync_objects AS object ON object.entity = 'recurringRule' AND object.object_id = item.id WHERE object.object_id IS NULL",
        ),
        (
            "task",
            "SELECT item.id FROM tasks AS item LEFT JOIN sync_objects AS object ON object.entity = 'task' AND object.object_id = item.id WHERE object.object_id IS NULL",
        ),
        (
            "taskLink",
            "SELECT item.id FROM task_links AS item LEFT JOIN sync_objects AS object ON object.entity = 'taskLink' AND object.object_id = item.id WHERE object.object_id IS NULL",
        ),
        (
            "attachment",
            "SELECT item.id FROM task_attachments AS item LEFT JOIN sync_objects AS object ON object.entity = 'attachment' AND object.object_id = item.id WHERE object.object_id IS NULL",
        ),
        (
            "calendarEvent",
            "SELECT item.id FROM calendar_events AS item LEFT JOIN sync_objects AS object ON object.entity = 'calendarEvent' AND object.object_id = item.id WHERE object.object_id IS NULL",
        ),
    ] {
        let ids = {
            let mut statement = transaction.prepare(query)?;
            let values = statement
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            values
        };
        for id in ids {
            let payload = current_payload(&transaction, entity, &id)?;
            let operation = if payload.get("deletedAt").and_then(Value::as_str).is_some() {
                "delete"
            } else {
                "upsert"
            };
            sync_repository::record_change(&transaction, entity, &id, operation, payload)?;
        }
    }
    transaction.commit()?;
    Ok(())
}
