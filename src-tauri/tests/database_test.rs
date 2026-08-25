use std::path::Path;

use uuid::Uuid;

use torder_lib::db::attachment_repository::{sha256_file, AttachmentRepository};
use torder_lib::db::calendar_event_repository::CalendarEventRepository;
use torder_lib::db::list_repository::ListRepository;
use torder_lib::db::migrations::CURRENT_SCHEMA_VERSION;
use torder_lib::db::recurring_repository::RecurringRuleRepository;
use torder_lib::db::settings_repository::SettingsRepository;
use torder_lib::db::sync_repository;
use torder_lib::db::task_repository::TaskRepository;
use torder_lib::db::Database;
use torder_lib::error::{RepositoryError, RepositoryResult};
use torder_lib::models::{
    CreateCalendarEventInput, CreateRecurringRuleInput, CreateTaskInput, TaskQueryInput,
    UpdateCalendarEventInput, UpdateRecurringRuleInput, UpdateTaskInput, UpsertSettingInput,
};

#[test]
fn initializes_migrates_and_persists_repository_data() -> RepositoryResult<()> {
    let database_path =
        std::env::temp_dir().join(format!("torder-database-test-{}.sqlite", Uuid::new_v4()));
    let database = Database::initialize(database_path.clone())?;

    let status = database.status()?;
    assert_eq!(status.schema_version, CURRENT_SCHEMA_VERSION);
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
    assert_eq!(
        default_lists
            .iter()
            .map(|list| list.color.as_deref())
            .collect::<Vec<_>>(),
        vec![Some("#bd93f9"), Some("#50fa7b"), Some("#8be9fd")]
    );

    let task_repository = TaskRepository::new(&database);
    let task = task_repository.create(CreateTaskInput {
        title: "  数据层测试任务  ".to_owned(),
        note: Some("验证创建、更新和软删除".to_owned()),
        priority: Some(2),
        list_id: Some("work".to_owned()),
        scheduled_date: None,
        due_at: None,
        sort_order: Some(1),
        remind_before: None,
        repeat_rule: None,
        subtasks: None,
        tags: None,
    })?;
    assert_eq!(task.title, "数据层测试任务");
    assert_eq!(task.status, "todo");
    let connection = database.connect()?;
    assert_eq!(sync_repository::pending_count(&connection)?, 1);

    let updated = task_repository.update(UpdateTaskInput {
        id: task.id.clone(),
        title: task.title.clone(),
        note: task.note.clone(),
        status: "done".to_owned(),
        priority: task.priority,
        list_id: task.list_id.clone(),
        scheduled_date: task.scheduled_date.clone(),
        due_at: task.due_at.clone(),
        sort_order: task.sort_order,
        remind_before: task.remind_before,
        repeat_rule: task.repeat_rule.clone(),
        subtasks: task.subtasks.clone(),
        tags: task.tags.clone(),
    })?;
    assert_eq!(updated.status, "done");
    assert!(updated.completed_at.is_some());

    task_repository.soft_delete(&task.id)?;
    assert_eq!(sync_repository::pending_count(&database.connect()?)?, 3);
    assert!(matches!(
        task_repository.get(&task.id),
        Err(RepositoryError::NotFound("task"))
    ));

    let persistent_task = task_repository.create(CreateTaskInput {
        title: "重启后仍存在".to_owned(),
        note: None,
        priority: None,
        list_id: None,
        scheduled_date: None,
        due_at: None,
        sort_order: None,
        remind_before: None,
        repeat_rule: None,
        subtasks: None,
        tags: None,
    })?;
    SettingsRepository::new(&database).upsert(UpsertSettingInput {
        key: "theme".to_owned(),
        value: r#""system""#.to_owned(),
    })?;

    drop(database);
    let reopened_database = Database::initialize(database_path.clone())?;
    assert_eq!(
        reopened_database.status()?.schema_version,
        CURRENT_SCHEMA_VERSION
    );
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
fn sync_change_log_tracks_revision_and_rolls_back_with_business_transaction() -> RepositoryResult<()>
{
    let database_path =
        std::env::temp_dir().join(format!("torder-sync-log-{}.sqlite", Uuid::new_v4()));
    let database = Database::initialize(database_path.clone())?;
    let repository = TaskRepository::new(&database);
    let task = repository.create(task_input("变更日志", 1, None, None, 0))?;
    let connection = database.connect()?;
    let revisions: Vec<i64> = {
        let mut statement = connection.prepare(
            "SELECT revision FROM sync_changes WHERE entity = 'task' AND object_id = ?1 ORDER BY revision",
        )?;
        let values = statement
            .query_map(rusqlite::params![task.id], |row| row.get(0))?
            .collect::<Result<Vec<_>, _>>()?;
        values
    };
    assert_eq!(revisions, vec![1]);

    repository.set_completed(&task.id, true)?;
    repository.soft_delete(&task.id)?;
    repository.restore(&task.id)?;
    let count: i64 = database.connect()?.query_row(
        "SELECT COUNT(*) FROM sync_changes WHERE entity = 'task' AND object_id = ?1",
        rusqlite::params![task.id],
        |row| row.get(0),
    )?;
    assert_eq!(count, 4);

    drop(database);
    cleanup_database_files(&database_path);
    Ok(())
}

#[test]
fn updating_reminder_schedule_clears_reminded_at_and_records_sync_payload() -> RepositoryResult<()>
{
    let database_path =
        std::env::temp_dir().join(format!("torder-reminder-reset-{}.sqlite", Uuid::new_v4()));
    let database = Database::initialize(database_path.clone())?;
    let repository = TaskRepository::new(&database);
    let task = repository.create(CreateTaskInput {
        title: "提醒状态重置".to_owned(),
        note: None,
        priority: Some(1),
        list_id: Some("work".to_owned()),
        scheduled_date: Some("2026-08-22".to_owned()),
        due_at: Some("2026-08-22T10:00:00Z".to_owned()),
        sort_order: Some(0),
        remind_before: Some(60),
        repeat_rule: None,
        subtasks: None,
        tags: None,
    })?;
    database.connect()?.execute(
        "UPDATE tasks SET reminded_at = '2026-08-22T08:30:00.000Z' WHERE id = ?1",
        rusqlite::params![&task.id],
    )?;

    let updated = repository.update(UpdateTaskInput {
        id: task.id.clone(),
        title: task.title.clone(),
        note: task.note.clone(),
        status: task.status.clone(),
        priority: task.priority,
        list_id: task.list_id.clone(),
        scheduled_date: task.scheduled_date.clone(),
        due_at: task.due_at.clone(),
        sort_order: task.sort_order,
        remind_before: Some(30),
        repeat_rule: task.repeat_rule.clone(),
        subtasks: task.subtasks.clone(),
        tags: task.tags.clone(),
    })?;

    assert!(updated.reminded_at.is_none());
    assert_eq!(updated.remind_before, Some(30));
    let connection = database.connect()?;
    let payload_json: String = connection.query_row(
        "SELECT payload_json FROM sync_changes WHERE entity = 'task' AND object_id = ?1 ORDER BY revision DESC LIMIT 1",
        rusqlite::params![&task.id],
        |row| row.get(0),
    )?;
    let payload: serde_json::Value = serde_json::from_str(&payload_json)?;
    assert!(payload["remindedAt"].is_null());
    assert_eq!(payload["remindBefore"], 30);
    let change_count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM sync_changes WHERE entity = 'task' AND object_id = ?1",
        rusqlite::params![&task.id],
        |row| row.get(0),
    )?;
    assert_eq!(change_count, 2);

    drop(connection);
    drop(database);
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
fn scheduled_date_without_deadline_participates_in_planned_views() -> RepositoryResult<()> {
    let database_path = std::env::temp_dir().join(format!(
        "torder-scheduled-date-test-{}.sqlite",
        Uuid::new_v4()
    ));
    let database = Database::initialize(database_path.clone())?;
    let repository = TaskRepository::new(&database);
    let today_key =
        database
            .connect()?
            .query_row("SELECT date('now', 'localtime')", [], |row| {
                row.get::<_, String>(0)
            })?;
    let overdue_due = database.connect()?.query_row(
        r#"
        SELECT strftime(
            '%Y-%m-%dT%H:%M:%SZ',
            datetime(date('now', 'localtime', '-1 day') || ' 09:00:00', 'utc')
        )
        "#,
        [],
        |row| row.get::<_, String>(0),
    )?;

    let scheduled_only = repository.create(CreateTaskInput {
        title: "只有计划日期".to_owned(),
        note: None,
        priority: Some(1),
        list_id: Some("work".to_owned()),
        scheduled_date: Some(today_key),
        due_at: None,
        sort_order: Some(0),
        remind_before: None,
        repeat_rule: None,
        subtasks: None,
        tags: None,
    })?;
    let overdue = repository.create(task_input("真正过期", 1, Some(&overdue_due), None, 1))?;

    assert_eq!(
        repository
            .query(query_input("view", "today", None, "date", true))?
            .into_iter()
            .map(|task| task.id)
            .collect::<Vec<_>>(),
        vec![scheduled_only.id.clone()]
    );
    let planned_ids = repository
        .query(query_input("view", "planned", None, "date", true))?
        .into_iter()
        .map(|task| task.id)
        .collect::<Vec<_>>();
    assert!(planned_ids.contains(&scheduled_only.id));
    assert!(planned_ids.contains(&overdue.id));
    assert_eq!(
        repository
            .query(query_input("view", "overdue", None, "date", true))?
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
fn trash_cleanup_and_permanent_delete_hide_deleted_tasks() -> RepositoryResult<()> {
    let database_path =
        std::env::temp_dir().join(format!("torder-trash-flow-test-{}.sqlite", Uuid::new_v4()));
    let database = Database::initialize(database_path.clone())?;
    let repository = TaskRepository::new(&database);

    let stale = repository.create(task_input("过期回收站任务", 0, None, None, 0))?;
    let fresh = repository.create(task_input("保留回收站任务", 1, None, None, 1))?;
    repository.soft_delete(&stale.id)?;
    repository.soft_delete(&fresh.id)?;

    database.connect()?.execute(
        "UPDATE tasks SET deleted_at = '2000-01-01T00:00:00.000Z' WHERE id = ?1",
        rusqlite::params![&stale.id],
    )?;
    database.connect()?.execute(
        "UPDATE tasks SET deleted_at = '2999-01-01T00:00:00.000Z' WHERE id = ?1",
        rusqlite::params![&fresh.id],
    )?;

    assert_eq!(
        repository
            .query(query_input("view", "deleted", None, "created", true))?
            .len(),
        2
    );

    assert_eq!(repository.cleanup_trash(7)?, 1);
    let remaining = repository.query(query_input("view", "deleted", None, "created", true))?;
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].id, fresh.id);

    repository.permanent_delete(&fresh.id)?;
    assert!(repository
        .query(query_input("view", "deleted", None, "created", true))?
        .is_empty());
    assert_eq!(repository.empty_trash()?, 0);
    assert!(matches!(
        repository.restore(&stale.id),
        Err(RepositoryError::NotFound("task"))
    ));

    let purged_count: i64 = database.connect()?.query_row(
        "SELECT COUNT(*) FROM tasks WHERE purged_at IS NOT NULL",
        [],
        |row| row.get(0),
    )?;
    assert_eq!(purged_count, 2);

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
        scheduled_date: None,
        due_at: None,
        sort_order: None,
        remind_before: None,
        repeat_rule: None,
        subtasks: None,
        tags: Some(vec!["竞品".to_owned(), "资料".to_owned()]),
    })?;
    repository.create(CreateTaskInput {
        title: "购买生活用品".to_owned(),
        note: None,
        priority: Some(1),
        list_id: Some("personal".to_owned()),
        scheduled_date: None,
        due_at: None,
        sort_order: None,
        remind_before: None,
        repeat_rule: None,
        subtasks: None,
        tags: Some(vec!["生活".to_owned()]),
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

    let tagged = repository.query(TaskQueryInput {
        scope_kind: "view".to_owned(),
        scope_value: "all".to_owned(),
        query: Some("tag:竞品".to_owned()),
        sort_by: Some("priority".to_owned()),
        show_completed: true,
    })?;
    assert_eq!(tagged.len(), 1);
    assert_eq!(tagged[0].id.as_str(), matched_task.id.as_str());

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

#[test]
fn generates_only_latest_due_recurring_occurrence_idempotently() -> RepositoryResult<()> {
    let database_path =
        std::env::temp_dir().join(format!("torder-recurring-test-{}.sqlite", Uuid::new_v4()));
    let database = Database::initialize(database_path.clone())?;
    let recurring = RecurringRuleRepository::new(&database);
    let rule = recurring.create(CreateRecurringRuleInput {
        source_task_id: None,
        title: "每日报表".to_owned(),
        note: Some("自动生成".to_owned()),
        priority: 2,
        list_id: "work".to_owned(),
        frequency: "daily".to_owned(),
        interval_count: 1,
        weekdays: vec![],
        month_day: None,
        first_due_at: "2024-01-01T09:00:00Z".to_owned(),
        timezone: "Asia/Shanghai".to_owned(),
        generate_ahead_minutes: 1440,
        remind_before: Some(60),
        end_at: None,
    })?;

    let now =
        chrono::DateTime::parse_from_rfc3339("2024-01-05T12:00:00Z")?.with_timezone(&chrono::Utc);
    assert_eq!(recurring.generate_due_at(now)?.generated_count, 1);
    assert_eq!(recurring.generate_due_at(now)?.generated_count, 0);

    let tasks =
        TaskRepository::new(&database).query(query_input("view", "all", None, "date", true))?;
    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0].due_at.as_deref(), Some("2024-01-06T09:00:00Z"));
    assert_eq!(
        tasks[0].recurring_rule_id.as_deref(),
        Some(rule.id.as_str())
    );
    assert_eq!(tasks[0].occurrence_at, tasks[0].due_at);

    let skipped = recurring.skip_next(&rule.id)?;
    assert_eq!(skipped.next_due_at.as_deref(), Some("2024-01-08T09:00:00Z"));
    let paused = recurring.set_enabled(&rule.id, false)?;
    assert!(!paused.enabled);
    assert_eq!(recurring.generate_due_at(now)?.generated_count, 0);

    drop(database);
    cleanup_database_files(&database_path);
    Ok(())
}

