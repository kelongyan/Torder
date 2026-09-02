// manifest 读写 + 软锁 + 设备清单维护。

use super::*;


use chrono::{SecondsFormat, Utc};
use serde_json::json;

use crate::db::sync_repository;
use crate::error::{RepositoryError, RepositoryResult};
use crate::sync::manifest::{
    EncryptionConfig, Manifest, ManifestDevice,
};
use crate::sync::webdav::{WebDavClient, WebDavError};

pub(crate) async fn load_or_create_manifest(
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
                schema_version: SCHEMA_VERSION,
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

/// 每次写 manifest 都把协议字段拉到当前版本。
///
/// 老集合是 protocol/schemaVersion = 1；v1→v2 只新增了 attachment / taskLink 实体，
/// 结构没有破坏性变化，所以新客户端读得懂 v1，并在这里就地升级。不做这一步的话，
/// 升级过的客户端会把自己建的老集合永久判为 "incompatible" 而彻底停止同步。
fn normalize_manifest_protocol(manifest: &mut Manifest) {
    manifest.protocol = PROTOCOL;
    manifest.schema_version = SCHEMA_VERSION;
}

pub(crate) async fn put_manifest(
    client: &WebDavClient,
    manifest_path: &str,
    manifest: &Manifest,
    etag: Option<&str>,
    expected_previous_sequence: i64,
    lock_device_id: &str,
) -> RepositoryResult<Manifest> {
    let mut upgraded = manifest.clone();
    normalize_manifest_protocol(&mut upgraded);
    let manifest_value = serde_json::to_value(&upgraded)?;
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

pub(crate) async fn acquire_soft_lock(
    client: &WebDavClient,
    lock_path: &str,
    device_id: &str,
) -> RepositoryResult<()> {
    let expires_at = (Utc::now() + chrono::Duration::minutes(2)).to_rfc3339();
    let payload = json!({
        "deviceId": device_id,
        "expiresAt": expires_at,
    });
    // 先显式探一次：坚果云一类服务端会忽略 If-None-Match: * 直接覆盖，
    // 只靠条件写会让软锁形同虚设（谁写谁都"抢到"锁）。
    let mut held = client
        .exists(lock_path)
        .await
        .map_err(|error| RepositoryError::Tauri(error.to_string()))?;
    if !held {
        match client.put_json_if_none_match(lock_path, &payload).await {
            Ok(()) => return Ok(()),
            Err(WebDavError::Http(status))
                if status == reqwest::StatusCode::PRECONDITION_FAILED =>
            {
                held = true;
            }
            Err(error) => return Err(RepositoryError::Tauri(error.to_string())),
        }
    }
    debug_assert!(held);
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

async fn release_soft_lock(client: &WebDavClient, lock_path: &str) -> RepositoryResult<()> {
    match client.delete(lock_path).await {
        Ok(()) | Err(WebDavError::Http(reqwest::StatusCode::NOT_FOUND)) => Ok(()),
        Err(error) => Err(RepositoryError::Tauri(error.to_string())),
    }
}

pub(crate) fn refresh_manifest_devices(
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
