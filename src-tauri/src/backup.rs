use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::db::list_repository::ListRepository;
use crate::db::migrations::CURRENT_SCHEMA_VERSION;
use crate::db::recurring_repository::RecurringRuleRepository;
use crate::db::settings_repository::SettingsRepository;
use crate::db::sync_repository;
use crate::db::task_repository::TaskRepository;
use crate::db::Database;
use crate::error::{RepositoryError, RepositoryResult};
use crate::models::{
    CreateListInput, CreateRecurringRuleInput, CreateTaskInput, RecurringRule, Task, TaskList,
    UpdateTaskInput,
};

const BACKUP_DIR_NAME: &str = "backups";
const DB_FILE_NAME: &str = "torder.sqlite";
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

pub fn backup_database(app: &AppHandle, database: &Database) -> RepositoryResult<String> {
    let data_dir = app.path().app_data_dir()?;
    let db_path = data_dir.join(DB_FILE_NAME);
    let backup_dir = data_dir.join(BACKUP_DIR_NAME);
    fs::create_dir_all(&backup_dir)?;

    let connection = rusqlite::Connection::open(&db_path)?;
    let stamp: String = connection.query_row(
        "SELECT strftime('%Y%m%d-%H%M%S', 'now', 'localtime')",
        [],
        |row| row.get(0),
    )?;
    drop(connection);

    let backup_path = backup_dir.join(format!("torder-backup-{stamp}.sqlite"));
    let connection = rusqlite::Connection::open(&db_path)?;
    vacuum_into(&connection, &backup_path)?;

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

/// 只保留最新的 `retention` 份 `torder-backup-*.sqlite`；
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
                .map(|name| name.starts_with("torder-backup-") && name.ends_with(".sqlite"))
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

    let file_name = match format {
        "json" => format!("torder-export-{stamp}.json"),
        "markdown" => format!("torder-export-{stamp}.md"),
        "csv" => format!("torder-export-{stamp}.csv"),
        _ => return Err(RepositoryError::Validation("unsupported export format")),
    };
    let export_path = export_dir.join(&file_name);
    let content = match format {
        "json" => build_json_export(&lists, &tasks, &recurring_rules, &stamp)?,
        "markdown" => build_markdown_export(&lists, &tasks, &recurring_rules, &stamp)?,
        _ => build_csv_export(&tasks)?,
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
        .filter(|path| {
            path.extension()
                .map(|extension| extension == "sqlite")
                .unwrap_or(false)
        })
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
    verify_restorable_database(&source)?;

    let db_path = data_dir.join(DB_FILE_NAME);
    // 覆盖前先用 SQLite 自己导出一致性快照，避免 WAL 中的未 checkpoint 数据丢失。
    if db_path.exists() {
        let safety_copy = backup_dir.join(format!(
            "torder-prerestore-{}-{}.sqlite",
            chrono::Local::now().format("%Y%m%d-%H%M%S"),
            uuid::Uuid::new_v4()
        ));
        snapshot_current_database(&db_path, &safety_copy)?;
    }

    replace_database_file(&source, &db_path)?;
    finalize_restored_database(&db_path)?;
    Ok(())
}

pub fn preview_backup_import(app: &AppHandle, path: &str) -> RepositoryResult<BackupImportPreview> {
    let data_dir = app.path().app_data_dir()?;
    let backup_dir = data_dir.join(BACKUP_DIR_NAME);
    fs::create_dir_all(&backup_dir)?;
    let source = resolve_backup_path(&backup_dir, path)?;
    verify_restorable_database(&source)?;
    let name = source
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("backup.sqlite")
        .to_owned();

    with_prepared_backup_database(app, &source, |backup_database| {
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
    verify_restorable_database(&source)?;

    with_prepared_backup_database(app, &source, |backup_database| {
        import_from_prepared_backup(
            database,
            backup_database,
            include_lists,
            include_tasks,
            include_recurring_rules,
        )
    })
}

fn snapshot_current_database(db_path: &Path, snapshot_path: &Path) -> RepositoryResult<()> {
    let connection = rusqlite::Connection::open(db_path)?;
    vacuum_into(&connection, snapshot_path)
}

fn replace_database_file(source: &Path, db_path: &Path) -> RepositoryResult<()> {
    remove_database_sidecars(db_path);
    fs::copy(source, db_path)?;
    remove_database_sidecars(db_path);
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

fn with_prepared_backup_database<T>(
    app: &AppHandle,
    source: &Path,
    reader: impl FnOnce(&Database) -> RepositoryResult<T>,
) -> RepositoryResult<T> {
    let import_dir = app.path().app_data_dir()?.join("import-work");
    fs::create_dir_all(&import_dir)?;
    let temp_path = import_dir.join(format!("backup-import-{}.sqlite", Uuid::new_v4()));
    fs::copy(source, &temp_path)?;

    let result = (|| {
        let backup_database = Database::initialize(temp_path.clone())?;
        reader(&backup_database)
    })();

    remove_database_sidecars(&temp_path);
    let _ = fs::remove_file(&temp_path);
    result
}

fn import_from_prepared_backup(
    database: &Database,
    backup_database: &Database,
    include_lists: bool,
    include_tasks: bool,
    include_recurring_rules: bool,
) -> RepositoryResult<BackupImportResult> {
    let backup_lists = ListRepository::new(backup_database).list()?;
    let current_lists = ListRepository::new(database).list()?;
    let mut list_id_map = std::collections::HashMap::<String, String>::new();
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
            if task.status != "todo" {
                let _ = TaskRepository::new(database).update(UpdateTaskInput {
                    id: created.id,
                    title: created.title,
                    note: created.note,
                    status: task.status,
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
            imported_tasks += 1;
        }
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

/// 把传入路径限制在备份目录内，抵御 `..` 穿越与符号链接绕过。
fn resolve_backup_path(backup_dir: &Path, path: &str) -> RepositoryResult<PathBuf> {
    let source = PathBuf::from(path);
    if !source.is_file() {
        return Err(RepositoryError::Validation("backup file does not exist"));
    }
    if source.extension().and_then(|value| value.to_str()) != Some("sqlite") {
        return Err(RepositoryError::Validation("backup must be a .sqlite file"));
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
    stamp: &str,
) -> RepositoryResult<String> {
    let payload = json!({
        "app": "Torder",
        "schemaVersion": CURRENT_SCHEMA_VERSION,
        "exportedAt": stamp,
        "lists": lists,
        "tasks": tasks,
        "recurringRules": recurring_rules,
    });
    Ok(serde_json::to_string_pretty(&payload)?)
}

fn build_markdown_export(
    lists: &[TaskList],
    tasks: &[Task],
    recurring_rules: &[RecurringRule],
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
            buffer.push_str(&format!(
                "- [{done}] {}{}{} · 优先级 {priority}\n",
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

fn build_csv_export(tasks: &[Task]) -> RepositoryResult<String> {
    let mut buffer = String::from(
        "id,title,note,status,priority,listId,scheduledDate,dueAt,completedAt,createdAt,updatedAt,remindBefore,recurringRuleId,occurrenceAt\n",
    );
    for task in tasks.iter().filter(|task| task.deleted_at.is_none()) {
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
        TaskRepository::new(&backup)
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

        let result = import_from_prepared_backup(&current, &backup, true, true, true).unwrap();

        assert_eq!(result.imported_lists, 1);
        assert_eq!(result.imported_tasks, 1);
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