#[test]
fn ending_recurring_rule_records_terminal_sync_change() -> RepositoryResult<()> {
    let database_path = std::env::temp_dir().join(format!(
        "torder-recurring-terminal-{}.sqlite",
        Uuid::new_v4()
    ));
    let database = Database::initialize(database_path.clone())?;
    let recurring = RecurringRuleRepository::new(&database);
    let rule = recurring.create(CreateRecurringRuleInput {
        source_task_id: None,
        title: "一次性截止规则".to_owned(),
        note: None,
        priority: 1,
        list_id: "work".to_owned(),
        frequency: "daily".to_owned(),
        interval_count: 1,
        weekdays: vec![],
        month_day: None,
        first_due_at: "2024-01-01T09:00:00Z".to_owned(),
        timezone: "Asia/Shanghai".to_owned(),
        generate_ahead_minutes: 0,
        remind_before: None,
        end_at: Some("2024-01-01T09:00:00Z".to_owned()),
    })?;

    // 模拟旧数据/远端合并留下了超过 end_at 的游标，覆盖“未生成实例但需要终止规则”的分支。
    let connection = database.connect()?;
    connection.execute(
        "UPDATE recurring_rules SET next_due_at = '2024-01-02T09:00:00Z', enabled = 1 WHERE id = ?1",
        rusqlite::params![rule.id],
    )?;
    drop(connection);

    let now =
        chrono::DateTime::parse_from_rfc3339("2024-01-03T09:00:00Z")?.with_timezone(&chrono::Utc);
    assert_eq!(recurring.generate_due_at(now)?.generated_count, 0);
    let ended = recurring.get(&rule.id)?;
    assert!(ended.next_due_at.is_none());
    assert!(!ended.enabled);

    let connection = database.connect()?;
    let change: String = connection.query_row(
        "SELECT payload_json FROM sync_changes WHERE entity = 'recurringRule' AND object_id = ?1 ORDER BY revision DESC LIMIT 1",
        rusqlite::params![rule.id],
        |row| row.get(0),
    )?;
    let payload: serde_json::Value = serde_json::from_str(&change)?;
    assert_eq!(payload["id"], rule.id);
    assert!(payload["nextDueAt"].is_null());
    assert_eq!(payload["enabled"], false);

    drop(connection);
    drop(database);
    cleanup_database_files(&database_path);
    Ok(())
}

