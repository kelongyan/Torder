use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use chrono::{SecondsFormat, Utc};
use rusqlite::{params, Row};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::error::{RepositoryError, RepositoryResult};
use crate::models::{
    Attachment, AttachmentDiagnostics, AttachmentTransferStatus, CreateAttachmentInput,
    CreateWebLinkAttachmentInput,
};

use super::{sync_repository, Database};

pub const ATTACHMENTS_DIR_NAME: &str = "attachments";
pub const MAX_ATTACHMENT_FILE_BYTES: u64 = 100 * 1024 * 1024;
const MAX_TASK_ATTACHMENTS: i64 = 50;

#[derive(Debug, Clone)]
pub struct AttachmentBlobTransfer {
    pub id: String,
    pub content_sha256: String,
    pub size_bytes: i64,
    pub local_relative_path: String,
    pub remote_path: Option<String>,
    pub encryption_key_id: Option<String>,
}

pub struct AttachmentRepository<'database> {
    database: &'database Database,
}

impl<'database> AttachmentRepository<'database> {
    pub fn new(database: &'database Database) -> Self {
        Self { database }
    }

    pub fn create_managed(
        &self,
        data_dir: &Path,
        input: CreateAttachmentInput,
    ) -> RepositoryResult<Attachment> {
        let task_id = validate_id(&input.task_id)?;
        let source = canonical_file(&input.source_path)?;
        let metadata = fs::metadata(&source)?;
        if metadata.len() > MAX_ATTACHMENT_FILE_BYTES {
            return Err(RepositoryError::Validation("attachment file is too large"));
        }
        let original_name = source
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("attachment")
            .to_owned();
        let display_name = validate_display_name(input.display_name.as_deref(), &original_name)?;
        let attachment_id = Uuid::new_v4().to_string();
        let blob_id = Uuid::new_v4().to_string();
        let local_relative_path = managed_blob_relative_path(&blob_id);
        let remote_path = local_relative_path.clone();
        let target = blob_absolute_path(data_dir, &local_relative_path)?;
        let target_parent = target
            .parent()
            .ok_or(RepositoryError::Validation("invalid attachment path"))?;
        fs::create_dir_all(target_parent)?;
        let tmp_dir = attachment_tmp_dir(data_dir);
        fs::create_dir_all(&tmp_dir)?;
        let tmp_path = tmp_dir.join(format!("{}.part", Uuid::new_v4()));
        let copy_result = copy_file_with_hash(&source, &tmp_path);
        let (content_sha256, size_bytes) = match copy_result {
            Ok(value) => value,
            Err(error) => {
                let _ = fs::remove_file(&tmp_path);
                return Err(error);
            }
        };
        if let Err(error) = fs::rename(&tmp_path, &target) {
            let _ = fs::remove_file(&tmp_path);
            return Err(error.into());
        }

        let mut connection = self.database.connect()?;
        let transaction = connection.transaction()?;
        ensure_task_exists(&transaction, &task_id)?;
        ensure_attachment_capacity(&transaction, &task_id)?;
        transaction.execute(
            r#"
            INSERT INTO attachment_blobs (
                id, content_sha256, size_bytes, mime_type, local_relative_path,
                remote_path, sync_state
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pendingUpload')
            "#,
            params![
                blob_id,
                content_sha256,
                size_bytes,
                guess_mime_type(&original_name),
                local_relative_path,
                remote_path,
            ],
        )?;
        transaction.execute(
            r#"
            INSERT INTO task_attachments (
                id, task_id, kind, blob_id, display_name, original_name, sort_order
            ) VALUES (
                ?1, ?2, 'managed', ?3, ?4, ?5,
                COALESCE((SELECT MAX(sort_order) + 1000 FROM task_attachments WHERE task_id = ?2), 0)
            )
            "#,
            params![attachment_id, task_id, blob_id, display_name, original_name],
        )?;
        let attachment = query_attachment(&transaction, &attachment_id)?;
        record_attachment_change(&transaction, &attachment, "upsert")?;
        transaction.commit()?;
        Ok(with_managed_local_path(data_dir, attachment))
    }

    pub fn create_local_reference(
        &self,
        input: CreateAttachmentInput,
    ) -> RepositoryResult<Attachment> {
        let task_id = validate_id(&input.task_id)?;
        let source = canonical_file(&input.source_path)?;
        let original_name = source
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("attachment")
            .to_owned();
        let display_name = validate_display_name(input.display_name.as_deref(), &original_name)?;
        let attachment_id = Uuid::new_v4().to_string();
        let mut connection = self.database.connect()?;
        let transaction = connection.transaction()?;
        ensure_task_exists(&transaction, &task_id)?;
        ensure_attachment_capacity(&transaction, &task_id)?;
        transaction.execute(
            r#"
            INSERT INTO task_attachments (
                id, task_id, kind, display_name, original_name, sort_order
            ) VALUES (
                ?1, ?2, 'localReference', ?3, ?4,
                COALESCE((SELECT MAX(sort_order) + 1000 FROM task_attachments WHERE task_id = ?2), 0)
            )
            "#,
            params![attachment_id, task_id, display_name, original_name],
        )?;
        transaction.execute(
            "INSERT INTO local_attachment_references (attachment_id, local_path) VALUES (?1, ?2)",
            params![attachment_id, source.display().to_string()],
        )?;
        let attachment = query_attachment(&transaction, &attachment_id)?;
        transaction.commit()?;
        Ok(attachment)
    }

    pub fn create_web_link(
        &self,
        input: CreateWebLinkAttachmentInput,
    ) -> RepositoryResult<Attachment> {
        let task_id = validate_id(&input.task_id)?;
        let url = validate_url(&input.url)?;
        let display_name = validate_display_name(Some(&input.display_name), &url)?;
        let attachment_id = Uuid::new_v4().to_string();
        let mut connection = self.database.connect()?;
        let transaction = connection.transaction()?;
        ensure_task_exists(&transaction, &task_id)?;
        ensure_attachment_capacity(&transaction, &task_id)?;
        transaction.execute(
            r#"
            INSERT INTO task_attachments (
                id, task_id, kind, display_name, external_url, sort_order
            ) VALUES (
                ?1, ?2, 'webLink', ?3, ?4,
                COALESCE((SELECT MAX(sort_order) + 1000 FROM task_attachments WHERE task_id = ?2), 0)
            )
            "#,
            params![attachment_id, task_id, display_name, url],
        )?;
        let attachment = query_attachment(&transaction, &attachment_id)?;
        record_attachment_change(&transaction, &attachment, "upsert")?;
        transaction.commit()?;
        Ok(attachment)
    }

    pub fn list_by_task(
        &self,
        data_dir: &Path,
        task_id: &str,
    ) -> RepositoryResult<Vec<Attachment>> {
        let task_id = validate_id(task_id)?;
        let connection = self.database.connect()?;
        let mut statement = connection.prepare(&format!(
            "{} WHERE a.task_id = ?1 AND a.deleted_at IS NULL ORDER BY a.sort_order ASC, a.created_at ASC",
            select_attachments()
        ))?;
        let attachments = statement
            .query_map(params![task_id], map_attachment)?
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .map(|attachment| with_managed_local_path(data_dir, attachment))
            .collect();
        Ok(attachments)
    }

    pub fn get(&self, data_dir: &Path, id: &str) -> RepositoryResult<Attachment> {
        let connection = self.database.connect()?;
        let attachment = query_attachment_by_id(&connection, id)?;
        Ok(with_managed_local_path(data_dir, attachment))
    }

    pub fn soft_delete(&self, id: &str) -> RepositoryResult<()> {
        let now = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
        let mut connection = self.database.connect()?;
        let transaction = connection.transaction()?;
        let existing = query_attachment(&transaction, id)?;
        let updated = transaction.execute(
            r#"
            UPDATE task_attachments
            SET deleted_at = ?2, updated_at = ?2
            WHERE id = ?1 AND deleted_at IS NULL
            "#,
            params![id, now],
        )?;
        if updated == 0 {
            return Err(RepositoryError::NotFound("attachment"));
        }
        if existing.kind != "localReference" {
            let mut deleted = query_attachment(&transaction, id)?;
            deleted.deleted_at = Some(now);
            record_attachment_change(&transaction, &deleted, "delete")?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn resolve_local_path(&self, data_dir: &Path, id: &str) -> RepositoryResult<PathBuf> {
        let attachment = self.get(data_dir, id)?;
        match attachment.kind.as_str() {
            "managed" => {
                let relative = attachment
                    .local_relative_path
                    .as_deref()
                    .ok_or(RepositoryError::Validation("attachment file is missing"))?;
                let path = blob_absolute_path(data_dir, relative)?;
                if !path.is_file() {
                    return Err(RepositoryError::NotFound("attachment file"));
                }
                Ok(path)
            }
            "localReference" => {
                let path = attachment
                    .local_path
                    .as_deref()
                    .ok_or(RepositoryError::Validation("attachment path is missing"))?;
                let path = PathBuf::from(path);
                if !path.is_file() {
                    return Err(RepositoryError::NotFound("attachment file"));
                }
                Ok(path)
            }
            "webLink" => Err(RepositoryError::Validation("web link has no local file")),
            _ => Err(RepositoryError::Validation("invalid attachment kind")),
        }
    }

    pub fn mark_blob_uploaded(
        &self,
        blob_id: &str,
        remote_path: &str,
        encryption_key_id: Option<&str>,
    ) -> RepositoryResult<()> {
        self.update_blob_state(
            blob_id,
            "uploaded",
            Some(remote_path),
            encryption_key_id,
            None,
        )
    }

    pub fn mark_blob_downloaded(
        &self,
        blob_id: &str,
        local_relative_path: &str,
    ) -> RepositoryResult<()> {
        let connection = self.database.connect()?;
        let updated = connection.execute(
            r#"
            UPDATE attachment_blobs
            SET sync_state = 'downloaded',
                local_relative_path = ?2,
                last_error = NULL,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?1 AND deleted_at IS NULL
            "#,
            params![blob_id, local_relative_path],
        )?;
        if updated == 0 {
            return Err(RepositoryError::NotFound("attachment blob"));
        }
        Ok(())
    }

    pub fn mark_blob_failed(&self, blob_id: &str, error: &str) -> RepositoryResult<()> {
        self.update_blob_state(blob_id, "failed", None, None, Some(error))
    }

    pub fn mark_blob_missing(&self, blob_id: &str, error: &str) -> RepositoryResult<()> {
        self.update_blob_state(blob_id, "missing", None, None, Some(error))
    }

    pub fn list_blobs_by_ids(
        &self,
        blob_ids: &[String],
    ) -> RepositoryResult<Vec<AttachmentBlobTransfer>> {
        let mut blobs = Vec::new();
        let connection = self.database.connect()?;
        let mut statement = connection.prepare(
            r#"
            SELECT id, content_sha256, size_bytes, local_relative_path, remote_path, encryption_key_id
            FROM attachment_blobs
            WHERE id = ?1 AND deleted_at IS NULL
            "#,
        )?;
        for blob_id in blob_ids {
            let blob = statement.query_row(params![blob_id], map_blob_transfer)?;
            blobs.push(blob);
        }
        Ok(blobs)
    }

    pub fn list_pending_downloads(
        &self,
        limit: i64,
    ) -> RepositoryResult<Vec<AttachmentBlobTransfer>> {
        let connection = self.database.connect()?;
        let mut statement = connection.prepare(
            r#"
            SELECT id, content_sha256, size_bytes, local_relative_path, remote_path, encryption_key_id
            FROM attachment_blobs
            WHERE sync_state = 'pendingDownload'
              AND remote_path IS NOT NULL
              AND deleted_at IS NULL
            ORDER BY updated_at ASC
            LIMIT ?1
            "#,
        )?;
        let blobs = statement
            .query_map(params![limit.clamp(1, 5000)], map_blob_transfer)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(blobs)
    }

    pub fn refresh_pending_attachment_changes(&self) -> RepositoryResult<()> {
        let connection = self.database.connect()?;
        let mut statement = connection.prepare(
            "SELECT object_id FROM sync_changes WHERE entity = 'attachment' AND uploaded_at IS NULL",
        )?;
        let ids = statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        drop(statement);
        for id in ids {
            let attachment = query_attachment_by_id(&connection, &id)?;
            connection.execute(
                "UPDATE sync_changes SET payload_json = ?2 WHERE entity = 'attachment' AND object_id = ?1 AND uploaded_at IS NULL",
                params![id, serde_json::to_string(&attachment_sync_payload(&attachment))?],
            )?;
        }
        Ok(())
    }

    pub fn diagnostics(&self) -> RepositoryResult<AttachmentDiagnostics> {
        let connection = self.database.connect()?;
        let managed_count = connection.query_row(
            "SELECT COUNT(*) FROM task_attachments WHERE kind = 'managed' AND deleted_at IS NULL",
            [],
            |row| row.get(0),
        )?;
        let managed_bytes = connection.query_row(
            r#"
            SELECT COALESCE(SUM(size_bytes), 0)
            FROM (
                SELECT DISTINCT b.id, b.size_bytes
                FROM attachment_blobs AS b
                INNER JOIN task_attachments AS a ON a.blob_id = b.id
                WHERE a.kind = 'managed'
                  AND a.deleted_at IS NULL
                  AND b.deleted_at IS NULL
            )
            "#,
            [],
            |row| row.get(0),
        )?;
        let orphans = orphan_blob_rows(&connection, 0)?;
        Ok(AttachmentDiagnostics {
            managed_count,
            managed_bytes,
            orphan_count: orphans.len() as i64,
            orphan_bytes: orphans.iter().map(|blob| blob.size_bytes).sum(),
            pending_upload: count_blobs_by_state(&connection, "pendingUpload")?,
            pending_download: count_blobs_by_state(&connection, "pendingDownload")?,
            failed: count_blobs_by_state(&connection, "failed")?,
            missing: count_blobs_by_state(&connection, "missing")?,
        })
    }

    pub fn cleanup_orphan_blobs(
        &self,
        data_dir: &Path,
        retention_days: i64,
    ) -> RepositoryResult<(i64, i64)> {
        let connection = self.database.connect()?;
        let rows = orphan_blob_rows(&connection, retention_days)?;
        let now = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
        let mut removed_count = 0_i64;
        let mut removed_bytes = 0_i64;
        for blob in rows {
            let path = blob_absolute_path(data_dir, &blob.local_relative_path)?;
            if path.is_file() {
                let file_bytes = fs::metadata(&path)
                    .map(|metadata| metadata.len().min(i64::MAX as u64) as i64)
                    .unwrap_or(blob.size_bytes);
                fs::remove_file(&path)?;
                removed_bytes += file_bytes;
            }
            connection.execute(
                "UPDATE attachment_blobs SET deleted_at = ?2, updated_at = ?2, last_error = NULL WHERE id = ?1 AND deleted_at IS NULL",
                params![blob.id, now],
            )?;
            removed_count += 1;
        }
        Ok((removed_count, removed_bytes))
    }

    pub fn transfer_status(&self) -> RepositoryResult<AttachmentTransferStatus> {
        let connection = self.database.connect()?;
        Ok(AttachmentTransferStatus {
            pending_upload: count_blobs_by_state(&connection, "pendingUpload")?,
            pending_download: count_blobs_by_state(&connection, "pendingDownload")?,
            failed: count_blobs_by_state(&connection, "failed")?,
            missing: count_blobs_by_state(&connection, "missing")?,
        })
    }

    fn update_blob_state(
        &self,
        blob_id: &str,
        sync_state: &str,
        remote_path: Option<&str>,
        encryption_key_id: Option<&str>,
        last_error: Option<&str>,
    ) -> RepositoryResult<()> {
        let connection = self.database.connect()?;
        let updated = connection.execute(
            r#"
            UPDATE attachment_blobs
            SET sync_state = ?2,
                remote_path = COALESCE(?3, remote_path),
                encryption_key_id = COALESCE(?4, encryption_key_id),
                last_error = ?5,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?1 AND deleted_at IS NULL
            "#,
            params![
                blob_id,
                sync_state,
                remote_path,
                encryption_key_id,
                last_error
            ],
        )?;
        if updated == 0 {
            return Err(RepositoryError::NotFound("attachment blob"));
        }
        Ok(())
    }
}

pub fn attachment_root(data_dir: &Path) -> PathBuf {
    data_dir.join(ATTACHMENTS_DIR_NAME)
}

pub fn attachment_blob_root(data_dir: &Path) -> PathBuf {
    attachment_root(data_dir).join("blobs")
}

pub fn attachment_tmp_dir(data_dir: &Path) -> PathBuf {
    attachment_root(data_dir).join("tmp")
}

pub fn managed_blob_relative_path(blob_id: &str) -> String {
    let prefix = blob_id.chars().take(2).collect::<String>();
    format!("{ATTACHMENTS_DIR_NAME}/blobs/{prefix}/{blob_id}.bin")
}

pub fn blob_absolute_path(data_dir: &Path, relative_path: &str) -> RepositoryResult<PathBuf> {
    if relative_path.contains('\\')
        || relative_path.starts_with('/')
        || relative_path.contains(':')
        || relative_path
            .split('/')
            .any(|segment| segment.is_empty() || segment == "." || segment == "..")
    {
        return Err(RepositoryError::Validation("invalid attachment path"));
    }
    Ok(data_dir.join(relative_path))
}

pub fn sha256_file(path: &Path) -> RepositoryResult<(String, i64)> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut size = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        size = size
            .checked_add(read as u64)
            .ok_or(RepositoryError::Validation("attachment file is too large"))?;
        hasher.update(&buffer[..read]);
    }
    Ok((hex_lower(&hasher.finalize()), size as i64))
}

pub(crate) fn attachment_sync_payload(attachment: &Attachment) -> Value {
    json!({
        "id": attachment.id,
        "taskId": attachment.task_id,
        "kind": attachment.kind,
        "blobId": attachment.blob_id,
        "displayName": attachment.display_name,
        "originalName": attachment.original_name,
        "externalUrl": attachment.external_url,
        "contentSha256": attachment.content_sha256,
        "sizeBytes": attachment.size_bytes,
        "mimeType": attachment.mime_type,
        "remotePath": attachment.remote_path,
        "encryptionKeyId": attachment.encryption_key_id,
        "sortOrder": attachment.sort_order,
        "createdAt": attachment.created_at,
        "updatedAt": attachment.updated_at,
        "deletedAt": attachment.deleted_at,
    })
}

pub(crate) fn select_attachments() -> &'static str {
    r#"
    SELECT a.id, a.task_id, a.kind, a.blob_id, a.display_name, a.original_name,
           a.external_url, b.content_sha256, b.size_bytes, b.mime_type,
           b.local_relative_path, b.remote_path, b.encryption_key_id,
           b.sync_state, b.last_error, r.local_path, a.sort_order,
           a.created_at, a.updated_at, a.deleted_at
    FROM task_attachments AS a
    LEFT JOIN attachment_blobs AS b ON b.id = a.blob_id
    LEFT JOIN local_attachment_references AS r ON r.attachment_id = a.id
    "#
}

