// 加密配置探测与轮换。

use super::*;

use chrono::{SecondsFormat, Utc};

use crate::db::{sync_repository, Database};
use crate::error::{RepositoryError, RepositoryResult};
use crate::sync::crypto::{self};
use crate::sync::manifest::{ChangeBatch, EncryptionConfig, Manifest};
use crate::sync::webdav::WebDavClient;

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
    // 序号冲突在轮换里是「可自愈」的：孤儿空批次会被接管并推进 manifest，
    // 下一轮换一个新序号继续。没有这个循环，注释里的「重试一次即可」就只是
    // 一句空话，用户会一直看到同一个冲突。
    let mut retries = 0_usize;
    loop {
        match rotate_encryption_once(database, client, remote_path, new_password).await {
            Ok(()) => return Ok(()),
            Err(error)
                if error.is_retryable_conflict() && retries < MAX_ROTATION_SEQUENCE_RETRIES =>
            {
                retries += 1;
                tokio::time::sleep(std::time::Duration::from_millis(150 * retries as u64)).await;
            }
            Err(error) => return Err(error),
        }
    }
}

const MAX_ROTATION_SEQUENCE_RETRIES: usize = 3;

async fn rotate_encryption_once(
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
    // 这份空批次是本机上轮中断留下的孤儿（例如 manifest 没推进）。它没有
    // operations，内容与新轮换无关，可以安全接管：把它记入远端历史并推进
    // manifest，下一轮换新序号重写空批次 + 新密钥快照。
    if matches!(
        put_change_batch_create_only(client, &batch_path, &batch_value).await?,
        BatchWrite::AlreadyMine
    ) {
        adopt_rotation_sequence(
            database,
            client,
            &manifest_path,
            &mut manifest,
            manifest_etag.as_deref(),
            sequence,
            &local_device_id,
        )
        .await?;
        return Err(RepositoryError::RemoteSequenceTaken);
    }
    let snapshot_path = format!("{root}/snapshots/{sequence:020}.json.gz");
    match put_snapshot_create_only(client, &snapshot_path, &snapshot_payload).await {
        Ok(()) => {}
        Err(RepositoryError::RemoteSequenceTaken) => {
            // 上轮已写入快照但 manifest 没推进；空批次是本机的，接管序号后重试。
            adopt_rotation_sequence(
                database,
                client,
                &manifest_path,
                &mut manifest,
                manifest_etag.as_deref(),
                sequence,
                &local_device_id,
            )
            .await?;
            return Err(RepositoryError::RemoteSequenceTaken);
        }
        Err(error) => return Err(error),
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

/// 把一轮中断留下的孤儿序号记入远端历史，供下一轮换新序号继续。
///
/// 孤儿批次是**空批次**（零 operations），所以推进 manifest 不会丢任何业务
/// 变更；同时把本地 `lastRemoteSequence` 推到该序号，否则下一轮的前置校验
/// 会以「先同步远端」为由再次拒绝。
async fn adopt_rotation_sequence(
    database: &Database,
    client: &WebDavClient,
    manifest_path: &str,
    manifest: &mut Manifest,
    etag: Option<&str>,
    sequence: i64,
    device_id: &str,
) -> RepositoryResult<()> {
    let previous_sequence = manifest.latest_sequence;
    manifest.latest_sequence = sequence;
    manifest.updated_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    put_manifest(
        client,
        manifest_path,
        manifest,
        etag,
        previous_sequence,
        device_id,
    )
    .await?;
    // 连接必须在 await 之后再打开：&rusqlite::Connection 不是 Sync，
    // 持有它跨 await 会让 Tauri command 的 future 失去 Send。
    let connection = database.connect()?;
    sync_repository::set_state(&connection, "lastRemoteSequence", &sequence.to_string())?;
    Ok(())
}