#[test]
fn linking_a_source_task_records_the_task_sync_change() -> RepositoryResult<()> {
    let database_path =
        std::env::temp_dir().join(format!("torder-recurring-link-{}.sqlite", Uuid::new_v4()));
    let database = Database::initialize(database_path.clone())?;
    let tasks = TaskRepository::new(&database);
    let source = tasks.create(task_input("来源任务", 1, None, Some("work"), 0))?;
    let recurring = RecurringRuleRepository::new(&database);

    recurring.create(CreateRecurringRuleInput {
        source_task_id: Some(source.id.clone()),
        title: "来源任务规则".to_owned(),
        note: None,
        priority: 1,
        list_id: "work".to_owned(),
        frequency: "daily".to_owned(),
        interval_count: 1,
        weekdays: vec![],
        month_day: None,
        first_due_at: "2026-08-21T09:00:00Z".to_owned(),
        timezone: "Asia/Shanghai".to_owned(),
        generate_ahead_minutes: 0,
        remind_before: None,
        end_at: None,
    })?;

    let connection = database.connect()?;
    let payload: String = connection.query_row(
        "SELECT payload_json FROM sync_changes WHERE entity = 'task' AND object_id = ?1 ORDER BY revision DESC LIMIT 1",
        rusqlite::params![source.id],
        |row| row.get(0),
    )?;
    let payload: serde_json::Value = serde_json::from_str(&payload)?;
    assert!(payload["recurringRuleId"].as_str().is_some());
    assert_eq!(payload["repeatRule"], serde_json::Value::Null);

    drop(connection);
    drop(database);
    cleanup_database_files(&database_path);
    Ok(())
}

