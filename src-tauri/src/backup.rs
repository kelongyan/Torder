use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::db::attachment_repository::{
    attachment_blob_root, blob_absolute_path, sha256_file, AttachmentRepository,
};
use crate::db::list_repository::ListRepository;
use crate::db::migrations::CURRENT_SCHEMA_VERSION;
use crate::db::recurring_repository::RecurringRuleRepository;
use crate::db::settings_repository::SettingsRepository;
use crate::db::sync_repository;
use crate::db::task_link_repository::TaskLinkRepository;
use crate::db::task_repository::TaskRepository;
use crate::db::Database;
use crate::error::{RepositoryError, RepositoryResult};
use crate::models::{
    CreateAttachmentInput, CreateListInput, CreateRecurringRuleInput, CreateTaskInput,
    CreateTaskLinkInput, CreateWebLinkAttachmentInput, RecurringRule, Task, TaskList,
    UpdateTaskInput,
};

const BACKUP_DIR_NAME: &str = "backups";
const DB_FILE_NAME: &str = "torder.sqlite";
const BACKUP_MANIFEST_NAME: &str = "manifest.json";
const BACKUP_PACKAGE_FORMAT: &str = "torder-backup-package";
const BACKUP_PACKAGE_VERSION: i64 = 1;
const BACKUP_RETENTION_DEFAULT: i64 = 20;
const BACKUP_RETENTION_KEY: &str = "backupRetentionCount";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupImportPreview {
    pub path: String,
    pub name: String,
    pub list_count: usize,
    pub task_count: usize,
    pub recurring_rule_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupImportResult {
    pub imported_lists: usize,
    pub imported_tasks: usize,
    pub imported_recurring_rules: usize,
    pub skipped_lists: usize,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupPackageManifest {
    app: String,
    backup_format: String,
    backup_version: i64,
    schema_version: i64,
    created_at: String,
    database: BackupManifestFile,
    attachments: Vec<BackupManifestAttachment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupManifestFile {
    path: String,
    sha256: String,
    size_bytes: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupManifestAttachment {
    blob_id: String,
    path: String,
    sha256: String,
    size_bytes: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportAttachment {
    id: String,
    task_id: String,
    kind: String,
    display_name: String,
    original_name: Option<String>,
    external_url: Option<String>,
    content_sha256: Option<String>,
    size_bytes: Option<i64>,
    mime_type: Option<String>,
    sort_order: i64,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportTaskLink {
    id: String,
    source_task_id: String,
    target_task_id: String,
    relation_type: String,
    sort_order: i64,
    target_title: Option<String>,
    created_at: String,
    updated_at: String,
}
pub fn backup_database(app: &AppHandle, database: &Database) -> RepositoryResult<String> {
    let data_dir = app.path().app_data_dir()?;
    let db_path = data_dir.join(DB_FILE_NAME);
    let backup_dir = data_dir.join(BACKUP_DIR_NAME);
    fs::create_dir_all(&backup_dir)?;

    let connection = rusqlite::Connection::open(&db_path)?;
    connection.busy_timeout(std::time::Duration::from_secs(5))?;
    let stamp: String = connection.query_row(
        "SELECT strftime('%Y%m%d-%H%M%S', 'now', 'localtime')",
        [],
        |row| row.get(0),
    )?;
    drop(connection);

    let backup_path = backup_dir.join(format!("torder-backup-{stamp}.zip"));
    create_backup_package(&data_dir, &db_path, &backup_path)?;

    // 备份会越积越多，按保留策略清理最旧的几份，防止 AppData 无声膨胀。
    let retention = SettingsRepository::new(database)
        .get(BACKUP_RETENTION_KEY)?
        .map(|setting| setting.value);
    prune_backup_files(&backup_dir, parse_retention(retention))?;

    Ok(backup_path.display().to_string())
}

/// 解析保留份数：非法/缺失回退默认值，至少保留 1 份。
fn parse_retention(value: Option<String>) -> i64 {
    value
        .as_deref()
        .and_then(|value| value.trim().parse::<i64>().ok())
        .filter(|count| *count > 0)
        .unwrap_or(BACKUP_RETENTION_DEFAULT)
}

/// 只保留最新的 `retention` 份 `torder-backup-*`（`.zip` 新格式 + `.sqlite` 旧格式）；
/// 恢复前的安全快照（`torder-prerestore-*`）不参与清理。
/// 备份文件名是固定格式时间戳，字典序即时间序。
fn prune_backup_files(backup_dir: &Path, retention: i64) -> RepositoryResult<()> {
    if retention <= 0 {
        return Ok(());
    }
    let mut backups: Vec<PathBuf> = fs::read_dir(backup_dir)?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .map(|name| {
                    name.starts_with("torder-backup-")
                        && (name.ends_with(".zip") || name.ends_with(".sqlite"))
                })
                .unwrap_or(false)
        })
        .collect();
    backups.sort();

    let keep = retention as usize;
    if backups.len() > keep {
        for old in backups.iter().take(backups.len() - keep) {
            let _ = fs::remove_file(old);
        }
    }
    Ok(())
}

fn create_backup_package(
    data_dir: &Path,
    db_path: &Path,
    package_path: &Path,
) -> RepositoryResult<()> {
    let work_dir = data_dir
        .join(BACKUP_DIR_NAME)
        .join(format!("backup-work-{}", Uuid::new_v4()));
    fs::create_dir_all(&work_dir)?;
    let snapshot_path = work_dir.join(DB_FILE_NAME);

    let result = (|| {
        let connection = rusqlite::Connection::open(db_path)?;
    connection.busy_timeout(std::time::Duration::from_secs(5))?;
        vacuum_into(&connection, &snapshot_path)?;
        write_backup_package_from_snapshot(data_dir, &snapshot_path, package_path)
    })();

    let _ = fs::remove_dir_all(&work_dir);
    result
}

fn write_backup_package_from_snapshot(
    data_dir: &Path,
    snapshot_path: &Path,
    package_path: &Path,
) -> RepositoryResult<()> {
    let created_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let (database_hash, database_size) = sha256_file(snapshot_path)?;
    let attachments = collect_backup_attachments(data_dir, snapshot_path)?;
    let manifest = BackupPackageManifest {
        app: "Torder".to_owned(),
        backup_format: BACKUP_PACKAGE_FORMAT.to_owned(),
        backup_version: BACKUP_PACKAGE_VERSION,
        schema_version: CURRENT_SCHEMA_VERSION,
        created_at,
        database: BackupManifestFile {
            path: DB_FILE_NAME.to_owned(),
            sha256: database_hash,
            size_bytes: database_size,
        },
        attachments,
    };

    let file = fs::File::create(package_path)?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o600);

    zip.start_file(BACKUP_MANIFEST_NAME, options)?;
    zip.write_all(serde_json::to_string_pretty(&manifest)?.as_bytes())?;
    add_file_to_zip(&mut zip, DB_FILE_NAME, snapshot_path, options)?;
    for attachment in &manifest.attachments {
        let source = blob_absolute_path(data_dir, &attachment.path)?;
        add_file_to_zip(&mut zip, &attachment.path, &source, options)?;
    }
    zip.finish()?;
    Ok(())
}

fn collect_backup_attachments(
    data_dir: &Path,
    snapshot_path: &Path,
) -> RepositoryResult<Vec<BackupManifestAttachment>> {
    let connection = rusqlite::Connection::open(snapshot_path)?;
    let table_count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'attachment_blobs'",
        [],
        |row| row.get(0),
    )?;
    if table_count == 0 {
        return Ok(Vec::new());
    }

    let mut statement = connection.prepare(
        r#"
        SELECT DISTINCT b.id, b.local_relative_path, b.content_sha256, b.size_bytes
        FROM attachment_blobs AS b
        INNER JOIN task_attachments AS a ON a.blob_id = b.id
        WHERE b.deleted_at IS NULL
          AND a.deleted_at IS NULL
          AND a.kind = 'managed'
        ORDER BY b.id
        "#,
    )?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut attachments = Vec::with_capacity(rows.len());
    for (blob_id, relative_path, expected_hash, expected_size) in rows {
        validate_backup_relative_path(&relative_path)?;
        let path = blob_absolute_path(data_dir, &relative_path)?;
        if !path.is_file() {
            return Err(RepositoryError::Validation("attachment file is missing"));
        }
        let (actual_hash, actual_size) = sha256_file(&path)?;
        if actual_hash != expected_hash || actual_size != expected_size {
            return Err(RepositoryError::Validation(
                "attachment file integrity mismatch",
            ));
        }
        attachments.push(BackupManifestAttachment {
            blob_id,
            path: relative_path,
            sha256: actual_hash,
            size_bytes: actual_size,
        });
    }
    Ok(attachments)
}

fn collect_export_attachments(
    connection: &rusqlite::Connection,
) -> RepositoryResult<Vec<ExportAttachment>> {
    let table_count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'task_attachments'",
        [],
        |row| row.get(0),
    )?;
    if table_count == 0 {
        return Ok(Vec::new());
    }

    let mut statement = connection.prepare(
        r#"
        SELECT
            a.id,
            a.task_id,
            a.kind,
            a.display_name,
            a.original_name,
            a.external_url,
            b.content_sha256,
            b.size_bytes,
            b.mime_type,
            a.sort_order,
            a.created_at,
            a.updated_at
        FROM task_attachments AS a
        LEFT JOIN attachment_blobs AS b ON b.id = a.blob_id
        WHERE a.deleted_at IS NULL
        ORDER BY a.task_id, a.sort_order, a.created_at
        "#,
    )?;
    let attachments = statement
        .query_map([], |row| {
            Ok(ExportAttachment {
                id: row.get(0)?,
                task_id: row.get(1)?,
                kind: row.get(2)?,
                display_name: row.get(3)?,
                original_name: row.get(4)?,
                external_url: row.get(5)?,
                content_sha256: row.get(6)?,
                size_bytes: row.get(7)?,
                mime_type: row.get(8)?,
                sort_order: row.get(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(attachments)
}

fn collect_export_task_links(
    connection: &rusqlite::Connection,
) -> RepositoryResult<Vec<ExportTaskLink>> {
    let table_count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'task_links'",
        [],
        |row| row.get(0),
    )?;
    if table_count == 0 {
        return Ok(Vec::new());
    }

    let mut statement = connection.prepare(
        r#"
        SELECT
            l.id,
            l.source_task_id,
            l.target_task_id,
            l.relation_type,
            l.sort_order,
            target.title,
            l.created_at,
            l.updated_at
        FROM task_links AS l
        INNER JOIN tasks AS source ON source.id = l.source_task_id
        INNER JOIN tasks AS target ON target.id = l.target_task_id
        WHERE l.deleted_at IS NULL
          AND source.deleted_at IS NULL
          AND source.purged_at IS NULL
          AND target.deleted_at IS NULL
          AND target.purged_at IS NULL
        ORDER BY l.source_task_id, l.sort_order, l.created_at
        "#,
    )?;
    let task_links = statement
        .query_map([], |row| {
            Ok(ExportTaskLink {
                id: row.get(0)?,
                source_task_id: row.get(1)?,
                target_task_id: row.get(2)?,
                relation_type: row.get(3)?,
                sort_order: row.get(4)?,
                target_title: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(task_links)
}

fn add_file_to_zip(
    zip: &mut zip::ZipWriter<fs::File>,
    entry_name: &str,
    source: &Path,
    options: zip::write::SimpleFileOptions,
) -> RepositoryResult<()> {
    validate_zip_entry_name(entry_name)?;
    zip.start_file(entry_name, options)?;
    let mut file = fs::File::open(source)?;
    std::io::copy(&mut file, zip)?;
    Ok(())
}
pub fn export_tasks(
    app: &AppHandle,
    database: &Database,
    format: &str,
) -> RepositoryResult<String> {
    let data_dir = app.path().app_data_dir()?;
    let export_dir = data_dir.join("exports");
    fs::create_dir_all(&export_dir)?;

    let connection = database.connect()?;
    let stamp: String = connection.query_row(
        "SELECT strftime('%Y%m%d-%H%M%S', 'now', 'localtime')",
        [],
        |row| row.get(0),
    )?;
    let lists = ListRepository::new(database).list()?;
    let tasks = TaskRepository::new(database).export_all()?;
    let recurring_rules = RecurringRuleRepository::new(database).export_all()?;
    let attachments = collect_export_attachments(&connection)?;
    let task_links = collect_export_task_links(&connection)?;

    let file_name = match format {
        "json" => format!("torder-export-{stamp}.json"),
        "markdown" => format!("torder-export-{stamp}.md"),
        "csv" => format!("torder-export-{stamp}.csv"),
        _ => return Err(RepositoryError::Validation("unsupported export format")),
    };
    let export_path = export_dir.join(&file_name);
    let content = match format {
        "json" => build_json_export(
            &lists,
            &tasks,
            &recurring_rules,
            &attachments,
            &task_links,
            &stamp,
        )?,
        "markdown" => build_markdown_export(
            &lists,
            &tasks,
            &recurring_rules,
            &attachments,
            &task_links,
            &stamp,
        )?,
        _ => build_csv_export(&tasks, &attachments, &task_links)?,
    };
    fs::write(&export_path, content)?;

    Ok(export_path.display().to_string())
}

pub fn list_backups(app: &AppHandle) -> RepositoryResult<Vec<String>> {
    let backup_dir = app.path().app_data_dir()?.join(BACKUP_DIR_NAME);
    if !backup_dir.exists() {
        return Ok(Vec::new());
    }
    let mut files: Vec<String> = fs::read_dir(&backup_dir)?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| backup_extension(path).is_some())
        .map(|path| path.display().to_string())
        .collect();
    files.sort_by_key(|path| std::cmp::Reverse(path.clone()));
    Ok(files)
}

pub fn restore_backup(app: &AppHandle, path: &str) -> RepositoryResult<()> {
    let data_dir = app.path().app_data_dir()?;
    let backup_dir = data_dir.join(BACKUP_DIR_NAME);
    fs::create_dir_all(&backup_dir)?;
    // 这个入口来自 webview，且 tauri.conf.json 的 csp 为 null。
    // 不做校验的话它就是"用磁盘上任意文件覆盖用户数据库"的原语。
    let source = resolve_backup_path(&backup_dir, path)?;
    match backup_extension(&source) {
        Some("sqlite") => restore_sqlite_backup(&data_dir, &backup_dir, &source),
        Some("zip") => restore_package_backup(&data_dir, &backup_dir, &source),
        _ => Err(RepositoryError::Validation("unsupported backup format")),
    }
}

pub fn preview_backup_import(app: &AppHandle, path: &str) -> RepositoryResult<BackupImportPreview> {
    let data_dir = app.path().app_data_dir()?;
    let backup_dir = data_dir.join(BACKUP_DIR_NAME);
    fs::create_dir_all(&backup_dir)?;
    let source = resolve_backup_path(&backup_dir, path)?;
    let name = source
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("backup.sqlite")
        .to_owned();

    with_prepared_backup_database(app, &source, |backup_database, _backup_data_dir| {
        let lists = ListRepository::new(backup_database).list()?;
        let tasks = TaskRepository::new(backup_database)
            .export_all()?
            .into_iter()
            .filter(|task| task.deleted_at.is_none())
            .count();
        let recurring_rules = RecurringRuleRepository::new(backup_database)
            .export_all()?
            .into_iter()
            .filter(|rule| rule.deleted_at.is_none())
            .count();
        Ok(BackupImportPreview {
            path: source.display().to_string(),
            name,
            list_count: lists.len(),
            task_count: tasks,
            recurring_rule_count: recurring_rules,
        })
    })
}

pub fn import_backup_selection(
    app: &AppHandle,
    database: &Database,
    path: &str,
    include_lists: bool,
    include_tasks: bool,
    include_recurring_rules: bool,
) -> RepositoryResult<BackupImportResult> {
    if !include_lists && !include_tasks && !include_recurring_rules {
        return Err(RepositoryError::Validation("nothing selected to import"));
    }

    let data_dir = app.path().app_data_dir()?;
    let backup_dir = data_dir.join(BACKUP_DIR_NAME);
    fs::create_dir_all(&backup_dir)?;
    let source = resolve_backup_path(&backup_dir, path)?;

    with_prepared_backup_database(app, &source, |backup_database, backup_data_dir| {
        import_from_prepared_backup(
            database,
            Some(&data_dir),
            backup_database,
            Some(backup_data_dir),
            include_lists,
            include_tasks,
            include_recurring_rules,
        )
    })
}

fn snapshot_current_database(db_path: &Path, snapshot_path: &Path) -> RepositoryResult<()> {
    let connection = rusqlite::Connection::open(db_path)?;
    connection.busy_timeout(std::time::Duration::from_secs(5))?;
    vacuum_into(&connection, snapshot_path)
}

fn restore_sqlite_backup(
    data_dir: &Path,
    backup_dir: &Path,
    source: &Path,
) -> RepositoryResult<()> {
    verify_restorable_database(source)?;
    let db_path = data_dir.join(DB_FILE_NAME);
    if db_path.exists() {
        let safety_copy = backup_dir.join(format!(
            "torder-prerestore-{}-{}.sqlite",
            chrono::Local::now().format("%Y%m%d-%H%M%S"),
            Uuid::new_v4()
        ));
        snapshot_current_database(&db_path, &safety_copy)?;
    }
    replace_database_file(source, &db_path)?;
    finalize_restored_database(&db_path)?;
    Ok(())
}

fn restore_package_backup(
    data_dir: &Path,
    backup_dir: &Path,
    source: &Path,
) -> RepositoryResult<()> {
    let restore_dir = data_dir
        .join("restore-work")
        .join(format!("restore-{}", Uuid::new_v4()));
    fs::create_dir_all(&restore_dir)?;

    let result = (|| {
        extract_backup_package(source, &restore_dir)?;
        validate_backup_package(&restore_dir)?;
        let db_path = data_dir.join(DB_FILE_NAME);
        if db_path.exists() {
            create_prerestore_package(data_dir, backup_dir)?;
        }
        replace_database_file(&restore_dir.join(DB_FILE_NAME), &db_path)?;
        replace_attachment_blobs(&restore_dir, data_dir)?;
        finalize_restored_database(&db_path)?;
        Ok(())
    })();

    let _ = fs::remove_dir_all(&restore_dir);
    result
}

fn create_prerestore_package(data_dir: &Path, backup_dir: &Path) -> RepositoryResult<()> {
    let db_path = data_dir.join(DB_FILE_NAME);
    let work_dir = backup_dir.join(format!("prerestore-work-{}", Uuid::new_v4()));
    fs::create_dir_all(&work_dir)?;
    let snapshot_path = work_dir.join(DB_FILE_NAME);
    let package_path = backup_dir.join(format!(
        "torder-prerestore-{}-{}.zip",
        chrono::Local::now().format("%Y%m%d-%H%M%S"),
        Uuid::new_v4()
    ));
    let result = (|| {
        snapshot_current_database(&db_path, &snapshot_path)?;
        write_backup_package_from_snapshot(data_dir, &snapshot_path, &package_path)
    })();
    let _ = fs::remove_dir_all(&work_dir);
    result
}

fn replace_database_file(source: &Path, db_path: &Path) -> RepositoryResult<()> {
    remove_database_sidecars(db_path);
    fs::copy(source, db_path)?;
    remove_database_sidecars(db_path);
    Ok(())
}

fn replace_attachment_blobs(
    source_data_dir: &Path,
    target_data_dir: &Path,
) -> RepositoryResult<()> {
    let source = source_data_dir.join("attachments").join("blobs");
    let target = attachment_blob_root(target_data_dir);
    if target.exists() {
        fs::remove_dir_all(&target)?;
    }
    if source.exists() {
        copy_dir_recursive(&source, &target)?;
    } else if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    Ok(())
}

fn copy_dir_recursive(source: &Path, target: &Path) -> RepositoryResult<()> {
    fs::create_dir_all(target)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            copy_dir_recursive(&source_path, &target_path)?;
        } else if file_type.is_file() {
            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(&source_path, &target_path)?;
        }
    }
    Ok(())
}

fn remove_database_sidecars(db_path: &Path) {
    let _ = fs::remove_file(PathBuf::from(format!("{}-wal", db_path.display())));
    let _ = fs::remove_file(PathBuf::from(format!("{}-shm", db_path.display())));
}

fn finalize_restored_database(db_path: &Path) -> RepositoryResult<()> {
    let restored = Database::initialize(db_path.to_path_buf())?;
    let status = restored.status()?;
    if status.schema_version != CURRENT_SCHEMA_VERSION {
        return Err(RepositoryError::Validation(
            "restored backup could not be migrated",
        ));
    }
    Ok(())
}

fn extract_backup_package(source: &Path, work_dir: &Path) -> RepositoryResult<()> {
    let file = fs::File::open(source)?;
    let mut archive = zip::ZipArchive::new(file)?;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)?;
        let enclosed = entry.enclosed_name().ok_or(RepositoryError::Validation(
            "backup package contains unsafe path",
        ))?;
        let entry_name = entry.name().replace('\\', "/");
        validate_zip_entry_name(entry_name.trim_end_matches('/'))?;
        let target = work_dir.join(&enclosed);
        if !target.starts_with(work_dir) {
            return Err(RepositoryError::Validation(
                "backup package contains unsafe path",
            ));
        }
        if entry.is_dir() {
            fs::create_dir_all(&target)?;
        } else {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)?;
            }
            let mut output = fs::File::create(&target)?;
            std::io::copy(&mut entry, &mut output)?;
        }
    }
    Ok(())
}

fn validate_backup_package(work_dir: &Path) -> RepositoryResult<BackupPackageManifest> {
    let manifest_path = work_dir.join(BACKUP_MANIFEST_NAME);
    let manifest: BackupPackageManifest = serde_json::from_slice(&fs::read(&manifest_path)?)?;
    if manifest.app != "Torder"
        || manifest.backup_format != BACKUP_PACKAGE_FORMAT
        || manifest.backup_version != BACKUP_PACKAGE_VERSION
        || manifest.schema_version > CURRENT_SCHEMA_VERSION
        || manifest.database.path != DB_FILE_NAME
    {
        return Err(RepositoryError::Validation("invalid backup manifest"));
    }

    verify_manifest_file(work_dir, &manifest.database)?;
    verify_restorable_database(&work_dir.join(DB_FILE_NAME))?;

    let mut seen = HashSet::<String>::new();
    for attachment in &manifest.attachments {
        validate_backup_relative_path(&attachment.path)?;
        if !seen.insert(attachment.path.clone()) {
            return Err(RepositoryError::Validation(
                "duplicate attachment in backup",
            ));
        }
        verify_manifest_file(
            work_dir,
            &BackupManifestFile {
                path: attachment.path.clone(),
                sha256: attachment.sha256.clone(),
                size_bytes: attachment.size_bytes,
            },
        )?;
    }
    Ok(manifest)
}

fn verify_manifest_file(work_dir: &Path, file: &BackupManifestFile) -> RepositoryResult<()> {
    validate_zip_entry_name(&file.path)?;
    let path = work_dir.join(&file.path);
    if !path.is_file() {
        return Err(RepositoryError::Validation("backup package is incomplete"));
    }
    let (actual_hash, actual_size) = sha256_file(&path)?;
    if actual_hash != file.sha256 || actual_size != file.size_bytes {
        return Err(RepositoryError::Validation(
            "backup package integrity mismatch",
        ));
    }
    Ok(())
}

fn with_prepared_backup_database<T>(
    app: &AppHandle,
    source: &Path,
    reader: impl FnOnce(&Database, &Path) -> RepositoryResult<T>,
) -> RepositoryResult<T> {
    let import_dir = app.path().app_data_dir()?.join("import-work");
    fs::create_dir_all(&import_dir)?;

    match backup_extension(source) {
        Some("sqlite") => {
            verify_restorable_database(source)?;
            let temp_path = import_dir.join(format!("backup-import-{}.sqlite", Uuid::new_v4()));
            fs::copy(source, &temp_path)?;
            let result = (|| {
                let backup_database = Database::initialize(temp_path.clone())?;
                reader(&backup_database, &import_dir)
            })();
            remove_database_sidecars(&temp_path);
            let _ = fs::remove_file(&temp_path);
            result
        }
        Some("zip") => {
            let work_dir = import_dir.join(format!("backup-import-{}", Uuid::new_v4()));
            fs::create_dir_all(&work_dir)?;
            let result = (|| {
                extract_backup_package(source, &work_dir)?;
                validate_backup_package(&work_dir)?;
                let temp_path = work_dir.join(DB_FILE_NAME);
                let backup_database = Database::initialize(temp_path.clone())?;
                reader(&backup_database, &work_dir)
            })();
            let _ = fs::remove_dir_all(&work_dir);
            result
        }
        _ => Err(RepositoryError::Validation("unsupported backup format")),
    }
}

fn import_from_prepared_backup(
    database: &Database,
    current_data_dir: Option<&Path>,
    backup_database: &Database,
    backup_data_dir: Option<&Path>,
    include_lists: bool,
    include_tasks: bool,
    include_recurring_rules: bool,
) -> RepositoryResult<BackupImportResult> {
    let backup_lists = ListRepository::new(backup_database).list()?;
    let current_lists = ListRepository::new(database).list()?;
    let mut list_id_map = HashMap::<String, String>::new();
    let mut imported_lists = 0_usize;
    let mut skipped_lists = 0_usize;

    for current in &current_lists {
        list_id_map.insert(current.id.clone(), current.id.clone());
    }

    for backup_list in &backup_lists {
        if let Some(current) = current_lists
            .iter()
            .find(|list| same_name(&list.name, &backup_list.name))
        {
            list_id_map.insert(backup_list.id.clone(), current.id.clone());
            if backup_list.id != current.id {
                skipped_lists += 1;
            }
            continue;
        }

        if include_lists && !backup_list.is_default {
            let created = ListRepository::new(database).create(CreateListInput {
                name: backup_list.name.clone(),
                color: backup_list.color.clone(),
                sort_order: Some(backup_list.sort_order),
            })?;
            list_id_map.insert(backup_list.id.clone(), created.id);
            imported_lists += 1;
        }
    }

    let mut imported_tasks = 0_usize;
    let mut imported_task_id_map = HashMap::<String, String>::new();
    if include_tasks {
        for task in TaskRepository::new(backup_database)
            .export_all()?
            .into_iter()
            .filter(|task| task.deleted_at.is_none())
        {
            let list_id = mapped_list_id(&task.list_id, &list_id_map);
            let created = TaskRepository::new(database).create(CreateTaskInput {
                title: task.title.clone(),
                note: task.note.clone(),
                priority: Some(task.priority),
                list_id: Some(list_id),
                scheduled_date: task.scheduled_date.clone(),
                due_at: task.due_at.clone(),
                sort_order: Some(task.sort_order),
                remind_before: task.remind_before,
                repeat_rule: task.repeat_rule.clone(),
                subtasks: Some(task.subtasks.clone()),
                tags: Some(task.tags.clone()),
            })?;
            let created_id = created.id.clone();
            if task.status != "todo" {
                let _ = TaskRepository::new(database).update(UpdateTaskInput {
                    id: created.id,
                    title: created.title,
                    note: created.note,
                    status: task.status.clone(),
                    priority: created.priority,
                    list_id: created.list_id,
                    scheduled_date: created.scheduled_date,
                    due_at: created.due_at,
                    sort_order: created.sort_order,
                    remind_before: created.remind_before,
                    repeat_rule: created.repeat_rule,
                    subtasks: created.subtasks,
                    tags: created.tags,
                })?;
            }
            import_task_attachments(
                database,
                current_data_dir,
                backup_database,
                backup_data_dir,
                &task.id,
                &created_id,
            )?;
            imported_task_id_map.insert(task.id, created_id);
            imported_tasks += 1;
        }
        import_task_links(database, backup_database, &imported_task_id_map)?;
    }

    let mut imported_recurring_rules = 0_usize;
    if include_recurring_rules {
        for rule in RecurringRuleRepository::new(backup_database)
            .export_all()?
            .into_iter()
            .filter(|rule| rule.deleted_at.is_none())
        {
            let created =
                RecurringRuleRepository::new(database).create(CreateRecurringRuleInput {
                    source_task_id: None,
                    title: rule.title.clone(),
                    note: rule.note.clone(),
                    priority: rule.priority,
                    list_id: mapped_list_id(&rule.list_id, &list_id_map),
                    frequency: rule.frequency.clone(),
                    interval_count: rule.interval_count,
                    weekdays: rule.weekdays.clone(),
                    month_day: rule.month_day,
                    first_due_at: rule.first_due_at.clone(),
                    timezone: rule.timezone.clone(),
                    generate_ahead_minutes: rule.generate_ahead_minutes,
                    remind_before: rule.remind_before,
                    end_at: rule.end_at.clone(),
                })?;
            set_imported_recurring_state(
                database,
                &created.id,
                rule.next_due_at.as_deref(),
                rule.enabled,
            )?;
            imported_recurring_rules += 1;
        }
    }

    Ok(BackupImportResult {
        imported_lists,
        imported_tasks,
        imported_recurring_rules,
        skipped_lists,
    })
}

fn backup_has_table(database: &Database, table: &str) -> RepositoryResult<bool> {
    let connection = database.connect()?;
    let exists: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
        [table],
        |row| row.get(0),
    )?;
    Ok(exists)
}

fn import_task_attachments(
    database: &Database,
    current_data_dir: Option<&Path>,
    backup_database: &Database,
    backup_data_dir: Option<&Path>,
    source_task_id: &str,
    target_task_id: &str,
) -> RepositoryResult<()> {
    let Some(backup_data_dir) = backup_data_dir else {
        return Ok(());
    };
    let backup_repository = AttachmentRepository::new(backup_database);
    if !backup_has_table(backup_database, "task_attachments")? {
        return Ok(());
    }
    let attachments = backup_repository.list_by_task(backup_data_dir, source_task_id)?;
    let repository = AttachmentRepository::new(database);
    for attachment in attachments {
        match attachment.kind.as_str() {
            "managed" => {
                let Some(current_data_dir) = current_data_dir else {
                    continue;
                };
                let Some(source_path) = attachment.local_path.as_deref() else {
                    continue;
                };
                if !Path::new(source_path).is_file() {
                    continue;
                }
                let _ = repository.create_managed(
                    current_data_dir,
                    CreateAttachmentInput {
                        task_id: target_task_id.to_owned(),
                        source_path: source_path.to_owned(),
                        display_name: Some(attachment.display_name),
                    },
                )?;
            }
            "webLink" => {
                if let Some(url) = attachment.external_url {
                    let _ = repository.create_web_link(CreateWebLinkAttachmentInput {
                        task_id: target_task_id.to_owned(),
                        url,
                        display_name: attachment.display_name,
                    })?;
                }
            }
            "localReference" => {}
            _ => {}
        }
    }
    Ok(())
}

fn import_task_links(
    database: &Database,
    backup_database: &Database,
    imported_task_id_map: &HashMap<String, String>,
) -> RepositoryResult<()> {
    if imported_task_id_map.is_empty() {
        return Ok(());
    }

    let backup_repository = TaskLinkRepository::new(backup_database);
    let repository = TaskLinkRepository::new(database);
    if !backup_has_table(backup_database, "task_links")? {
        return Ok(());
    }
    for (source_task_id, target_source_task_id) in imported_task_id_map {
        let links = backup_repository.list_by_task(source_task_id)?;
        for link in links {
            let Some(target_task_id) = imported_task_id_map.get(&link.target_task_id) else {
                continue;
            };
            let _ = repository.create(CreateTaskLinkInput {
                source_task_id: target_source_task_id.clone(),
                target_task_id: target_task_id.clone(),
            })?;
        }
    }
    Ok(())
}
fn same_name(left: &str, right: &str) -> bool {
    left.trim().to_lowercase() == right.trim().to_lowercase()
}

fn mapped_list_id(
    original_id: &str,
    list_id_map: &std::collections::HashMap<String, String>,
) -> String {
    list_id_map
        .get(original_id)
        .cloned()
        .unwrap_or_else(|| "work".to_owned())
}

fn set_imported_recurring_state(
    database: &Database,
    id: &str,
    next_due_at: Option<&str>,
    enabled: bool,
) -> RepositoryResult<()> {
    let mut connection = database.connect()?;
    let transaction = connection.transaction()?;
    transaction.execute(
        r#"
        UPDATE recurring_rules
        SET next_due_at = ?2,
            enabled = ?3,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ?1 AND deleted_at IS NULL
        "#,
        rusqlite::params![id, next_due_at, if enabled { 1 } else { 0 }],
    )?;
    sync_repository::record_change(
        &transaction,
        "recurringRule",
        id,
        "upsert",
        json!({
            "id": id,
            "nextDueAt": next_due_at,
            "enabled": enabled,
        }),
    )?;
    transaction.commit()?;
    Ok(())
}

fn vacuum_into(connection: &rusqlite::Connection, target_path: &Path) -> RepositoryResult<()> {
    let quoted = target_path.to_string_lossy().replace('\'', "''");
    connection.execute_batch(&format!("VACUUM INTO '{quoted}'"))?;
    Ok(())
}

fn backup_extension(path: &Path) -> Option<&'static str> {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .as_deref()
    {
        Some("sqlite") => Some("sqlite"),
        Some("zip") => Some("zip"),
        _ => None,
    }
}