pub(crate) fn map_attachment(row: &Row<'_>) -> rusqlite::Result<Attachment> {
    Ok(Attachment {
        id: row.get(0)?,
        task_id: row.get(1)?,
        kind: row.get(2)?,
        blob_id: row.get(3)?,
        display_name: row.get(4)?,
        original_name: row.get(5)?,
        external_url: row.get(6)?,
        content_sha256: row.get(7)?,
        size_bytes: row.get(8)?,
        mime_type: row.get(9)?,
        local_relative_path: row.get(10)?,
        remote_path: row.get(11)?,
        encryption_key_id: row.get(12)?,
        sync_state: row.get(13)?,
        last_error: row.get(14)?,
        local_path: row.get(15)?,
        sort_order: row.get(16)?,
        created_at: row.get(17)?,
        updated_at: row.get(18)?,
        deleted_at: row.get(19)?,
    })
}

fn query_attachment(
    transaction: &rusqlite::Transaction<'_>,
    id: &str,
) -> RepositoryResult<Attachment> {
    map_not_found(
        transaction.query_row(
            &format!("{} WHERE a.id = ?1", select_attachments()),
            params![id],
            map_attachment,
        ),
        "attachment",
    )
}

fn query_attachment_by_id(
    connection: &rusqlite::Connection,
    id: &str,
) -> RepositoryResult<Attachment> {
    map_not_found(
        connection.query_row(
            &format!("{} WHERE a.id = ?1", select_attachments()),
            params![id],
            map_attachment,
        ),
        "attachment",
    )
}

