use std::fs;
use std::path::{Path, PathBuf};

use serde_json::json;
use tauri::{AppHandle, Manager, State};

use crate::db::migrations::CURRENT_SCHEMA_VERSION;
use crate::db::recurring_repository::RecurringRuleRepository;
use crate::db::task_repository::TaskRepository;
use crate::db::Database;
use crate::error::{RepositoryError, RepositoryResult};
use crate::models::{RecurringRule, Task, TaskList};

const BACKUP_DIR_NAME: &str = "backups";
const DB_FILE_NAME: &str = "torder.sqlite";

#[tauri::command]
pub fn backup_database(app: AppHandle) -> Result<String, String> {
    backup_database_impl(&app).map_err(|error| error.to_string())
}

pub fn backup_database_impl(app: &AppHandle) -> RepositoryResult<String> {
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
    let quoted = backup_path.to_string_lossy().replace('\'', "''");
    let connection = rusqlite::Connection::open(&db_path)?;
    connection.execute_batch(&format!("VACUUM INTO '{quoted}'"))?;

    Ok(backup_path.display().to_string())
}

#[tauri::command]
pub fn export_tasks(
    app: AppHandle,
    database: State<'_, Database>,
    format: String,
) -> Result<String, String> {
    export_tasks_impl(&app, &database, &format).map_err(|error| error.to_string())
}

fn export_tasks_impl(
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
    let lists = TaskListRepository::new(database).list()?;
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

#[tauri::command]
pub fn list_backups(app: AppHandle) -> Result<Vec<String>, String> {
    list_backups_impl(&app).map_err(|error| error.to_string())
}

fn list_backups_impl(app: &AppHandle) -> RepositoryResult<Vec<String>> {
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

#[tauri::command]
pub fn restore_backup(app: AppHandle, path: String) -> Result<(), String> {
    restore_backup_impl(&app, &path).map_err(|error| error.to_string())
}

fn restore_backup_impl(app: &AppHandle, path: &str) -> RepositoryResult<()> {
    let data_dir = app.path().app_data_dir()?;
    let backup_dir = data_dir.join(BACKUP_DIR_NAME);
    // 这个入口来自 webview，且 tauri.conf.json 的 csp 为 null。
    // 不做校验的话它就是“用磁盘上任意文件覆盖用户数据库”的原语。
    let source = resolve_backup_path(&backup_dir, path)?;
    verify_restorable_database(&source)?;

    let db_path = data_dir.join(DB_FILE_NAME);
    // 覆盖前先留一份当前数据的安全网，恢复选错文件时还有退路。
    if db_path.exists() {
        let safety_copy = backup_dir.join(format!(
            "torder-prerestore-{}.sqlite",
            chrono::Local::now().format("%Y%m%d-%H%M%S")
        ));
        fs::copy(&db_path, &safety_copy)?;
    }

    fs::copy(&source, &db_path)?;
    let _ = fs::remove_file(data_dir.join("torder.sqlite-wal"));
    let _ = fs::remove_file(data_dir.join("torder.sqlite-shm"));
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
    let connection = rusqlite::Connection::open_with_flags(
        source,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
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
            buffer.push_str(&format!(
                "- [{done}] {}{} · 优先级 {priority}\n",
                task.title, due
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
        "id,title,note,status,priority,listId,dueAt,completedAt,createdAt,updatedAt,remindBefore,recurringRuleId,occurrenceAt\n",
    );
    for task in tasks.iter().filter(|task| task.deleted_at.is_none()) {
        let fields = [
            &task.id,
            &task.title,
            &task.note.clone().unwrap_or_default(),
            &task.status,
            &task.priority.to_string(),
            &task.list_id,
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

struct TaskListRepository<'database> {
    database: &'database Database,
}

impl<'database> TaskListRepository<'database> {
    fn new(database: &'database Database) -> Self {
        Self { database }
    }

    fn list(&self) -> RepositoryResult<Vec<TaskList>> {
        use crate::db::list_repository::ListRepository;
        ListRepository::new(self.database).list()
    }
}
