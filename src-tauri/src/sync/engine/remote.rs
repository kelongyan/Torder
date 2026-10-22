// 远程探测与路径：inspect_remote、read_remote_manifest、路径工具。

use super::*;

use crate::error::{RepositoryError, RepositoryResult};
use crate::models::SyncRemoteInspection;
use crate::sync::manifest::Manifest;
use crate::sync::webdav::{WebDavClient, WebDavError};

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

pub(crate) fn missing_remote_collection(status: reqwest::StatusCode) -> bool {
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

pub(crate) async fn read_remote_manifest(
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

pub(crate) fn validated_remote_root(remote_path: &str) -> RepositoryResult<String> {
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

pub(crate) fn remote_collection_paths(root: &str) -> Vec<String> {
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

/// 「仅创建」写入变更批次。
///
/// 不能只依赖 `If-None-Match: *`：坚果云会忽略该前置条件直接覆盖（实测 204），
/// 于是另一台设备刚占位的同序号批次会被静默摧毁，远端历史与该设备本地记录永久分叉。
/// 这里先显式探一次存在性；内容一致说明是本设备上次中断后的重试，可继续。
/// 批次写入结果。
///
/// `Written`：本次真的写入了（或内容一致的重试）。
/// `AlreadyMine`：该序号上已经有一份**本机自己**之前写的批次，但 manifest 当时
/// 没推进——这是一个可以自愈的中断态（见 `adopt_orphaned_batch`）。
pub(crate) enum BatchWrite {
    Written,
    AlreadyMine,
}

pub(crate) async fn put_change_batch_create_only(
    client: &WebDavClient,
    path: &str,
    value: &serde_json::Value,
) -> RepositoryResult<BatchWrite> {
    if client
        .exists(path)
        .await
        .map_err(|error| RepositoryError::Tauri(error.to_string()))?
    {
        return confirm_existing_batch(client, path, value).await;
    }
    match client.put_json_if_none_match(path, value).await {
        Ok(()) => Ok(BatchWrite::Written),
        Err(WebDavError::Http(status)) if status == reqwest::StatusCode::PRECONDITION_FAILED => {
            confirm_existing_batch(client, path, value).await
        }
        Err(error) => Err(RepositoryError::Tauri(error.to_string())),
    }
}

/// 判定已存在的同序号批次归属。
///
/// 内容完全一致 → 本机上次中断后的重试，直接继续（幂等）。
/// 内容不同但 `deviceId` 是本机 → 典型的「批次已写入、manifest 未推进」中断态。
///
/// 这个中断态会永久卡死同步：`latestSequence` 停在 N，而 `changes/N+1.json`
/// 已经存在，之后每次同步都尝试占 N+1 并撞车（用户实测：一直报
/// remote sequence was claimed，重试 3 次也没用）。自动重试在这里无效，
/// 因为冲突永远在同一个序号上。正确做法是**接管**这份孤儿批次。
async fn confirm_existing_batch(
    client: &WebDavClient,
    path: &str,
    value: &serde_json::Value,
) -> RepositoryResult<BatchWrite> {
    let existing = client
        .get_json(path)
        .await
        .map_err(|error| RepositoryError::Tauri(error.to_string()))?;
    if &existing == value {
        return Ok(BatchWrite::Written);
    }
    if existing.get("deviceId").and_then(serde_json::Value::as_str)
        == value.get("deviceId").and_then(serde_json::Value::as_str)
    {
        return Ok(BatchWrite::AlreadyMine);
    }
    Err(RepositoryError::RemoteSequenceTaken)
}

/// 「仅创建」写入快照，语义与 `put_change_batch_create_only` 一致。
pub(crate) async fn put_snapshot_create_only(
    client: &WebDavClient,
    path: &str,
    payload: &[u8],
) -> RepositoryResult<()> {
    if client
        .exists(path)
        .await
        .map_err(|error| RepositoryError::Tauri(error.to_string()))?
    {
        return confirm_existing_snapshot(client, path, payload).await;
    }
    match client
        .put_snapshot_if_none_match(path, payload.to_vec())
        .await
    {
        Ok(()) => Ok(()),
        Err(WebDavError::Http(status)) if status == reqwest::StatusCode::PRECONDITION_FAILED => {
            confirm_existing_snapshot(client, path, payload).await
        }
        Err(error) => Err(RepositoryError::Tauri(error.to_string())),
    }
}

async fn confirm_existing_snapshot(
    client: &WebDavClient,
    path: &str,
    payload: &[u8],
) -> RepositoryResult<()> {
    let existing = client
        .get_snapshot(path)
        .await
        .map_err(|error| RepositoryError::Tauri(error.to_string()))?;
    if existing == payload {
        return Ok(());
    }
    Err(RepositoryError::RemoteSequenceTaken)
}
