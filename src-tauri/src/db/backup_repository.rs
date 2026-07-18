use std::collections::HashSet;
use std::fs::File;
use std::io::{BufReader, BufWriter};
use std::path::Path;

use rusqlite::{params, Row};
use serde::{Deserialize, Serialize};

use crate::error::{RepositoryError, RepositoryResult};
use crate::models::{Setting, Tag, Task, TaskList};

use super::Database;

const BACKUP_APP: &str = "Torder";
const BACKUP_FORMAT_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskTagLink {
    pub task_id: String,
    pub tag_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupData {
    pub tasks: Vec<Task>,
    pub lists: Vec<TaskList>,
    pub tags: Vec<Tag>,
    pub task_tags: Vec<TaskTagLink>,
    pub settings: Vec<Setting>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupFile {
    pub app: String,
    pub version: String,
    pub format_version: u32,
    pub exported_at: String,
    pub data: BackupData,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupPreview {
    pub app_version: String,
    pub format_version: u32,
    pub exported_at: String,
    pub task_count: usize,
    pub list_count: usize,
    pub tag_count: usize,
    pub setting_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupOperationResult {
    pub path: String,
    pub preview: BackupPreview,
}

pub struct BackupRepository<'database> {
    database: &'database Database,
}

impl<'database> BackupRepository<'database> {
    pub fn new(database: &'database Database) -> Self {
        Self { database }
    }

    pub fn export_to_path(&self, path: &Path) -> RepositoryResult<BackupOperationResult> {
        let backup = self.create_backup()?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let file = File::create(path)?;
        serde_json::to_writer_pretty(BufWriter::new(file), &backup)?;
        Ok(BackupOperationResult {
            path: path.display().to_string(),
            preview: BackupPreview::from(&backup),
        })
    }

    pub fn inspect_path(&self, path: &Path) -> RepositoryResult<BackupOperationResult> {
        let backup = read_and_validate_backup(path)?;
        Ok(BackupOperationResult {
            path: path.display().to_string(),
            preview: BackupPreview::from(&backup),
        })
    }

    pub fn restore_from_path(&self, path: &Path) -> RepositoryResult<BackupOperationResult> {
        let backup = read_and_validate_backup(path)?;
        let preview = BackupPreview::from(&backup);
        let mut connection = self.database.connect()?;
        let transaction = connection.transaction()?;

        transaction.execute("DELETE FROM task_tags", [])?;
        transaction.execute("DELETE FROM tasks", [])?;
        transaction.execute("DELETE FROM tags", [])?;
        transaction.execute("DELETE FROM lists", [])?;
        transaction.execute("DELETE FROM settings", [])?;

        for list in &backup.data.lists {
            transaction.execute(
                r#"
                INSERT INTO lists (
                    id, name, color, sort_order, is_default, created_at, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                "#,
                params![
                    list.id,
                    list.name,
                    list.color,
                    list.sort_order,
                    i64::from(list.is_default),
                    list.created_at,
                    list.updated_at,
                ],
            )?;
        }

        for tag in &backup.data.tags {
            transaction.execute(
                r#"
                INSERT INTO tags (id, name, color, created_at, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5)
                "#,
                params![tag.id, tag.name, tag.color, tag.created_at, tag.updated_at],
            )?;
        }

        for task in &backup.data.tasks {
            transaction.execute(
                r#"
                INSERT INTO tasks (
                    id, title, note, status, priority, list_id, due_at, remind_at,
                    reminded_at, completed_at, sort_order, created_at, updated_at, deleted_at
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14
                )
                "#,
                params![
                    task.id,
                    task.title,
                    task.note,
                    task.status,
                    task.priority,
                    task.list_id,
                    task.due_at,
                    task.remind_at,
                    task.reminded_at,
                    task.completed_at,
                    task.sort_order,
                    task.created_at,
                    task.updated_at,
                    task.deleted_at,
                ],
            )?;
        }

        for link in &backup.data.task_tags {
            transaction.execute(
                "INSERT INTO task_tags (task_id, tag_id) VALUES (?1, ?2)",
                params![link.task_id, link.tag_id],
            )?;
        }

        for setting in &backup.data.settings {
            transaction.execute(
                "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)",
                params![setting.key, setting.value, setting.updated_at],
            )?;
        }

        transaction.commit()?;
        Ok(BackupOperationResult {
            path: path.display().to_string(),
            preview,
        })
    }

    fn create_backup(&self) -> RepositoryResult<BackupFile> {
        let mut connection = self.database.connect()?;
        let transaction = connection.transaction()?;

        let lists = {
            let mut statement = transaction.prepare(
                r#"
                SELECT id, name, color, sort_order, is_default, created_at, updated_at
                FROM lists ORDER BY sort_order ASC, created_at ASC
                "#,
            )?;
            let rows = statement
                .query_map([], map_list)?
                .collect::<Result<Vec<_>, _>>()?;
            rows
        };
        let tags = {
            let mut statement = transaction.prepare(
                r#"
                SELECT id, name, color, created_at, updated_at
                FROM tags ORDER BY name COLLATE NOCASE ASC
                "#,
            )?;
            let rows = statement
                .query_map([], map_tag)?
                .collect::<Result<Vec<_>, _>>()?;
            rows
        };
        let tasks = {
            let mut statement = transaction.prepare(
                r#"
                SELECT id, title, note, status, priority, list_id, due_at, remind_at,
                       reminded_at, completed_at, sort_order, created_at, updated_at, deleted_at
                FROM tasks ORDER BY created_at ASC
                "#,
            )?;
            let rows = statement
                .query_map([], map_task)?
                .collect::<Result<Vec<_>, _>>()?;
            rows
        };
        let task_tags = {
            let mut statement = transaction.prepare(
                "SELECT task_id, tag_id FROM task_tags ORDER BY task_id ASC, tag_id ASC",
            )?;
            let rows = statement
                .query_map([], |row| {
                    Ok(TaskTagLink {
                        task_id: row.get(0)?,
                        tag_id: row.get(1)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            rows
        };
        let settings = {
            let mut statement = transaction
                .prepare("SELECT key, value, updated_at FROM settings ORDER BY key ASC")?;
            let rows = statement
                .query_map([], |row| {
                    Ok(Setting {
                        key: row.get(0)?,
                        value: row.get(1)?,
                        updated_at: row.get(2)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            rows
        };
        let exported_at =
            transaction.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |row| {
                row.get(0)
            })?;
        transaction.commit()?;

        Ok(BackupFile {
            app: BACKUP_APP.to_owned(),
            version: env!("CARGO_PKG_VERSION").to_owned(),
            format_version: BACKUP_FORMAT_VERSION,
            exported_at,
            data: BackupData {
                tasks,
                lists,
                tags,
                task_tags,
                settings,
            },
        })
    }
}

impl From<&BackupFile> for BackupPreview {
    fn from(backup: &BackupFile) -> Self {
        Self {
            app_version: backup.version.clone(),
            format_version: backup.format_version,
            exported_at: backup.exported_at.clone(),
            task_count: backup.data.tasks.len(),
            list_count: backup.data.lists.len(),
            tag_count: backup.data.tags.len(),
            setting_count: backup.data.settings.len(),
        }
    }
}

fn read_and_validate_backup(path: &Path) -> RepositoryResult<BackupFile> {
    let file = File::open(path)?;
    let backup = serde_json::from_reader::<_, BackupFile>(BufReader::new(file))
        .map_err(|error| RepositoryError::InvalidBackup(format!("JSON 解析失败：{error}")))?;
    validate_backup(&backup)?;
    Ok(backup)
}

fn validate_backup(backup: &BackupFile) -> RepositoryResult<()> {
    if backup.app != BACKUP_APP {
        return invalid("文件不是 Torder 备份");
    }
    if backup.format_version != BACKUP_FORMAT_VERSION {
        return invalid("不支持的备份格式版本");
    }
    if backup.version.trim().is_empty() || backup.exported_at.trim().is_empty() {
        return invalid("备份元数据不完整");
    }

    let mut list_ids = HashSet::new();
    let mut list_names = HashSet::new();
    for list in &backup.data.lists {
        if list.id.trim().is_empty() || list.name.trim().is_empty() {
            return invalid("清单 ID 或名称为空");
        }
        if !list_ids.insert(list.id.as_str()) {
            return invalid("清单 ID 重复");
        }
        if !list_names.insert(list.name.to_lowercase()) {
            return invalid("清单名称重复");
        }
    }
    if !list_ids.contains("inbox") {
        return invalid("备份缺少收件箱清单");
    }

    let mut tag_ids = HashSet::new();
    let mut tag_names = HashSet::new();
    for tag in &backup.data.tags {
        if tag.id.trim().is_empty() || tag.name.trim().is_empty() {
            return invalid("标签 ID 或名称为空");
        }
        if !tag_ids.insert(tag.id.as_str()) {
            return invalid("标签 ID 重复");
        }
        if !tag_names.insert(tag.name.to_lowercase()) {
            return invalid("标签名称重复");
        }
    }

    let mut task_ids = HashSet::new();
    for task in &backup.data.tasks {
        if task.id.trim().is_empty() || task.title.trim().is_empty() {
            return invalid("任务 ID 或标题为空");
        }
        if !task_ids.insert(task.id.as_str()) {
            return invalid("任务 ID 重复");
        }
        if !matches!(task.status.as_str(), "todo" | "done" | "archived") {
            return invalid("任务状态无效");
        }
        if !(0..=2).contains(&task.priority) {
            return invalid("任务优先级无效");
        }
        if !list_ids.contains(task.list_id.as_str()) {
            return invalid("任务引用了不存在的清单");
        }
    }

    let mut links = HashSet::new();
    for link in &backup.data.task_tags {
        if !task_ids.contains(link.task_id.as_str()) || !tag_ids.contains(link.tag_id.as_str()) {
            return invalid("任务标签关联引用不完整");
        }
        if !links.insert((link.task_id.as_str(), link.tag_id.as_str())) {
            return invalid("任务标签关联重复");
        }
    }

    let mut setting_keys = HashSet::new();
    for setting in &backup.data.settings {
        if setting.key.trim().is_empty() || !setting_keys.insert(setting.key.as_str()) {
            return invalid("设置键为空或重复");
        }
        serde_json::from_str::<serde_json::Value>(&setting.value)
            .map_err(|_| RepositoryError::InvalidBackup("设置值不是合法 JSON".to_owned()))?;
    }

    Ok(())
}

fn invalid<T>(message: &str) -> RepositoryResult<T> {
    Err(RepositoryError::InvalidBackup(message.to_owned()))
}

fn map_list(row: &Row<'_>) -> rusqlite::Result<TaskList> {
    Ok(TaskList {
        id: row.get(0)?,
        name: row.get(1)?,
        color: row.get(2)?,
        sort_order: row.get(3)?,
        is_default: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

fn map_tag(row: &Row<'_>) -> rusqlite::Result<Tag> {
    Ok(Tag {
        id: row.get(0)?,
        name: row.get(1)?,
        color: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
    })
}

fn map_task(row: &Row<'_>) -> rusqlite::Result<Task> {
    Ok(Task {
        id: row.get(0)?,
        title: row.get(1)?,
        note: row.get(2)?,
        status: row.get(3)?,
        priority: row.get(4)?,
        list_id: row.get(5)?,
        due_at: row.get(6)?,
        remind_at: row.get(7)?,
        reminded_at: row.get(8)?,
        completed_at: row.get(9)?,
        sort_order: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
        deleted_at: row.get(13)?,
    })
}