fn map_blob_transfer(row: &Row<'_>) -> rusqlite::Result<AttachmentBlobTransfer> {
    Ok(AttachmentBlobTransfer {
        id: row.get(0)?,
        content_sha256: row.get(1)?,
        size_bytes: row.get(2)?,
        local_relative_path: row.get(3)?,
        remote_path: row.get(4)?,
        encryption_key_id: row.get(5)?,
    })
}

fn ensure_task_exists(
    transaction: &rusqlite::Transaction<'_>,
    task_id: &str,
) -> RepositoryResult<()> {
    let exists: i64 = transaction.query_row(
        "SELECT COUNT(*) FROM tasks WHERE id = ?1 AND deleted_at IS NULL AND purged_at IS NULL",
        params![task_id],
        |row| row.get(0),
    )?;
    if exists == 0 {
        return Err(RepositoryError::NotFound("task"));
    }
    Ok(())
}

fn ensure_attachment_capacity(
    transaction: &rusqlite::Transaction<'_>,
    task_id: &str,
) -> RepositoryResult<()> {
    let count: i64 = transaction.query_row(
        "SELECT COUNT(*) FROM task_attachments WHERE task_id = ?1 AND deleted_at IS NULL",
        params![task_id],
        |row| row.get(0),
    )?;
    if count >= MAX_TASK_ATTACHMENTS {
        return Err(RepositoryError::Validation("too many task attachments"));
    }
    Ok(())
}