fn validate_zip_entry_name(path: &str) -> RepositoryResult<()> {
    if path.is_empty()
        || path.contains('\\')
        || path.starts_with('/')
        || path.contains(':')
        || path
            .split('/')
            .any(|segment| segment.is_empty() || segment == "." || segment == "..")
    {
        return Err(RepositoryError::Validation(
            "backup package contains unsafe path",
        ));
    }
    if path == BACKUP_MANIFEST_NAME
        || path == DB_FILE_NAME
        || path.starts_with("attachments/blobs/")
    {
        return Ok(());
    }
    Err(RepositoryError::Validation(
        "backup package contains unexpected file",
    ))
}

fn validate_backup_relative_path(path: &str) -> RepositoryResult<()> {
    validate_zip_entry_name(path)?;
    if !path.starts_with("attachments/blobs/") {
        return Err(RepositoryError::Validation("invalid attachment path"));
    }
    Ok(())
}

/// 把传入路径限制在备份目录内，抵御 `..` 穿越与符号链接绕过。
fn resolve_backup_path(backup_dir: &Path, path: &str) -> RepositoryResult<PathBuf> {
    let source = PathBuf::from(path);
    if !source.is_file() {
        return Err(RepositoryError::Validation("backup file does not exist"));
    }
    if backup_extension(&source).is_none() {
        return Err(RepositoryError::Validation(
            "backup must be a .zip or .sqlite file",
        ));
    }

    // canonicalize 会解析符号链接，因此必须两边都规范化后再比较前缀。
    let source = fs::canonicalize(&source)?;
    let backup_dir = fs::canonicalize(backup_dir)
        .map_err(|_| RepositoryError::Validation("backup directory is unavailable"))?;
    if !source.starts_with(&backup_dir) {
        return Err(RepositoryError::Validation(
            "backup file must live in the backups directory",
        ));
    }
    Ok(source)
}