/// 回归：编辑非排期字段不得倒回进度，删除实例后必须能重新生成。
#[test]
fn recurring_edits_preserve_progress_and_deleted_occurrences_regenerate() -> RepositoryResult<()> {
    let database_path =
        std::env::temp_dir().join(format!("torder-recurring-edit-{}.sqlite", Uuid::new_v4()));
    let database = Database::initialize(database_path.clone())?;
    let recurring = RecurringRuleRepository::new(&database);
    let tasks = TaskRepository::new(&database);

    let rule = recurring.create(CreateRecurringRuleInput {
        source_task_id: None,
        title: "每日站会".to_owned(),
        note: None,
        priority: 1,
        list_id: "work".to_owned(),
        frequency: "daily".to_owned(),
        interval_count: 1,
        weekdays: vec![],
        month_day: None,
        first_due_at: "2024-03-01T01:00:00Z".to_owned(),
        timezone: "Asia/Shanghai".to_owned(),
        generate_ahead_minutes: 0,
        remind_before: None,
        end_at: None,
    })?;

    // 先跳过两次，把进度推到 03-03。
    recurring.skip_next(&rule.id)?;
    let skipped = recurring.skip_next(&rule.id)?;
    assert_eq!(skipped.next_due_at.as_deref(), Some("2024-03-03T01:00:00Z"));

    // 只改标题/优先级/提醒，排期没动，进度必须原地保留。
    let renamed = recurring.update(UpdateRecurringRuleInput {
        id: rule.id.clone(),
        title: "每日站会（改名）".to_owned(),
        note: Some("换个说明".to_owned()),
        priority: 2,
        list_id: "personal".to_owned(),
        frequency: skipped.frequency.clone(),
        interval_count: skipped.interval_count,
        weekdays: skipped.weekdays.clone(),
        month_day: skipped.month_day,
        first_due_at: skipped.first_due_at.clone(),
        timezone: skipped.timezone.clone(),
        generate_ahead_minutes: 30,
        remind_before: Some(15),
        end_at: None,
    })?;
    assert_eq!(renamed.title, "每日站会（改名）");
    assert_eq!(
        renamed.next_due_at.as_deref(),
        Some("2024-03-03T01:00:00Z"),
        "改非排期字段不应该把 next_due_at 倒回 first_due_at"
    );

    // 真正改排期时才允许重排到新的首次到期时间。
    let rescheduled = recurring.update(UpdateRecurringRuleInput {
        id: rule.id.clone(),
        title: renamed.title.clone(),
        note: renamed.note.clone(),
        priority: renamed.priority,
        list_id: renamed.list_id.clone(),
        frequency: "daily".to_owned(),
        interval_count: 2,
        weekdays: vec![],
        month_day: None,
        first_due_at: "2024-03-10T01:00:00Z".to_owned(),
        timezone: renamed.timezone.clone(),
        generate_ahead_minutes: 0,
        remind_before: None,
        end_at: None,
    })?;
    assert_eq!(
        rescheduled.next_due_at.as_deref(),
        Some("2024-03-10T01:00:00Z"),
        "改了排期就应该按新的 first_due_at 重排"
    );

    // 生成一个实例，删掉它，然后把进度重排回同一时刻，必须能重新生成。
    let now =
        chrono::DateTime::parse_from_rfc3339("2024-03-10T02:00:00Z")?.with_timezone(&chrono::Utc);
    assert_eq!(recurring.generate_due_at(now)?.generated_count, 1);
    let generated = tasks.query(query_input("view", "all", None, "date", true))?;
    assert_eq!(generated.len(), 1);
    assert_eq!(
        generated[0].occurrence_at.as_deref(),
        Some("2024-03-10T01:00:00Z")
    );

    tasks.soft_delete(&generated[0].id)?;
    assert_eq!(
        tasks
            .query(query_input("view", "all", None, "date", true))?
            .len(),
        0
    );

    // 改排期把 next_due_at 重排回 2024-03-10，即刚被删掉的那个 occurrence。
    let replanned = recurring.update(UpdateRecurringRuleInput {
        id: rule.id.clone(),
        title: rescheduled.title.clone(),
        note: rescheduled.note.clone(),
        priority: rescheduled.priority,
        list_id: rescheduled.list_id.clone(),
        frequency: "daily".to_owned(),
        interval_count: 3,
        weekdays: vec![],
        month_day: None,
        first_due_at: "2024-03-10T01:00:00Z".to_owned(),
        timezone: rescheduled.timezone.clone(),
        generate_ahead_minutes: 0,
        remind_before: None,
        end_at: None,
    })?;
    assert_eq!(
        replanned.next_due_at.as_deref(),
        Some("2024-03-10T01:00:00Z")
    );

    assert_eq!(
        recurring.generate_due_at(now)?.generated_count,
        1,
        "软删除的实例不应该永久占用唯一索引，同一 occurrence 必须能重新生成"
    );
    let regenerated = tasks.query(query_input("view", "all", None, "date", true))?;
    assert_eq!(regenerated.len(), 1);
    assert_eq!(
        regenerated[0].occurrence_at.as_deref(),
        Some("2024-03-10T01:00:00Z")
    );

    drop(database);
    cleanup_database_files(&database_path);
    Ok(())
}

