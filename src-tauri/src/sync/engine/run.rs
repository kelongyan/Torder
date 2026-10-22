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

/// 彻底移除「已撤销」的设备记录（本地 + 远端 manifest）。
///
/// 与 `revoke_remote_device` 的区别：撤销只是把 `enabled` 置 false，记录仍留在
/// manifest 里。而「移除同步配置 → 重新添加」会换一个新的 `deviceId`，旧记录
/// 留在原处，于是同名设备越积越多（issue #12 的「3 个变 4 个」）。
///
/// **必须先改远端再删本地**：`run_with_client_once` 会用 manifest 里的设备列表
/// 覆盖本地 `sync_devices`（`import_manifest_device`），只删本地的话下一次同步
/// 就全被导回来了。
///
/// 只删 `enabled = false` 的条目，且永远保留当前设备：活着的设备哪怕同名也不
/// 受影响（默认名 `Torder · windows` 在两台同型号机器上会撞名，按名字去重
/// 会误伤另一台正常设备）。
pub async fn prune_revoked_remote_devices(
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
    let current_device_id = device_id(&connection)?;
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

    let before = manifest.devices.len();
    manifest
        .devices
        .retain(|device| device.enabled || device.id == current_device_id);
    let removed_remotely = (before - manifest.devices.len()) as i64;
    if removed_remotely > 0 {
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
    }

    let connection = database.connect()?;
    let removed_locally = sync_repository::prune_revoked_devices(&connection)?;
    Ok(removed_remotely.max(removed_locally))
}

/// 测试用：走已建好的 client，避免测试里再起一遍网络栈。
#[cfg(test)]
pub(crate) async fn prune_revoked_remote_devices_with_client(
    database: &Database,
    client: &WebDavClient,
    remote_path: &str,
) -> RepositoryResult<i64> {
    let connection = database.connect()?;
    let current_device_id = device_id(&connection)?;
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

    let before = manifest.devices.len();
    manifest
        .devices
        .retain(|device| device.enabled || device.id == current_device_id);
    let removed_remotely = (before - manifest.devices.len()) as i64;
    if removed_remotely > 0 {
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
    }

    let connection = database.connect()?;
    let removed_locally = sync_repository::prune_revoked_devices(&connection)?;
    Ok(removed_remotely.max(removed_locally))
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
    //
    // 序号争用重试：两台设备同时同步时，双方都会读到同一个 latestSequence，
    // 各自去占 sequence+1，后到的那个必然被拒。这不是错误而是正常并发——
    // 这里直接重开一轮（重读 manifest → 拿到新序号），不向用户报错。
    // 上限 3 次：超过就说明对方持续在写，交给上层的退避重试。
    let mut sequence_conflict_retries = 0_usize;
    let mut first_pass = true;
    loop {
        let mode = if first_pass {
            first_pass = false;
            initial_mode
        } else {
            InitialSyncMode::Merge
        };
        match run_with_client_once(database, client, remote_path, mode).await {
            Ok(()) => {}
            Err(error)
                if error.is_retryable_conflict()
                    && sequence_conflict_retries < MAX_SEQUENCE_CONFLICT_RETRIES =>
            {
                sequence_conflict_retries += 1;
                // 让出一点时间，避免两台设备退避步调完全一致而反复撞车。
                tokio::time::sleep(std::time::Duration::from_millis(
                    120 * sequence_conflict_retries as u64,
                ))
                .await;
                continue;
            }
            Err(error) => return Err(error),
        }
        let connection = database.connect()?;
        if sync_repository::pending_count(&connection)? == 0 {
            return Ok(());
        }
    }
}

const MAX_SEQUENCE_CONFLICT_RETRIES: usize = 3;

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
    let batch_write = put_change_batch_create_only(client, &batch_path, &batch_value).await?;
    // 孤儿批次接管（见 `BatchWrite::AlreadyMine`）：这份批次是本机上次写到一半
    // 留下的（文件已写、manifest 没推），于是 `latestSequence` 永远停在 N，
    // 之后每次同步都去占 N+1 并撞车——**自动重试无法自愈**，因为冲突永远
    // 发生在同一个序号上。
    //
    // 处理方式：承认这份孤儿批次是远端历史的一部分，只把 manifest 推进到它，
    // 然后立刻返回让外层再开一轮——本地待传变更**保持 pending**（孤儿批次里
    // 是旧内容，绝不能拿它当成"已上传"去清 pending），下一轮会在 N+2 正常上传。
    let adopted_orphan = matches!(batch_write, BatchWrite::AlreadyMine);
    if adopted_orphan {
        let previous_sequence = manifest.latest_sequence;
        manifest.latest_sequence = sequence;
        manifest.updated_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
        put_manifest(
            client,
            &manifest_path,
            &manifest,
            manifest_etag.as_deref(),
            previous_sequence,
            &local_device_id,
        )
        .await?;
        sync_repository::set_state(&connection, "lastRemoteSequence", &sequence.to_string())?;
        // 不标记 uploaded、不更新 lastSyncAt：本轮没有真正上传任何东西。
        // 外层会重新跑一轮，在下一个序号上把 pending 真正推上去。
        return Ok(());
    }
    if pending_total <= MAX_BATCH_OPERATIONS as i64 && operation_count == changes.len() {
        let mut snapshot = build_snapshot(&mut connection, sequence)?;
        snapshot.created_at = batch.created_at.clone();
        if snapshot.operations.len() >= SNAPSHOT_MIN_OBJECTS || sequence % SNAPSHOT_INTERVAL == 0 {
            let snapshot_path = format!("{root}/snapshots/{sequence:020}.json.gz");
            encrypt_operations(&mut snapshot.operations, encryption.as_ref())?;
            let snapshot_payload = encode_snapshot(&snapshot)?;
            put_snapshot_create_only(client, &snapshot_path, &snapshot_payload).await?;
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