/// 确认候选文件确实是本应用能读的 SQLite 库，且 schema 不比当前代码更新。
fn verify_restorable_database(source: &Path) -> RepositoryResult<()> {
    let connection =
        rusqlite::Connection::open_with_flags(source, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|_| RepositoryError::Validation("backup file is not a readable database"))?;

    let integrity: String = connection
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(|_| RepositoryError::Validation("backup file is not a valid database"))?;
    if integrity != "ok" {
        return Err(RepositoryError::Validation("backup file is corrupted"));
    }

    let schema_version: i64 = connection
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )
        .map_err(|_| RepositoryError::Validation("backup file is not a Torder database"))?;
    if schema_version == 0 {
        return Err(RepositoryError::Validation(
            "backup file is not a Torder database",
        ));
    }
    // 迁移只能向前，恢复一个更新的库会让旧版本读到不认识的 schema。
    if schema_version > CURRENT_SCHEMA_VERSION {
        return Err(RepositoryError::Validation(
            "backup was created by a newer version of Torder",
        ));
    }

    // tasks / lists 缺失说明这不是 Torder 的库，哪怕它是合法 SQLite。
    let table_count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('tasks', 'lists')",
            [],
            |row| row.get(0),
        )
        .map_err(|_| RepositoryError::Validation("backup file is not a Torder database"))?;
    if table_count < 2 {
        return Err(RepositoryError::Validation(
            "backup file is not a Torder database",
        ));
    }
    Ok(())
}