#[test]
fn calendar_events_support_multi_day_ranges_and_soft_delete() -> RepositoryResult<()> {
    let database_path =
        std::env::temp_dir().join(format!("torder-calendar-events-{}.sqlite", Uuid::new_v4()));
    let database = Database::initialize(database_path.clone())?;
    let repository = CalendarEventRepository::new(&database);

    let trip = repository.create(CreateCalendarEventInput {
        title: "  领导出差  ".to_owned(),
        event_type: "trip".to_owned(),
        start_date: "2026-08-17".to_owned(),
        end_date: "2026-08-21".to_owned(),
        note: Some("上海客户拜访".to_owned()),
    })?;
    assert_eq!(trip.title, "领导出差");
    assert_eq!(trip.start_date, "2026-08-17");
    assert_eq!(trip.end_date, "2026-08-21");

    let leave = repository.create(CreateCalendarEventInput {
        title: "领导休假".to_owned(),
        event_type: "leave".to_owned(),
        start_date: "2026-09-01".to_owned(),
        end_date: "2026-09-01".to_owned(),
        note: None,
    })?;
    assert_eq!(leave.event_type, "leave");

    let other = repository.create(CreateCalendarEventInput {
        title: "团队会议".to_owned(),
        event_type: "other".to_owned(),
        start_date: "2026-08-20".to_owned(),
        end_date: "2026-08-20".to_owned(),
        note: Some("会议室确认".to_owned()),
    })?;
    assert_eq!(other.event_type, "other");

    let listed = repository.list()?;
    assert_eq!(listed.len(), 3);
    assert_eq!(listed[0].id, trip.id, "list 应按 start_date 升序");

    let updated = repository.update(UpdateCalendarEventInput {
        id: trip.id.clone(),
        title: "领导出差（改期）".to_owned(),
        event_type: "trip".to_owned(),
        start_date: "2026-08-18".to_owned(),
        end_date: "2026-08-21".to_owned(),
        note: trip.note.clone(),
    })?;
    assert_eq!(updated.start_date, "2026-08-18");

    repository.soft_delete(&leave.id)?;
    assert!(matches!(
        repository.get(&leave.id),
        Err(RepositoryError::NotFound("calendar event"))
    ));
    assert_eq!(repository.list()?.len(), 2);

    assert!(matches!(
        repository.create(CreateCalendarEventInput {
            title: "区间倒置".to_owned(),
            event_type: "trip".to_owned(),
            start_date: "2026-08-21".to_owned(),
            end_date: "2026-08-17".to_owned(),
            note: None,
        }),
        Err(RepositoryError::Validation(_))
    ));
    assert!(matches!(
        repository.create(CreateCalendarEventInput {
            title: "非法类型".to_owned(),
            event_type: "meeting".to_owned(),
            start_date: "2026-08-17".to_owned(),
            end_date: "2026-08-17".to_owned(),
            note: None,
        }),
        Err(RepositoryError::Validation(_))
    ));

    drop(database);
    cleanup_database_files(&database_path);
    Ok(())
}

