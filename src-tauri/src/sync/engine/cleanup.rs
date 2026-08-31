// 远端历史与附件清理。

use super::*;



use crate::db::{
    sync_repository, Database,
};
use crate::error::{RepositoryError, RepositoryResult};
use crate::sync::manifest::Manifest;
use crate::sync::webdav::{WebDavClient, WebDavError};

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

pub(crate) async fn cleanup_remote_history(
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
pub(crate) struct RemoteAttachmentCleanupCandidate {
    pub(crate) remote_path: String,
    pub(crate) delete_sequence: i64,
}

pub(crate) async fn cleanup_remote_attachment_blobs(
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

pub(crate) fn remote_attachment_cleanup_candidates(
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

pub(crate) fn remote_pruned_sequence(connection: &rusqlite::Connection) -> RepositoryResult<i64> {
    Ok(
        sync_repository::get_state(connection, "remotePrunedSequence")?
            .and_then(|value| value.parse::<i64>().ok())
            .unwrap_or(0),
    )
}