fn build_json_export(
    lists: &[TaskList],
    tasks: &[Task],
    recurring_rules: &[RecurringRule],
    attachments: &[ExportAttachment],
    task_links: &[ExportTaskLink],
    stamp: &str,
) -> RepositoryResult<String> {
    let payload = json!({
        "app": "Torder",
        "schemaVersion": CURRENT_SCHEMA_VERSION,
        "exportedAt": stamp,
        "lists": lists,
        "tasks": tasks,
        "recurringRules": recurring_rules,
        "attachments": attachments,
        "taskLinks": task_links,
    });
    Ok(serde_json::to_string_pretty(&payload)?)
}

fn attachment_names_for_task<'a>(
    attachments: &'a [ExportAttachment],
    task_id: &str,
) -> Vec<&'a str> {
    attachments
        .iter()
        .filter(|attachment| attachment.task_id == task_id)
        .map(|attachment| attachment.display_name.as_str())
        .collect()
}

fn task_link_names_for_task<'a>(task_links: &'a [ExportTaskLink], task_id: &str) -> Vec<&'a str> {
    task_links
        .iter()
        .filter(|link| link.source_task_id == task_id)
        .map(|link| {
            link.target_title
                .as_deref()
                .unwrap_or(link.target_task_id.as_str())
        })
        .collect()
}