#[test]
fn clearing_sync_metadata_preserves_business_data() -> RepositoryResult<()> {
    let database_path =
        std::env::temp_dir().join(format!("torder-sync-cleanup-{}.sqlite", Uuid::new_v4()));
    let database = Database::initialize(database_path.clone())?;
    let task = TaskRepository::new(&database).create(task_input(
        "同步清理后仍保留",
        1,
        None,
        Some("work"),
        0,
    ))?;
    let mut connection = database.connect()?;
    connection.execute(
        "INSERT INTO sync_devices (id, name, created_at) VALUES ('device-1', '测试设备', '2026-08-21T00:00:00Z')",
        [],
    )?;
    connection.execute(
        "INSERT INTO sync_objects (entity, object_id, last_changed_at) VALUES ('calendarEvent', 'event-1', '2026-08-21T00:00:00Z')",
        [],
    )?;
    connection.execute(
        "INSERT INTO sync_changes (id, entity, object_id, operation, base_revision, revision, payload_json, created_at) VALUES ('change-1', 'task', ?1, 'upsert', 0, 1, '{}', '2026-08-21T00:00:00Z')",
        rusqlite::params![task.id],
    )?;
    connection.execute(
        "INSERT INTO sync_conflicts (id, entity, object_id, local_revision, remote_revision, local_payload_json, remote_payload_json, detected_at) VALUES ('conflict-1', 'task', ?1, 1, 2, '{}', '{}', '2026-08-21T00:00:00Z')",
        rusqlite::params![task.id],
    )?;

    sync_repository::clear_local_sync_data(&mut connection)?;
    assert_eq!(sync_repository::pending_count(&connection)?, 0);
    assert_eq!(
        connection.query_row("SELECT COUNT(*) FROM sync_devices", [], |row| row
            .get::<_, i64>(0))?,
        0
    );
    assert_eq!(
        connection.query_row("SELECT COUNT(*) FROM sync_objects", [], |row| row
            .get::<_, i64>(0))?,
        0
    );
    assert_eq!(
        connection.query_row("SELECT COUNT(*) FROM sync_conflicts", [], |row| row
            .get::<_, i64>(0))?,
        0
    );
    assert_eq!(
        TaskRepository::new(&database).get(&task.id)?.title,
        "同步清理后仍保留"
    );

    drop(connection);
    drop(database);
    cleanup_database_files(&database_path);
    Ok(())
}

#[test]
fn attachment_tables_exist_after_migration() -> RepositoryResult<()> {
    let database_path = std::env::temp_dir().join(format!(
        "torder-attachment-schema-{}.sqlite",
        Uuid::new_v4()
    ));
    let database = Database::initialize(database_path.clone())?;
    let connection = database.connect()?;

    for table in [
        "attachment_blobs",
        "task_attachments",
        "local_attachment_references",
    ] {
        let count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            rusqlite::params![table],
            |row| row.get(0),
        )?;
        assert_eq!(count, 1, "{table} should be created by migrations");
    }

    drop(connection);
    drop(database);
    cleanup_database_files(&database_path);
    Ok(())
}