fn record_attachment_change(
    transaction: &rusqlite::Transaction<'_>,
    attachment: &Attachment,
    operation: &str,
) -> RepositoryResult<()> {
    sync_repository::record_change(
        transaction,
        "attachment",
        &attachment.id,
        operation,
        attachment_sync_payload(attachment),
    )
}

fn with_managed_local_path(data_dir: &Path, mut attachment: Attachment) -> Attachment {
    if attachment.kind == "managed" {
        if let Some(relative) = attachment.local_relative_path.as_deref() {
            if let Ok(path) = blob_absolute_path(data_dir, relative) {
                attachment.local_path = Some(path.display().to_string());
            }
        }
    }
    attachment
}

fn copy_file_with_hash(source: &Path, target: &Path) -> RepositoryResult<(String, i64)> {
    let mut reader = fs::File::open(source)?;
    let mut writer = fs::File::create(target)?;
    let mut hasher = Sha256::new();
    let mut size = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        size = size
            .checked_add(read as u64)
            .ok_or(RepositoryError::Validation("attachment file is too large"))?;
        if size > MAX_ATTACHMENT_FILE_BYTES {
            return Err(RepositoryError::Validation("attachment file is too large"));
        }
        hasher.update(&buffer[..read]);
        writer.write_all(&buffer[..read])?;
    }
    writer.sync_all()?;
    Ok((hex_lower(&hasher.finalize()), size as i64))
}