fn build_markdown_export(
    lists: &[TaskList],
    tasks: &[Task],
    recurring_rules: &[RecurringRule],
    attachments: &[ExportAttachment],
    task_links: &[ExportTaskLink],
    stamp: &str,
) -> RepositoryResult<String> {
    let mut buffer = String::new();
    buffer.push_str(&format!("# Torder 任务导出\n\n> 导出时间:{stamp}\n\n"));
    for list in lists {
        buffer.push_str(&format!("\n## {}\n\n", list.name));
        let list_tasks: Vec<&Task> = tasks
            .iter()
            .filter(|task| task.list_id == list.id && task.deleted_at.is_none())
            .collect();
        if list_tasks.is_empty() {
            buffer.push_str("_暂无任务_\n");
            continue;
        }
        for task in list_tasks {
            let done = if task.status == "done" { "x" } else { " " };
            let priority = match task.priority {
                2 => "高",
                1 => "中",
                _ => "低",
            };
            let due = task
                .due_at
                .as_deref()
                .map(|value| format!(" · 截止 {value}"))
                .unwrap_or_default();
            let scheduled = task
                .scheduled_date
                .as_deref()
                .map(|value| format!(" · 计划 {value}"))
                .unwrap_or_default();
            let attachment_names = attachment_names_for_task(attachments, &task.id);
            let attachment_suffix = if attachment_names.is_empty() {
                String::new()
            } else {
                format!(" · 附件 {}", attachment_names.join("；"))
            };
            let task_link_names = task_link_names_for_task(task_links, &task.id);
            let task_link_suffix = if task_link_names.is_empty() {
                String::new()
            } else {
                format!(" · 引用 {}", task_link_names.join("；"))
            };
            buffer.push_str(&format!(
                "- [{done}] {}{}{} · 优先级 {priority}{attachment_suffix}{task_link_suffix}\n",
                task.title, scheduled, due
            ));
        }
    }
    if !recurring_rules.is_empty() {
        buffer.push_str("\n## 循环任务\n\n");
        for rule in recurring_rules {
            let status = if rule.enabled { "启用" } else { "暂停" };
            let next_due = rule.next_due_at.as_deref().unwrap_or("已结束");
            buffer.push_str(&format!(
                "- {} · {} · 下次 {next_due} · {status}\n",
                rule.title, rule.frequency
            ));
        }
    }
    Ok(buffer)
}