#[test]
fn managed_attachment_copies_file_hashes_and_records_sync_changes() -> RepositoryResult<()> {
    let data_dir = attachment_test_data_dir("managed");
    std::fs::create_dir_all(&data_dir)?;
    let database_path = data_dir.join("torder.sqlite");
    let database = Database::initialize(database_path.clone())?;
    let task = TaskRepository::new(&database).create(task_input(
        "带附件任务",
        1,
        None,
        Some("work"),
        0,
    ))?;
    let source_path = data_dir.join("source-contract.txt");
    std::fs::write(&source_path, b"attachment payload")?;

    let repository = AttachmentRepository::new(&database);
    let attachment = repository.create_managed(
        &data_dir,
        torder_lib::models::CreateAttachmentInput {
            task_id: task.id.clone(),
            source_path: source_path.display().to_string(),
            display_name: Some(" 合同附件 ".to_owned()),
        },
    )?;

    assert_eq!(attachment.task_id, task.id);
    assert_eq!(attachment.kind, "managed");
    assert_eq!(attachment.display_name, "合同附件");
    assert_eq!(
        attachment.original_name.as_deref(),
        Some("source-contract.txt")
    );
    assert_eq!(attachment.sync_state.as_deref(), Some("pendingUpload"));
    let (source_hash, source_size) = sha256_file(&source_path)?;
    assert_eq!(
        attachment.content_sha256.as_deref(),
        Some(source_hash.as_str())
    );
    assert_eq!(attachment.size_bytes, Some(source_size));
    let copied_path = data_dir.join(
        attachment
            .local_relative_path
            .as_deref()
            .expect("managed attachment should store a relative path"),
    );
    assert!(copied_path.is_file());
    assert_eq!(sha256_file(&copied_path)?.0, source_hash);

    let connection = database.connect()?;
    let attachment_changes: i64 = connection.query_row(
        "SELECT COUNT(*) FROM sync_changes WHERE entity = 'attachment' AND object_id = ?1 AND operation = 'upsert'",
        rusqlite::params![attachment.id],
        |row| row.get(0),
    )?;
    assert_eq!(attachment_changes, 1);
    assert_eq!(repository.transfer_status()?.pending_upload, 1);
    drop(connection);

    repository.soft_delete(&attachment.id)?;
    assert!(repository.list_by_task(&data_dir, &task.id)?.is_empty());
    let delete_changes: i64 = database.connect()?.query_row(
        "SELECT COUNT(*) FROM sync_changes WHERE entity = 'attachment' AND object_id = ?1 AND operation = 'delete'",
        rusqlite::params![attachment.id],
        |row| row.get(0),
    )?;
    assert_eq!(delete_changes, 1);

    drop(database);
    cleanup_database_files(&database_path);
    cleanup_dir(&data_dir);
    Ok(())
}

#[test]
fn orphan_attachment_cleanup_removes_only_expired_unreferenced_blobs() -> RepositoryResult<()> {
    let data_dir = attachment_test_data_dir("cleanup");
    std::fs::create_dir_all(&data_dir)?;
    let database_path = data_dir.join("torder.sqlite");
    let database = Database::initialize(database_path.clone())?;
    let task = TaskRepository::new(&database).create(task_input(
        "附件清理任务",
        1,
        None,
        Some("work"),
        0,
    ))?;
    let live_source = data_dir.join("live.txt");
    let deleted_source = data_dir.join("deleted.txt");
    std::fs::write(&live_source, b"live attachment")?;
    std::fs::write(&deleted_source, b"deleted attachment")?;
    let repository = AttachmentRepository::new(&database);
    let live = repository.create_managed(
        &data_dir,
        torder_lib::models::CreateAttachmentInput {
            task_id: task.id.clone(),
            source_path: live_source.display().to_string(),
            display_name: None,
        },
    )?;
    let deleted = repository.create_managed(
        &data_dir,
        torder_lib::models::CreateAttachmentInput {
            task_id: task.id.clone(),
            source_path: deleted_source.display().to_string(),
            display_name: None,
        },
    )?;
    let live_path = data_dir.join(live.local_relative_path.as_deref().unwrap());
    let deleted_path = data_dir.join(deleted.local_relative_path.as_deref().unwrap());

    {
        let connection = database.connect()?;
        connection.execute(
            "UPDATE attachment_blobs SET sync_state = 'uploaded', updated_at = '2020-01-01T00:00:00Z' WHERE id IN (?1, ?2)",
            rusqlite::params![live.blob_id.as_deref(), deleted.blob_id.as_deref()],
        )?;
        connection.execute(
            "UPDATE sync_changes SET uploaded_at = '2020-01-01T00:00:00Z', remote_sequence = 1 WHERE entity = 'attachment'",
            [],
        )?;
    }
    repository.soft_delete(&deleted.id)?;
    {
        let connection = database.connect()?;
        connection.execute(
            "UPDATE task_attachments SET deleted_at = '2020-01-01T00:00:00Z', updated_at = '2020-01-01T00:00:00Z' WHERE id = ?1",
            rusqlite::params![deleted.id],
        )?;
        connection.execute(
            "UPDATE sync_changes SET uploaded_at = '2020-01-01T00:00:00Z', remote_sequence = 2 WHERE entity = 'attachment'",
            [],
        )?;
    }

    let diagnostics = repository.diagnostics()?;
    assert_eq!(diagnostics.managed_count, 1);
    let (removed_count, removed_bytes) = repository.cleanup_orphan_blobs(&data_dir, 30)?;

    assert_eq!(removed_count, 1);
    assert_eq!(removed_bytes, b"deleted attachment".len() as i64);
    assert!(live_path.is_file());
    assert!(!deleted_path.exists());
    let connection = database.connect()?;
    assert!(connection
        .query_row(
            "SELECT deleted_at FROM attachment_blobs WHERE id = ?1",
            rusqlite::params![deleted.blob_id.as_deref()],
            |row| row.get::<_, Option<String>>(0),
        )?
        .is_some());
    assert!(connection
        .query_row(
            "SELECT deleted_at FROM attachment_blobs WHERE id = ?1",
            rusqlite::params![live.blob_id.as_deref()],
            |row| row.get::<_, Option<String>>(0),
        )?
        .is_none());

    drop(connection);
    drop(database);
    cleanup_database_files(&database_path);
    cleanup_dir(&data_dir);
    Ok(())
}