fn hex_lower(bytes: &[u8]) -> String {
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push_str(&format!("{byte:02x}"));
    }
    encoded
}

fn canonical_file(path: &str) -> RepositoryResult<PathBuf> {
    let path = fs::canonicalize(PathBuf::from(path))?;
    if !path.is_file() {
        return Err(RepositoryError::Validation(
            "attachment source must be a file",
        ));
    }
    Ok(strip_extended_length_prefix(&path))
}

// Windows 的 fs::canonicalize 返回 \\?\ 扩展长度前缀路径，
// Shell / opener 通常无法直接处理；入库前剥掉前缀
fn strip_extended_length_prefix(path: &Path) -> PathBuf {
    match path.to_str() {
        Some(value) if value.starts_with(r"\\?\") => PathBuf::from(&value[4..]),
        _ => path.to_path_buf(),
    }
}

fn validate_id(value: &str) -> RepositoryResult<String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 128 {
        return Err(RepositoryError::Validation("invalid attachment id"));
    }
    Ok(value.to_owned())
}

fn validate_display_name(value: Option<&str>, fallback: &str) -> RepositoryResult<String> {
    let value = value.unwrap_or(fallback).trim();
    if value.is_empty() || value.len() > 512 {
        return Err(RepositoryError::Validation("invalid attachment name"));
    }
    Ok(value.to_owned())
}