fn build_csv_export(
    tasks: &[Task],
    attachments: &[ExportAttachment],
    task_links: &[ExportTaskLink],
) -> RepositoryResult<String> {
    let mut buffer = String::from(
        "id,title,note,status,priority,listId,scheduledDate,dueAt,completedAt,createdAt,updatedAt,remindBefore,recurringRuleId,occurrenceAt,attachments,taskLinks\n",
    );
    for task in tasks.iter().filter(|task| task.deleted_at.is_none()) {
        let attachment_names = attachment_names_for_task(attachments, &task.id).join("；");
        let task_link_names = task_link_names_for_task(task_links, &task.id).join("；");
        let fields = [
            &task.id,
            &task.title,
            &task.note.clone().unwrap_or_default(),
            &task.status,
            &task.priority.to_string(),
            &task.list_id,
            &task.scheduled_date.clone().unwrap_or_default(),
            &task.due_at.clone().unwrap_or_default(),
            &task.completed_at.clone().unwrap_or_default(),
            &task.created_at,
            &task.updated_at,
            &task
                .remind_before
                .map(|value| value.to_string())
                .unwrap_or_default(),
            &task.recurring_rule_id.clone().unwrap_or_default(),
            &task.occurrence_at.clone().unwrap_or_default(),
            &attachment_names,
            &task_link_names,
        ];
        let line: Vec<String> = fields.iter().map(|field| escape_csv(field)).collect();
        buffer.push_str(&line.join(","));
        buffer.push('\n');
    }
    Ok(buffer)
}

