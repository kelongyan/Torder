pub mod backup_repository;
pub mod list_repository;
pub mod migrations;
pub mod settings_repository;
pub mod tag_repository;
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
        for (id, name, sort_order) in [
            ("inbox", "收件箱", 0),
            ("work", "工作", 1),
            ("life", "生活", 2),
        ] {
            transaction.execute(
                r#"
                INSERT OR IGNORE INTO lists (id, name, sort_order, is_default)
                VALUES (?1, ?2, ?3, 1)
                "#,
                params![id, name, sort_order],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use uuid::Uuid;

    use crate::db::backup_repository::BackupRepository;
    use crate::db::settings_repository::SettingsRepository;
    use crate::db::tag_repository::TagRepository;
    use crate::db::task_repository::TaskRepository;
    use crate::error::{RepositoryError, RepositoryResult};
    use crate::models::{
        CreateTagInput, CreateTaskInput, TaskQueryInput, UpdateTaskInput, UpsertSettingInput,
    };

    use super::list_repository::ListRepository;
    use super::Database;

    #[test]
    fn initializes_migrates_and_persists_repository_data() -> RepositoryResult<()> {
        let database_path =
            std::env::temp_dir().join(format!("torder-database-test-{}.sqlite", Uuid::new_v4()));
        let database = Database::initialize(database_path.clone())?;

        let status = database.status()?;
        assert_eq!(status.schema_version, 2);
        assert_eq!(status.list_count, 3);
        assert_eq!(status.task_count, 0);

        let default_lists = ListRepository::new(&database).list()?;
        assert_eq!(
            default_lists
                .iter()
                .map(|list| list.id.as_str())
                .collect::<Vec<_>>(),
            vec!["inbox", "work", "life"]
        );

        let task_repository = TaskRepository::new(&database);
        let task = task_repository.create(CreateTaskInput {
            title: "  数据层测试任务  ".to_owned(),
            note: Some("验证创建、更新和软删除".to_owned()),
            priority: Some(2),
            list_id: Some("work".to_owned()),
            due_at: None,
            remind_at: None,
            sort_order: Some(1),
        })?;
        assert_eq!(task.title, "数据层测试任务");
        assert_eq!(task.status, "todo");

        let tag = TagRepository::new(&database).create(CreateTagInput {
            name: "数据库".to_owned(),
            color: Some("stone".to_owned()),
        })?;
        task_repository.set_tags(&task.id, std::slice::from_ref(&tag.id))?;
        assert_eq!(task_repository.list_tag_ids(&task.id)?, vec![tag.id]);

        let updated = task_repository.update(UpdateTaskInput {
            id: task.id.clone(),
            title: task.title.clone(),
            note: task.note.clone(),
            status: "done".to_owned(),
            priority: task.priority,
            list_id: task.list_id.clone(),
            due_at: task.due_at.clone(),
            remind_at: task.remind_at.clone(),
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
            remind_at: None,
            sort_order: None,
        })?;
        SettingsRepository::new(&database).upsert(UpsertSettingInput {
            key: "theme".to_owned(),
            value: r#""system""#.to_owned(),
        })?;

        drop(database);
        let reopened_database = Database::initialize(database_path.clone())?;
        assert_eq!(reopened_database.status()?.schema_version, 2);
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

        let overdue = repository.create(task_input(
            "过期任务",
            0,
            Some("2000-01-01T00:00:00Z"),
            None,
            10,
        ))?;
        let today = repository.create(task_input("今日任务", 0, Some(&today_due), None, 10))?;
        let reminded = repository.create(task_input(
            "提醒任务",
            0,
            None,
            Some("2999-01-01T00:00:00Z"),
            10,
        ))?;
        let urgent = repository.create(task_input("紧急任务", 2, None, None, 10))?;
        let normal = repository.create(task_input("普通任务", 0, None, None, 0))?;

        let all_ids = repository
            .list_all_todo()?
            .into_iter()
            .map(|task| task.id)
            .collect::<Vec<_>>();
        assert_eq!(
            &all_ids[..4],
            &[
                overdue.id.clone(),
                today.id.clone(),
                reminded.id.clone(),
                urgent.id.clone(),
            ]
        );
        assert!(all_ids.contains(&normal.id));

        assert_eq!(
            repository
                .list_today()?
                .into_iter()
                .map(|task| task.id)
                .collect::<Vec<_>>(),
            vec![overdue.id.clone(), today.id.clone()]
        );
        assert_eq!(
            repository
                .list_overdue()?
                .into_iter()
                .map(|task| task.id)
                .collect::<Vec<_>>(),
            vec![overdue.id.clone()]
        );

        let completed = repository.set_completed(&urgent.id, true)?;
        assert_eq!(completed.status, "done");
        assert!(completed.completed_at.is_some());
        assert_eq!(repository.list_completed()?[0].id, urgent.id);
        assert!(!repository
            .list_all_todo()?
            .iter()
            .any(|task| task.id == urgent.id));

        let reopened = repository.set_completed(&urgent.id, false)?;
        assert_eq!(reopened.status, "todo");
        assert!(reopened.completed_at.is_none());
        assert!(repository.list_completed()?.is_empty());

        repository.soft_delete(&today.id)?;
        assert_eq!(
            repository
                .list_today()?
                .into_iter()
                .map(|task| task.id)
                .collect::<Vec<_>>(),
            vec![overdue.id]
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
        let research_tag = TagRepository::new(&database).create(CreateTagInput {
            name: "调研".to_owned(),
            color: None,
        })?;
        let tagged_task = repository.create(CreateTaskInput {
            title: "整理竞品资料".to_owned(),
            note: Some("包含搜索验证关键字".to_owned()),
            priority: Some(2),
            list_id: Some("work".to_owned()),
            due_at: None,
            remind_at: None,
            sort_order: None,
        })?;
        repository.set_tags(&tagged_task.id, std::slice::from_ref(&research_tag.id))?;
        repository.create(CreateTaskInput {
            title: "购买生活用品".to_owned(),
            note: None,
            priority: Some(1),
            list_id: Some("life".to_owned()),
            due_at: None,
            remind_at: None,
            sort_order: None,
        })?;

        assert_eq!(
            repository
                .query(query_input("all", Some("调研")))?
                .into_iter()
                .map(|task| task.id)
                .collect::<Vec<_>>(),
            vec![tagged_task.id.clone()]
        );
        assert_eq!(
            repository
                .query(query_input("all", Some("工作")))?
                .into_iter()
                .map(|task| task.id)
                .collect::<Vec<_>>(),
            vec![tagged_task.id.clone()]
        );

        let combined = repository.query(TaskQueryInput {
            view: "all".to_owned(),
            query: Some("资料".to_owned()),
            date_filter: Some("none".to_owned()),
            priorities: vec![2],
            list_ids: vec!["work".to_owned()],
            tag_ids: vec![research_tag.id],
        })?;
        assert_eq!(combined.len(), 1);
        assert_eq!(combined[0].id, tagged_task.id);

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
            view: "all".to_owned(),
            query: Some("性能验证".to_owned()),
            date_filter: None,
            priorities: vec![1],
            list_ids: vec!["work".to_owned()],
            tag_ids: Vec::new(),
        })?;
        let elapsed = started.elapsed();
        assert_eq!(results.len(), 333);
        assert!(
            elapsed < std::time::Duration::from_millis(300),
            "1000-task query took {elapsed:?}"
        );

        drop(database);
        cleanup_database_files(&database_path);
        Ok(())
    }

    #[test]
    fn exports_validates_and_atomically_restores_complete_backups() -> RepositoryResult<()> {
        let database_path =
            std::env::temp_dir().join(format!("torder-backup-test-{}.sqlite", Uuid::new_v4()));
        let backup_path =
            std::env::temp_dir().join(format!("torder-backup-test-{}.json", Uuid::new_v4()));
        let invalid_path =
            std::env::temp_dir().join(format!("torder-invalid-test-{}.json", Uuid::new_v4()));
        let database = Database::initialize(database_path.clone())?;
        let task_repository = TaskRepository::new(&database);
        let settings_repository = SettingsRepository::new(&database);

        let task = task_repository.create(CreateTaskInput {
            title: "备份中的任务".to_owned(),
            note: Some("完整恢复验证".to_owned()),
            priority: Some(2),
            list_id: Some("work".to_owned()),
            due_at: None,
            remind_at: None,
            sort_order: None,
        })?;
        let tag = TagRepository::new(&database).create(CreateTagInput {
            name: "备份标签".to_owned(),
            color: Some("#047857".to_owned()),
        })?;
        task_repository.set_tags(&task.id, std::slice::from_ref(&tag.id))?;
        settings_repository.upsert(UpsertSettingInput {
            key: "theme".to_owned(),
            value: r#""light""#.to_owned(),
        })?;

        let backup_repository = BackupRepository::new(&database);
        let exported = backup_repository.export_to_path(&backup_path)?;
        assert_eq!(exported.preview.task_count, 1);
        assert_eq!(exported.preview.list_count, 3);
        assert_eq!(exported.preview.tag_count, 1);
        assert_eq!(exported.preview.setting_count, 4);
        assert_eq!(
            backup_repository
                .inspect_path(&backup_path)?
                .preview
                .task_count,
            1
        );

        let extra_task = task_repository.create(CreateTaskInput {
            title: "恢复时应被替换".to_owned(),
            note: None,
            priority: None,
            list_id: None,
            due_at: None,
            remind_at: None,
            sort_order: None,
        })?;
        settings_repository.upsert(UpsertSettingInput {
            key: "theme".to_owned(),
            value: r#""dark""#.to_owned(),
        })?;

        backup_repository.restore_from_path(&backup_path)?;
        assert!(matches!(
            task_repository.get(&extra_task.id),
            Err(RepositoryError::NotFound("task"))
        ));
        assert_eq!(task_repository.get(&task.id)?.title, "备份中的任务");
        assert_eq!(task_repository.list_tag_ids(&task.id)?, vec![tag.id]);
        assert_eq!(
            settings_repository
                .get("theme")?
                .expect("theme should exist")
                .value,
            r#""light""#
        );

        std::fs::write(&invalid_path, r#"{"app":"Torder","formatVersion":1}"#)?;
        let task_count_before = database.status()?.task_count;
        assert!(backup_repository.restore_from_path(&invalid_path).is_err());
        assert_eq!(database.status()?.task_count, task_count_before);
        assert_eq!(task_repository.get(&task.id)?.title, "备份中的任务");

        drop(database);
        cleanup_database_files(&database_path);
        let _ = std::fs::remove_file(backup_path);
        let _ = std::fs::remove_file(invalid_path);
        Ok(())
    }

    #[test]
    fn delivers_due_reminders_once_and_supports_snoozing() -> RepositoryResult<()> {
        let database_path =
            std::env::temp_dir().join(format!("torder-reminder-test-{}.sqlite", Uuid::new_v4()));
        let database = Database::initialize(database_path.clone())?;
        let repository = TaskRepository::new(&database);

        let overdue = repository.create(task_input(
            "过期提醒",
            0,
            None,
            Some("2000-01-01T00:00:00Z"),
            0,
        ))?;
        let future = repository.create(task_input(
            "未来提醒",
            0,
            None,
            Some("2999-01-01T00:00:00Z"),
            0,
        ))?;
        let completed = repository.create(task_input(
            "已完成提醒",
            0,
            None,
            Some("2000-01-01T00:00:00Z"),
            0,
        ))?;
        repository.set_completed(&completed.id, true)?;

        assert_eq!(
            repository
                .list_due_reminders()?
                .into_iter()
                .map(|task| task.id)
                .collect::<Vec<_>>(),
            vec![overdue.id.clone()]
        );
        let reminded = repository.mark_reminded(&overdue.id)?;
        assert!(reminded.reminded_at.is_some());
        assert!(repository.list_due_reminders()?.is_empty());

        let snoozed = repository.snooze_reminder(&overdue.id, 10)?;
        assert!(snoozed.reminded_at.is_none());
        assert!(snoozed.remind_at.is_some());
        assert!(repository.list_due_reminders()?.is_empty());
        assert!(matches!(
            repository.snooze_reminder(&overdue.id, 0),
            Err(RepositoryError::Validation(_))
        ));
        assert_eq!(repository.get(&future.id)?.reminded_at, None);

        drop(database);
        cleanup_database_files(&database_path);
        Ok(())
    }

    fn query_input(view: &str, query: Option<&str>) -> TaskQueryInput {
        TaskQueryInput {
            view: view.to_owned(),
            query: query.map(str::to_owned),
            date_filter: None,
            priorities: Vec::new(),
            list_ids: Vec::new(),
            tag_ids: Vec::new(),
        }
    }

    fn task_input(
        title: &str,
        priority: i64,
        due_at: Option<&str>,
        remind_at: Option<&str>,
        sort_order: i64,
    ) -> CreateTaskInput {
        CreateTaskInput {
            title: title.to_owned(),
            note: None,
            priority: Some(priority),
            list_id: None,
            due_at: due_at.map(str::to_owned),
            remind_at: remind_at.map(str::to_owned),
            sort_order: Some(sort_order),
        }
    }

    fn cleanup_database_files(database_path: &std::path::Path) {
        let _ = std::fs::remove_file(database_path);
        let _ = std::fs::remove_file(format!("{}-wal", database_path.display()));
        let _ = std::fs::remove_file(format!("{}-shm", database_path.display()));
    }
}