fn validate_url(value: &str) -> RepositoryResult<String> {
    let value = value.trim();
    if value.len() > 2048 || !(value.starts_with("https://") || value.starts_with("http://")) {
        return Err(RepositoryError::Validation("invalid attachment URL"));
    }
    Ok(value.to_owned())
}

fn guess_mime_type(file_name: &str) -> Option<String> {
    let extension = Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())?
        .to_ascii_lowercase();
    let mime = match extension.as_str() {
        "txt" | "md" | "log" => "text/plain",
        "json" => "application/json",
        "csv" => "text/csv",
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "zip" => "application/zip",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        _ => return None,
    };
    Some(mime.to_owned())
}

#[derive(Debug)]
struct OrphanBlob {
    id: String,
    local_relative_path: String,
    size_bytes: i64,
}

fn orphan_blob_rows(
    connection: &rusqlite::Connection,
    retention_days: i64,
) -> RepositoryResult<Vec<OrphanBlob>> {
    let retention_modifier = format!("-{} days", retention_days.max(0));
    let mut statement = connection.prepare(
        r#"
        SELECT b.id, b.local_relative_path, b.size_bytes
        FROM attachment_blobs AS b
        WHERE b.deleted_at IS NULL
          AND b.sync_state NOT IN ('pendingUpload', 'pendingDownload')
          AND NOT EXISTS (
              SELECT 1 FROM task_attachments AS live
              WHERE live.blob_id = b.id AND live.deleted_at IS NULL
          )
          AND NOT EXISTS (
              SELECT 1
              FROM sync_changes AS pending
              INNER JOIN task_attachments AS a ON a.id = pending.object_id
              WHERE pending.entity = 'attachment'
                AND pending.uploaded_at IS NULL
                AND a.blob_id = b.id
          )
          AND julianday(COALESCE(
              (SELECT MAX(deleted.deleted_at) FROM task_attachments AS deleted WHERE deleted.blob_id = b.id),
              b.updated_at
          )) < julianday('now', ?1)
        ORDER BY b.updated_at ASC
        "#,
    )?;
    let rows = statement
        .query_map(params![retention_modifier], |row| {
            Ok(OrphanBlob {
                id: row.get(0)?,
                local_relative_path: row.get(1)?,
                size_bytes: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn count_blobs_by_state(connection: &rusqlite::Connection, state: &str) -> RepositoryResult<i64> {
    Ok(connection.query_row(
        "SELECT COUNT(*) FROM attachment_blobs WHERE sync_state = ?1 AND deleted_at IS NULL",
        params![state],
        |row| row.get(0),
    )?)
}

fn map_not_found<T>(
    result: Result<T, rusqlite::Error>,
    entity: &'static str,
) -> RepositoryResult<T> {
    match result {
        Ok(value) => Ok(value),
        Err(rusqlite::Error::QueryReturnedNoRows) => Err(RepositoryError::NotFound(entity)),
        Err(error) => Err(error.into()),
    }
}
