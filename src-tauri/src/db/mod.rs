pub mod list_repository;
pub mod migrations;
pub mod settings_repository;
pub mod task_repository;

use std::path::PathBuf;
use std::time::Duration;

use rusqlite::{params, Connection};

use crate::error::RepositoryResult;
use crate::models::DatabaseStatus;

#[derive(Debug)]
pub struct Database {
    path: PathBuf,
}

impl Database {
    pub fn initialize(path: PathBuf) -> RepositoryResult<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let database = Self { path };
        let mut connection = database.connect()?;
        migrations::apply_migrations(&mut connection)?;
        Self::initialize_default_lists(&mut connection)?;

        Ok(database)
    }

    pub fn connect(&self) -> RepositoryResult<Connection> {
        let connection = Connection::open(&self.path)?;
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.execute_batch(
            r#"
            PRAGMA foreign_keys = ON;
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            "#,
        )?;
        Ok(connection)
    }

    pub fn status(&self) -> RepositoryResult<DatabaseStatus> {
        let connection = self.connect()?;
        let schema_version = connection.query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )?;
        let list_count =
            connection.query_row("SELECT COUNT(*) FROM lists", [], |row| row.get(0))?;
        let task_count = connection.query_row(
            "SELECT COUNT(*) FROM tasks WHERE deleted_at IS NULL",
            [],
            |row| row.get(0),
        )?;

        Ok(DatabaseStatus {
            database_path: self.path.display().to_string(),
            schema_version,
            list_count,
            task_count,
        })
    }

    fn initialize_default_lists(connection: &mut Connection) -> RepositoryResult<()> {
        let transaction = connection.transaction()?;
        for (id, name, color, sort_order) in [
            ("work", "工作", "#6366f1", 0),
            ("personal", "个人", "#22c55e", 1),
            ("study", "学习", "#a855f7", 2),
        ] {
            transaction.execute(
                r#"
                INSERT OR IGNORE INTO lists (id, name, color, sort_order, is_default)
                VALUES (?1, ?2, ?3, ?4, 1)
                "#,
                params![id, name, color, sort_order],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use uuid::Uuid;

    use crate::db::settings_repository::SettingsRepository;
    use crate::db::task_repository::TaskRepository;
    use crate::error::{RepositoryError, RepositoryResult};
    use crate::models::{CreateTaskInput, TaskQueryInput, UpdateTaskInput, UpsertSettingInput};

    use super::list_repository::ListRepository;
    use super::Database;

    #[test]
    fn initializes_migrates_and_persists_repository_data() -> RepositoryResult<()> {
        let database_path =
            std::env::temp_dir().join(format!("torder-database-test-{}.sqlite", Uuid::new_v4()));
        let database = Database::initialize(database_path.clone())?;

        let status = database.status()?;
        assert_eq!(status.schema_version, 3);
        assert_eq!(status.list_count, 3);
        assert_eq!(status.task_count, 0);

        let default_lists = ListRepository::new(&database).list()?;
        assert_eq!(
            default_lists
                .iter()
                .map(|list| list.id.as_str())
                .collect::<Vec<_>>(),
            vec!["work", "personal", "study"]
        );

        let task_repository = TaskRepository::new(&database);
        let task = task_repository.create(CreateTaskInput {
            title: "  数据层测试任务  ".to_owned(),
            note: Some("验证创建、更新和软删除".to_owned()),
            priority: Some(2),
            list_id: Some("work".to_owned()),
            due_at: None,
            sort_order: Some(1),
        })?;
        assert_eq!(task.title, "数据层测试任务");
        assert_eq!(task.status, "todo");

        let updated = task_repository.update(UpdateTaskInput {
            id: task.id.clone(),
            title: task.title.clone(),
            note: task.note.clone(),
            status: "done".to_owned(),
            priority: task.priority,
            list_id: task.list_id.clone(),
            due_at: task.due_at.clone(),
            sort_order: task.sort_order,
        })?;
        assert_eq!(updated.status, "done");
        assert!(updated.completed_at.is_some());

        task_repository.soft_delete(&task.id)?;
        assert!(matches!(
            task_repository.get(&task.id),
            Err(RepositoryError::NotFound("task"))
        ));

        let persistent_task = task_repository.create(CreateTaskInput {
            title: "重启后仍存在".to_owned(),
            note: None,
            priority: None,
            list_id: None,
            due_at: None,
            sort_order: None,
        })?;
        SettingsRepository::new(&database).upsert(UpsertSettingInput {
            key: "theme".to_owned(),
            value: r#""system""#.to_owned(),
        })?;

        drop(database);
        let reopened_database = Database::initialize(database_path.clone())?;
        assert_eq!(reopened_database.status()?.schema_version, 3);
        assert_eq!(
            TaskRepository::new(&reopened_database)
                .get(&persistent_task.id)?
                .title,
            "重启后仍存在"
        );
        assert_eq!(
            SettingsRepository::new(&reopened_database)
                .get("theme")?
                .expect("theme setting should persist")
                .value,
            r#""system""#
        );

        drop(reopened_database);
        cleanup_database_files(&database_path);
        Ok(())
    }

    #[test]
    fn supports_core_task_views_sorting_and_completion_flow() -> RepositoryResult<()> {
        let database_path =
            std::env::temp_dir().join(format!("torder-task-flow-test-{}.sqlite", Uuid::new_v4()));
        let database = Database::initialize(database_path.clone())?;
        let repository = TaskRepository::new(&database);
        let today_due = database.connect()?.query_row(
            r#"
            SELECT strftime(
                '%Y-%m-%dT%H:%M:%SZ',
                datetime(date('now', 'localtime') || ' 23:59:59', 'utc')
            )
            "#,
            [],
            |row| row.get::<_, String>(0),
        )?;

        let today = repository.create(task_input("今日任务", 0, Some(&today_due), None, 10))?;
        let urgent = repository.create(task_input("紧急任务", 2, None, None, 10))?;
        let normal = repository.create(task_input("普通任务", 0, None, None, 0))?;

        let all_ids = repository
            .query(query_input("view", "all", None, "priority", true))?
            .into_iter()
            .map(|task| task.id)
            .collect::<Vec<_>>();
        assert_eq!(&all_ids[..2], &[urgent.id.clone(), today.id.clone()]);
        assert!(all_ids.contains(&normal.id));

        assert_eq!(
            repository
                .query(query_input("view", "today", None, "date", true))?
                .into_iter()
                .map(|task| task.id)
                .collect::<Vec<_>>(),
            vec![today.id.clone()]
        );
        assert_eq!(
            repository
                .query(query_input("view", "important", None, "priority", true))?
                .into_iter()
                .map(|task| task.id)
                .collect::<Vec<_>>(),
            vec![urgent.id.clone()]
        );

        let completed = repository.set_completed(&urgent.id, true)?;
        assert_eq!(completed.status, "done");
        assert!(completed.completed_at.is_some());
        assert_eq!(
            repository.query(query_input("view", "completed", None, "created", true))?[0]
                .id
                .as_str(),
            urgent.id.as_str()
        );
        assert!(!repository
            .query(query_input("view", "all", None, "priority", false))?
            .iter()
            .any(|task| task.id == urgent.id));

        let reopened = repository.set_completed(&urgent.id, false)?;
        assert_eq!(reopened.status, "todo");
        assert!(reopened.completed_at.is_none());
        assert!(repository
            .query(query_input("view", "completed", None, "created", true))?
            .is_empty());

        repository.soft_delete(&today.id)?;
        assert_eq!(
            repository
                .query(query_input("view", "today", None, "date", true))?
                .into_iter()
                .map(|task| task.id)
                .collect::<Vec<_>>(),
            Vec::<String>::new()
        );

        drop(database);
        cleanup_database_files(&database_path);
        Ok(())
    }

    #[test]
    fn searches_combines_filters_and_handles_one_thousand_tasks() -> RepositoryResult<()> {
        let database_path =
            std::env::temp_dir().join(format!("torder-filter-test-{}.sqlite", Uuid::new_v4()));
        let database = Database::initialize(database_path.clone())?;
        let repository = TaskRepository::new(&database);
        let matched_task = repository.create(CreateTaskInput {
            title: "整理竞品资料".to_owned(),
            note: Some("包含搜索验证关键字".to_owned()),
            priority: Some(2),
            list_id: Some("work".to_owned()),
            due_at: None,
            sort_order: None,
        })?;
        repository.create(CreateTaskInput {
            title: "购买生活用品".to_owned(),
            note: None,
            priority: Some(1),
            list_id: Some("personal".to_owned()),
            due_at: None,
            sort_order: None,
        })?;

        assert_eq!(
            repository
                .query(query_input("view", "all", Some("关键字"), "priority", true))?
                .into_iter()
                .map(|task| task.id)
                .collect::<Vec<_>>(),
            vec![matched_task.id.clone()]
        );

        let combined = repository.query(TaskQueryInput {
            scope_kind: "list".to_owned(),
            scope_value: "work".to_owned(),
            query: Some("资料".to_owned()),
            sort_by: Some("priority".to_owned()),
            show_completed: true,
        })?;
        assert_eq!(combined.len(), 1);
        assert_eq!(combined[0].id.as_str(), matched_task.id.as_str());

        let mut connection = database.connect()?;
        let transaction = connection.transaction()?;
        {
            let mut statement = transaction.prepare(
                r#"
                INSERT INTO tasks (id, title, priority, list_id, sort_order)
                VALUES (?1, ?2, ?3, 'work', ?4)
                "#,
            )?;
            for index in 0..1000 {
                statement.execute(rusqlite::params![
                    format!("performance-{index}"),
                    format!("性能验证任务 {index}"),
                    index % 3,
                    index
                ])?;
            }
        }
        transaction.commit()?;

        let started = std::time::Instant::now();
        let results = repository.query(TaskQueryInput {
            scope_kind: "view".to_owned(),
            scope_value: "all".to_owned(),
            query: Some("性能验证".to_owned()),
            sort_by: Some("priority".to_owned()),
            show_completed: true,
        })?;
        let elapsed = started.elapsed();
        assert_eq!(results.len(), 1000);
        assert!(
            elapsed < std::time::Duration::from_millis(300),
            "1000-task query took {elapsed:?}"
        );

        drop(database);
        cleanup_database_files(&database_path);
        Ok(())
    }

    fn query_input(
        scope_kind: &str,
        scope_value: &str,
        query: Option<&str>,
        sort_by: &str,
        show_completed: bool,
    ) -> TaskQueryInput {
        TaskQueryInput {
            scope_kind: scope_kind.to_owned(),
            scope_value: scope_value.to_owned(),
            query: query.map(str::to_owned),
            sort_by: Some(sort_by.to_owned()),
            show_completed,
        }
    }

    fn task_input(
        title: &str,
        priority: i64,
        due_at: Option<&str>,
        list_id: Option<&str>,
        sort_order: i64,
    ) -> CreateTaskInput {
        CreateTaskInput {
            title: title.to_owned(),
            note: None,
            priority: Some(priority),
            list_id: list_id.map(str::to_owned),
            due_at: due_at.map(str::to_owned),
            sort_order: Some(sort_order),
        }
    }

    fn cleanup_database_files(database_path: &std::path::Path) {
        let _ = std::fs::remove_file(database_path);
        let _ = std::fs::remove_file(format!("{}-wal", database_path.display()));
        let _ = std::fs::remove_file(format!("{}-shm", database_path.display()));
    }
}
