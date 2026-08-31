// 附件 blob 上传/下载/校验。

use super::*;

use std::collections::BTreeSet;
use std::fs;

use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::db::{
    attachment_repository::{
        attachment_tmp_dir, blob_absolute_path, managed_blob_relative_path, sha256_file,
        AttachmentBlobTransfer, AttachmentRepository, MAX_ATTACHMENT_FILE_BYTES,
    }, Database,
};
use crate::error::{RepositoryError, RepositoryResult};
use crate::models::SyncChange;
use crate::sync::crypto::{self};
use crate::sync::webdav::{WebDavClient, WebDavError};

pub(crate) async fn upload_attachment_blobs_for_changes(
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

pub(crate) async fn download_pending_attachment_blobs(
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

pub(crate) fn sha256_bytes(payload: &[u8]) -> String {
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

pub(crate) fn validate_attachment_remote_path(path: &str) -> RepositoryResult<()> {
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