#[test]
fn managed_attachment_rejects_missing_or_directory_sources() -> RepositoryResult<()> {
    let data_dir = attachment_test_data_dir("invalid-source");
    std::fs::create_dir_all(&data_dir)?;
    let database_path = data_dir.join("torder.sqlite");
    let database = Database::initialize(database_path.clone())?;
    let task = TaskRepository::new(&database).create(task_input(
        "附件校验任务",
        1,
        None,
        Some("work"),
        0,
    ))?;
    let repository = AttachmentRepository::new(&database);

    assert!(matches!(
        repository.create_managed(
            &data_dir,
            torder_lib::models::CreateAttachmentInput {
                task_id: task.id.clone(),
                source_path: data_dir.display().to_string(),
                display_name: None,
            },
        ),
        Err(RepositoryError::Validation(
            "attachment source must be a file"
        ))
    ));
    assert!(matches!(
        repository.create_managed(
            &data_dir,
            torder_lib::models::CreateAttachmentInput {
                task_id: task.id,
                source_path: data_dir.join("missing.txt").display().to_string(),
                display_name: None,
            },
        ),
        Err(RepositoryError::Io(_))
    ));

    drop(database);
    cleanup_database_files(&database_path);
    cleanup_dir(&data_dir);
    Ok(())
}

#[test]
fn local_reference_attachment_stays_local_and_does_not_record_sync_change() -> RepositoryResult<()>
{
    let data_dir = attachment_test_data_dir("local-ref");
    std::fs::create_dir_all(&data_dir)?;
    let database_path = data_dir.join("torder.sqlite");
    let database = Database::initialize(database_path.clone())?;
    let task = TaskRepository::new(&database).create(task_input(
        "本地引用任务",
        1,
        None,
        Some("work"),
        0,
    ))?;
    let source_path = data_dir.join("local-note.txt");
    std::fs::write(&source_path, b"local only")?;
    let before_changes = sync_repository::pending_count(&database.connect()?)?;

    let attachment = AttachmentRepository::new(&database).create_local_reference(
        torder_lib::models::CreateAttachmentInput {
            task_id: task.id.clone(),
            source_path: source_path.display().to_string(),
            display_name: None,
        },
    )?;

    assert_eq!(attachment.kind, "localReference");
    assert!(attachment.blob_id.is_none());
    let canonical_source = std::fs::canonicalize(&source_path)?;
    assert_eq!(
        attachment.local_path.as_deref(),
        Some(canonical_source.display().to_string().as_str())
    );
    let connection = database.connect()?;
    let blob_count: i64 =
        connection.query_row("SELECT COUNT(*) FROM attachment_blobs", [], |row| {
            row.get(0)
        })?;
    assert_eq!(blob_count, 0);
    assert_eq!(sync_repository::pending_count(&connection)?, before_changes);

    drop(connection);
    drop(database);
    cleanup_database_files(&database_path);
    cleanup_dir(&data_dir);
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
        scheduled_date: None,
        due_at: due_at.map(str::to_owned),
        sort_order: Some(sort_order),
        remind_before: None,
        repeat_rule: None,
        subtasks: None,
        tags: None,
    }
}

fn cleanup_database_files(database_path: &Path) {
    let _ = std::fs::remove_file(database_path);
    let _ = std::fs::remove_file(format!("{}-wal", database_path.display()));
    let _ = std::fs::remove_file(format!("{}-shm", database_path.display()));
}

fn attachment_test_data_dir(name: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!("torder-attachment-{name}-{}", Uuid::new_v4()))
}

fn cleanup_dir(path: &Path) {
    let _ = std::fs::remove_dir_all(path);
}