fn escape_csv(field: &str) -> String {
    if field.contains(',') || field.contains('"') || field.contains('\n') {
        format!("\"{}\"", field.replace('"', "\"\""))
    } else {
        field.to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn touch(path: &Path) {
        fs::write(path, b"snapshot").unwrap();
    }

    #[test]
    fn prune_keeps_latest_backups_and_skips_safety_snapshots() {
        let dir = std::env::temp_dir().join(format!("torder-prune-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        for index in 0..25 {
            touch(&dir.join(format!("torder-backup-2026081{index:02}-000000.sqlite")));
        }
        touch(&dir.join("torder-prerestore-20260816-000000.sqlite"));
        touch(&dir.join("unrelated.txt"));

        prune_backup_files(&dir, 20).unwrap();

        let remaining: Vec<String> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.starts_with("torder-backup-"))
            .collect();
        assert_eq!(remaining.len(), 20);
        // 最早的 5 份（index 0..5）被清理，最新的 20 份（index 5..25）保留
        assert!(!remaining.contains(&"torder-backup-202608100-000000.sqlite".to_owned()));
        assert!(!remaining.contains(&"torder-backup-202608104-000000.sqlite".to_owned()));
        assert!(remaining.contains(&"torder-backup-202608105-000000.sqlite".to_owned()));
        assert!(remaining.contains(&"torder-backup-202608124-000000.sqlite".to_owned()));

        // 安全快照与无关文件不受影响
        assert!(dir
            .join("torder-prerestore-20260816-000000.sqlite")
            .exists());
        assert!(dir.join("unrelated.txt").exists());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn prune_keeps_everything_below_retention() {
        let dir = std::env::temp_dir().join(format!("torder-prune-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        for index in 0..3 {
            touch(&dir.join(format!("torder-backup-2026081{index}-000000.sqlite")));
        }

        prune_backup_files(&dir, 20).unwrap();

        let remaining = fs::read_dir(&dir).unwrap().count();
        assert_eq!(remaining, 3);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn retention_parsing_falls_back_to_default() {
        assert_eq!(parse_retention(None), 20);
        assert_eq!(parse_retention(Some("not-a-number".to_owned())), 20);
        assert_eq!(parse_retention(Some("0".to_owned())), 20);
        assert_eq!(parse_retention(Some("5".to_owned())), 5);
        assert_eq!(parse_retention(Some(" 12 ".to_owned())), 12);
    }

    #[test]
    fn plain_exports_include_attachment_and_task_link_names_without_paths() {
        let timestamp = "2026-08-25T00:00:00.000Z".to_owned();
        let lists = vec![TaskList {
            id: "work".to_owned(),
            name: "工作".to_owned(),
            color: None,
            sort_order: 0,
            is_default: true,
            created_at: timestamp.clone(),
            updated_at: timestamp.clone(),
            deleted_at: None,
        }];
        let tasks = vec![Task {
            id: "task-1".to_owned(),
            title: "带附件任务".to_owned(),
            note: None,
            status: "todo".to_owned(),
            priority: 1,
            list_id: "work".to_owned(),
            scheduled_date: None,
            due_at: None,
            completed_at: None,
            sort_order: 0,
            remind_before: None,
            remind_at: None,
            reminded_at: None,
            repeat_rule: None,
            subtasks: Vec::new(),
            tags: Vec::new(),
            recurring_rule_id: None,
            occurrence_at: None,
            created_at: timestamp.clone(),
            updated_at: timestamp.clone(),
            deleted_at: None,
        }];
        let attachments = vec![
            ExportAttachment {
                id: "attachment-1".to_owned(),
                task_id: "task-1".to_owned(),
                kind: "managed".to_owned(),
                display_name: "合同.pdf".to_owned(),
                original_name: Some("合同原件.pdf".to_owned()),
                external_url: None,
                content_sha256: Some(
                    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_owned(),
                ),
                size_bytes: Some(128),
                mime_type: Some("application/pdf".to_owned()),
                sort_order: 0,
                created_at: timestamp.clone(),
                updated_at: timestamp.clone(),
            },
            ExportAttachment {
                id: "attachment-2".to_owned(),
                task_id: "task-1".to_owned(),
                kind: "localReference".to_owned(),
                display_name: "本机引用.txt".to_owned(),
                original_name: Some("本机引用.txt".to_owned()),
                external_url: None,
                content_sha256: None,
                size_bytes: None,
                mime_type: None,
                sort_order: 1000,
                created_at: timestamp.clone(),
                updated_at: timestamp,
            },
        ];
        let task_links = vec![ExportTaskLink {
            id: "task-link-1".to_owned(),
            source_task_id: "task-1".to_owned(),
            target_task_id: "task-2".to_owned(),
            relation_type: "reference".to_owned(),
            sort_order: 0,
            target_title: Some("关联任务".to_owned()),
            created_at: "2026-08-25T00:00:00.000Z".to_owned(),
            updated_at: "2026-08-25T00:00:00.000Z".to_owned(),
        }];

        let json_export = build_json_export(
            &lists,
            &tasks,
            &[],
            &attachments,
            &task_links,
            "20260825-000000",
        )
        .unwrap();
        assert!(json_export.contains("\"attachments\""));
        assert!(json_export.contains("\"taskLinks\""));
        assert!(json_export.contains("合同.pdf"));
        assert!(json_export.contains("关联任务"));
        assert!(!json_export.contains("localPath"));
        assert!(!json_export.contains("remotePath"));
        assert!(!json_export.contains("C:\\"));

        let markdown_export = build_markdown_export(
            &lists,
            &tasks,
            &[],
            &attachments,
            &task_links,
            "20260825-000000",
        )
        .unwrap();
        assert!(markdown_export.contains("附件 合同.pdf；本机引用.txt"));
        assert!(markdown_export.contains("引用 关联任务"));
        assert!(!markdown_export.contains("C:\\"));

        let csv_export = build_csv_export(&tasks, &attachments, &task_links).unwrap();
        assert!(csv_export.starts_with("id,title"));
        assert!(csv_export.lines().next().unwrap().contains("attachments"));
        assert!(csv_export.lines().next().unwrap().contains("taskLinks"));
        assert!(csv_export.contains("合同.pdf；本机引用.txt"));
        assert!(csv_export.contains("关联任务"));
        assert!(!csv_export.contains("C:\\"));
    }

    #[test]
    fn backup_package_contains_database_and_managed_attachment() {
        let dir = std::env::temp_dir().join(format!("torder-package-{}", uuid::Uuid::new_v4()));
        let data_dir = dir.join("appdata");
        fs::create_dir_all(&data_dir).unwrap();
        let db_path = data_dir.join(DB_FILE_NAME);
        let database = Database::initialize(db_path.clone()).unwrap();
        let task = TaskRepository::new(&database)
            .create(CreateTaskInput {
                title: "附件备份任务".to_owned(),
                note: None,
                priority: Some(1),
                list_id: Some("work".to_owned()),
                scheduled_date: None,
                due_at: None,
                sort_order: Some(0),
                remind_before: None,
                repeat_rule: None,
                subtasks: None,
                tags: None,
            })
            .unwrap();
        let source_path = dir.join("source.txt");
        fs::write(&source_path, b"package attachment").unwrap();
        let attachment = AttachmentRepository::new(&database)
            .create_managed(
                &data_dir,
                CreateAttachmentInput {
                    task_id: task.id,
                    source_path: source_path.display().to_string(),
                    display_name: Some("备份附件".to_owned()),
                },
            )
            .unwrap();
        let snapshot_path = dir.join("snapshot.sqlite");
        snapshot_current_database(&db_path, &snapshot_path).unwrap();
        let package_path = dir.join("backup.zip");

        write_backup_package_from_snapshot(&data_dir, &snapshot_path, &package_path).unwrap();

        let extract_dir = dir.join("extract");
        fs::create_dir_all(&extract_dir).unwrap();
        extract_backup_package(&package_path, &extract_dir).unwrap();
        let manifest = validate_backup_package(&extract_dir).unwrap();
        assert_eq!(manifest.database.path, DB_FILE_NAME);
        assert_eq!(manifest.attachments.len(), 1);
        assert_eq!(manifest.attachments[0].blob_id, attachment.blob_id.unwrap());
        let extracted_blob = extract_dir.join(&manifest.attachments[0].path);
        assert!(extracted_blob.is_file());
        assert_eq!(
            sha256_file(&extracted_blob).unwrap().0,
            manifest.attachments[0].sha256
        );
        verify_restorable_database(&extract_dir.join(DB_FILE_NAME)).unwrap();

        drop(database);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn backup_package_rejects_zip_slip_entries() {
        let dir = std::env::temp_dir().join(format!("torder-zipslip-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let package_path = dir.join("malicious.zip");
        let file = fs::File::create(&package_path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        zip.start_file("../evil.txt", zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(b"evil").unwrap();
        zip.finish().unwrap();

        let extract_dir = dir.join("extract");
        fs::create_dir_all(&extract_dir).unwrap();
        assert!(matches!(
            extract_backup_package(&package_path, &extract_dir),
            Err(RepositoryError::Validation(
                "backup package contains unsafe path"
            ))
        ));
        assert!(!dir.join("evil.txt").exists());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn import_from_prepared_backup_merges_selected_objects() {
        let dir = std::env::temp_dir().join(format!("torder-import-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let current = Database::initialize(dir.join("current.sqlite")).unwrap();
        let backup = Database::initialize(dir.join("backup.sqlite")).unwrap();
        let backup_list = ListRepository::new(&backup)
            .create(CreateListInput {
                name: "旧项目".to_owned(),
                color: Some("#336699".to_owned()),
                sort_order: Some(8),
            })
            .unwrap();
        let backup_task = TaskRepository::new(&backup)
            .create(CreateTaskInput {
                title: "迁移任务".to_owned(),
                note: Some("来自旧备份".to_owned()),
                priority: Some(2),
                list_id: Some(backup_list.id.clone()),
                scheduled_date: Some("2030-01-01".to_owned()),
                due_at: Some("2030-01-01T09:00:00Z".to_owned()),
                sort_order: Some(3),
                remind_before: Some(30),
                repeat_rule: None,
                subtasks: Some(vec![crate::models::TaskSubtask {
                    id: "legacy-subtask".to_owned(),
                    title: "检查导入".to_owned(),
                    completed: false,
                    created_at: "2026-01-01T00:00:00Z".to_owned(),
                    completed_at: None,
                    sort_order: 0,
                }]),
                tags: Some(vec!["迁移".to_owned()]),
            })
            .unwrap();
        let backup_target_task = TaskRepository::new(&backup)
            .create(CreateTaskInput {
                title: "依赖任务".to_owned(),
                note: None,
                priority: Some(1),
                list_id: Some(backup_list.id.clone()),
                scheduled_date: None,
                due_at: None,
                sort_order: Some(4),
                remind_before: None,
                repeat_rule: None,
                subtasks: None,
                tags: None,
            })
            .unwrap();
        TaskLinkRepository::new(&backup)
            .create(CreateTaskLinkInput {
                source_task_id: backup_task.id,
                target_task_id: backup_target_task.id,
            })
            .unwrap();
        RecurringRuleRepository::new(&backup)
            .create(CreateRecurringRuleInput {
                source_task_id: None,
                title: "旧循环".to_owned(),
                note: None,
                priority: 1,
                list_id: backup_list.id,
                frequency: "daily".to_owned(),
                interval_count: 1,
                weekdays: vec![],
                month_day: None,
                first_due_at: "2030-01-02T09:00:00Z".to_owned(),
                timezone: "UTC".to_owned(),
                generate_ahead_minutes: 0,
                remind_before: None,
                end_at: None,
            })
            .unwrap();

        let result =
            import_from_prepared_backup(&current, None, &backup, None, true, true, true).unwrap();

        assert_eq!(result.imported_lists, 1);
        assert_eq!(result.imported_tasks, 2);
        assert_eq!(result.imported_recurring_rules, 1);
        let current_lists = ListRepository::new(&current).list().unwrap();
        let imported_list = current_lists
            .iter()
            .find(|list| list.name == "旧项目")
            .unwrap();
        let imported_tasks = TaskRepository::new(&current).export_all().unwrap();
        let imported_task = imported_tasks
            .iter()
            .find(|task| task.title == "迁移任务")
            .unwrap();
        assert_eq!(imported_task.list_id, imported_list.id);
        assert_eq!(imported_task.tags, vec!["迁移"]);
        assert_eq!(imported_task.subtasks[0].title, "检查导入");
        let imported_links = TaskLinkRepository::new(&current)
            .list_by_task(&imported_task.id)
            .unwrap();
        assert_eq!(imported_links.len(), 1);
        assert_eq!(imported_links[0].target_title.as_deref(), Some("依赖任务"));
        let imported_rules = RecurringRuleRepository::new(&current).list().unwrap();
        let imported_rule = imported_rules
            .iter()
            .find(|rule| rule.title == "旧循环")
            .unwrap();
        assert_eq!(imported_rule.list_id, imported_list.id);

        drop(imported_rules);
        drop(imported_tasks);
        drop(current_lists);
        drop(current);
        drop(backup);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn snapshot_current_database_includes_wal_changes() {
        let dir = std::env::temp_dir().join(format!("torder-snapshot-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("torder.sqlite");
        let snapshot_path = dir.join("snapshot.sqlite");

        let connection = rusqlite::Connection::open(&db_path).unwrap();
        connection
            .execute_batch(
                r#"
                PRAGMA journal_mode = WAL;
                CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
                INSERT INTO items (name) VALUES ('wal item');
                "#,
            )
            .unwrap();

        snapshot_current_database(&db_path, &snapshot_path).unwrap();

        let snapshot = rusqlite::Connection::open(&snapshot_path).unwrap();
        let count: i64 = snapshot
            .query_row("SELECT COUNT(*) FROM items", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
        drop(snapshot);
        drop(connection);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn finalize_restored_database_migrates_legacy_schema() {
        let dir = std::env::temp_dir().join(format!("torder-restore-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("torder.sqlite");
        let mut connection = rusqlite::Connection::open(&db_path).unwrap();
        crate::db::migrations::apply_migrations_through_for_test(&mut connection, 9).unwrap();
        drop(connection);

        finalize_restored_database(&db_path).unwrap();

        let database = Database::initialize(db_path.clone()).unwrap();
        let status = database.status().unwrap();
        assert_eq!(status.schema_version, CURRENT_SCHEMA_VERSION);
        assert_eq!(status.list_count, 3);
        let connection = database.connect().unwrap();
        let sync_change_table_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'sync_changes'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(sync_change_table_count, 1);
        drop(connection);
        drop(database);
        fs::remove_dir_all(&dir).unwrap();
    }
}
