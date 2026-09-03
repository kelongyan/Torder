#![allow(clippy::items_after_test_module)]

use chrono::{SecondsFormat, Utc};
use rusqlite::types::{Type, Value};
use rusqlite::{params, params_from_iter, Row};
use serde_json::json;
use uuid::Uuid;

use crate::error::{RepositoryError, RepositoryResult};
use crate::models::{CreateTaskInput, Task, TaskQueryInput, TaskSubtask, UpdateTaskInput};

use super::{sync_repository, Database};

pub struct TaskRepository<'database> {
    database: &'database Database,
}

impl<'database> TaskRepository<'database> {
    pub fn new(database: &'database Database) -> Self {
        Self { database }
    }

    pub fn create(&self, input: CreateTaskInput) -> RepositoryResult<Task> {
        let title = validate_title(&input.title)?;
        let priority = input.priority.unwrap_or(1);
        validate_priority(priority)?;
        let id = Uuid::new_v4().to_string();
        let list_id = input.list_id.unwrap_or_else(|| "work".to_owned());
        let scheduled_date = normalize_scheduled_date(input.scheduled_date)?;
        let remind_at = compute_remind_at(input.due_at.as_deref(), input.remind_before);
        let subtasks = normalize_subtasks(input.subtasks.unwrap_or_default())?;
        let subtasks_json = serde_json::to_string(&subtasks)?;
        let tags = normalize_tags(input.tags.unwrap_or_default());
        let tags_json = serde_json::to_string(&tags)?;
        let mut connection = self.database.connect()?;
        let transaction = connection.transaction()?;

        transaction.execute(
            r#"
            INSERT INTO tasks (
                id, title, note, priority, list_id, scheduled_date, due_at,
                sort_order, remind_before, remind_at, repeat_rule, subtasks, tags
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
            "#,
            params![
                id,
                title,
                input.note,
                priority,
                list_id,
                scheduled_date,
                input.due_at,
                input.sort_order.unwrap_or(0),
                input.remind_before,
                remind_at,
                input.repeat_rule,
                subtasks_json,
                tags_json,
            ],
        )?;
        sync_repository::record_change(
            &transaction,
            "task",
            &id,
            "upsert",
            json!({
                "id": id,
                "title": title,
                "note": input.note,
                "status": "todo",
                "priority": priority,
                "listId": list_id,
                "scheduledDate": scheduled_date,
                "dueAt": input.due_at,
                "sortOrder": input.sort_order.unwrap_or(0),
                "remindBefore": input.remind_before,
                "remindAt": remind_at,
                "remindedAt": null,
                "repeatRule": input.repeat_rule,
                "subtasks": subtasks,
                "tags": tags,
                "recurringRuleId": null,
                "occurrenceAt": null,
                "completedAt": null,
                "deletedAt": null,
            }),
        )?;
        transaction.commit()?;

        self.get(&id)
    }

    pub fn get(&self, id: &str) -> RepositoryResult<Task> {
        let connection = self.database.connect()?;
        let result = connection.query_row(
            &format!(
                "{} WHERE id = ?1 AND deleted_at IS NULL AND purged_at IS NULL",
                select_tasks()
            ),
            params![id],
            map_task,
        );
        map_not_found(result, "task")
    }

    pub fn export_all(&self) -> RepositoryResult<Vec<Task>> {
        let connection = self.database.connect()?;
        let mut statement = connection.prepare(&format!(
            "{} WHERE purged_at IS NULL ORDER BY list_id, sort_order, created_at",
            select_tasks()
        ))?;
        let tasks = statement
            .query_map(params![], map_task)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(tasks)
    }

    pub fn query(&self, input: TaskQueryInput) -> RepositoryResult<Vec<Task>> {
        let deleted_view = input.scope_kind == "view" && input.scope_value == "deleted";
        let mut clauses = if deleted_view {
            // 回收站视图：只列出软删除的任务，其余视图一律排除已删除。
            vec![
                "t.deleted_at IS NOT NULL".to_owned(),
                "t.purged_at IS NULL".to_owned(),
            ]
        } else {
            vec![
                "t.deleted_at IS NULL".to_owned(),
                "t.purged_at IS NULL".to_owned(),
                "t.status != 'archived'".to_owned(),
            ]
        };
        let mut values = Vec::<Value>::new();

        match input.scope_kind.as_str() {
            "view" => push_view_scope(
                &mut clauses,
                input.scope_value.as_str(),
                input.show_completed,
            )?,
            "list" => {
                if input.scope_value.trim().is_empty() {
                    return Err(RepositoryError::Validation("list scope cannot be empty"));
                }
                clauses.push("t.list_id = ?".to_owned());
                values.push(Value::Text(input.scope_value));
                if !input.show_completed {
                    clauses.push("t.status != 'done'".to_owned());
                }
            }
            _ => return Err(RepositoryError::Validation("invalid task scope")),
        }

        if let Some(query) = input.query.map(|query| query.trim().to_owned()) {
            if !query.is_empty() {
                let parsed = parse_search_query(&query);
                if let Some(text) = parsed.text {
                    let pattern = format!("%{}%", escape_like(&text));
                    clauses.push(
                        r#"
                        (
                            t.title LIKE ? ESCAPE '\'
                            OR COALESCE(t.note, '') LIKE ? ESCAPE '\'
                        )
                        "#
                        .to_owned(),
                    );
                    values.push(Value::Text(pattern.clone()));
                    values.push(Value::Text(pattern));
                }
                if let Some(priority) = parsed.priority {
                    clauses.push("t.priority = ?".to_owned());
                    values.push(Value::Integer(priority));
                }
                if let Some(list_name) = parsed.list_name {
                    clauses.push(
                        "t.list_id IN (SELECT id FROM lists WHERE name = ? COLLATE NOCASE)"
                            .to_owned(),
                    );
                    values.push(Value::Text(list_name));
                }
                if let Some(tag_name) = parsed.tag_name {
                    clauses.push(
                        r#"
                        EXISTS (
                            SELECT 1 FROM json_each(t.tags)
                            WHERE json_each.value = ? COLLATE NOCASE
                        )
                        "#
                        .to_owned(),
                    );
                    values.push(Value::Text(tag_name));
                }
                match parsed.due {
                    Some(DueFilter::Today) => clauses.push(
                        "t.status = 'todo' AND COALESCE(t.scheduled_date, date(t.due_at, 'localtime')) = date('now', 'localtime')"
                            .to_owned(),
                    ),
                    Some(DueFilter::Overdue) => clauses.push(
                        "t.status = 'todo' AND t.due_at IS NOT NULL AND date(t.due_at, 'localtime') < date('now', 'localtime')"
                            .to_owned(),
                    ),
                    Some(DueFilter::None) => clauses.push("t.due_at IS NULL".to_owned()),
                    None => {}
                }
            }
        }

        let order = sort_clause(input.sort_by.as_deref().unwrap_or("priority"))?;
        let sql = format!(
            "{} WHERE {} ORDER BY {order}",
            select_tasks_aliased(),
            clauses.join(" AND ")
        );
        let connection = self.database.connect()?;
        let mut statement = connection.prepare(&sql)?;
        let tasks = statement
            .query_map(params_from_iter(values.iter()), map_task)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(tasks)
    }

    /// 桌面小窗专用查询：只返回指定日期对应的任务。
    /// 配合前端的 `taskPlanDateKey === dateKey` 过滤，少量行直接消费，
    /// 避免通用 query 在 view="all" 时拉全表的浪费。
    /// 排序语义与前端 `taskService.ts::compareWidgetTasks` 保持一致：
    /// 有日期（`scheduled_date` 或 `date(due_at)`）的任务在前、按日期升序，
    /// 无日期的在后；同组内 priority DESC，最后 created_at DESC。
    pub fn query_for_widget(
        &self,
        date_key: &str,
        include_completed: bool,
    ) -> RepositoryResult<Vec<Task>> {
        let date_key = date_key.trim();
        if date_key.is_empty() {
            return Err(RepositoryError::Validation("date_key cannot be empty"));
        }
        let mut clauses = vec![
            "t.deleted_at IS NULL".to_owned(),
            "t.purged_at IS NULL".to_owned(),
            "t.status != 'archived'".to_owned(),
            "COALESCE(t.scheduled_date, date(t.due_at, 'localtime')) = ?".to_owned(),
        ];
        if !include_completed {
            clauses.push("t.status != 'done'".to_owned());
        }
        let sql = format!(
            "{} WHERE {} ORDER BY \
                CASE WHEN COALESCE(t.scheduled_date, date(t.due_at, 'localtime')) IS NULL THEN 1 ELSE 0 END ASC, \
                COALESCE(t.scheduled_date, date(t.due_at, 'localtime')) ASC, \
                t.priority DESC, \
                t.created_at DESC",
            select_tasks_aliased(),
            clauses.join(" AND "),
        );
        let connection = self.database.connect()?;
        let mut statement = connection.prepare(&sql)?;
        let tasks = statement
            .query_map(params![date_key], map_task)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(tasks)
    }

    pub fn update(&self, input: UpdateTaskInput) -> RepositoryResult<Task> {
        let title = validate_title(&input.title)?;
        validate_status(&input.status)?;
        validate_priority(input.priority)?;
        let scheduled_date = normalize_scheduled_date(input.scheduled_date)?;
        let remind_at = compute_remind_at(input.due_at.as_deref(), input.remind_before);
        let subtasks = normalize_subtasks(input.subtasks)?;
        let subtasks_json = serde_json::to_string(&subtasks)?;
        let tags = normalize_tags(input.tags);
        let tags_json = serde_json::to_string(&tags)?;
        let mut connection = self.database.connect()?;
        let transaction = connection.transaction()?;
        let updated = transaction.execute(
            r#"
            UPDATE tasks
            SET title = ?2,
                note = ?3,
                status = ?4,
                priority = ?5,
                list_id = ?6,
                scheduled_date = ?7,
                due_at = ?8,
                completed_at = CASE
                    WHEN ?4 = 'done' AND completed_at IS NULL
                        THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                    WHEN ?4 != 'done' THEN NULL
                    ELSE completed_at
                END,
                sort_order = ?9,
                remind_before = ?10,
                remind_at = ?11,
                repeat_rule = ?12,
                subtasks = ?13,
                tags = ?14,
                reminded_at = CASE
                    WHEN ?8 IS NOT due_at OR ?10 IS NOT remind_before THEN NULL
                    ELSE reminded_at
                END,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?1 AND deleted_at IS NULL AND purged_at IS NULL
            "#,
            params![
                input.id,
                title,
                input.note,
                input.status,
                input.priority,
                input.list_id,
                scheduled_date,
                input.due_at,
                input.sort_order,
                input.remind_before,
                remind_at,
                input.repeat_rule,
                subtasks_json,
                tags_json,
            ],
        )?;

        if updated == 0 {
            return Err(RepositoryError::NotFound("task"));
        }
        let changed_task = transaction.query_row(
            &format!("{} WHERE id = ?1", select_tasks()),
            params![input.id],
            map_task,
        )?;
        sync_repository::record_change(
            &transaction,
            "task",
            &input.id,
            "upsert",
            serde_json::to_value(changed_task)?,
        )?;
        transaction.commit()?;

        self.get(&input.id)
    }

    pub fn snooze_reminder(&self, id: &str, remind_at: &str) -> RepositoryResult<Task> {
        chrono::DateTime::parse_from_rfc3339(remind_at)?;
        let mut connection = self.database.connect()?;
        let transaction = connection.transaction()?;
        let updated = transaction.execute(
            r#"
            UPDATE tasks
            SET remind_at = ?2,
                reminded_at = NULL,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?1 AND deleted_at IS NULL AND purged_at IS NULL
            "#,
            params![id, remind_at],
        )?;
        if updated == 0 {
            return Err(RepositoryError::NotFound("task"));
        }
        let changed_task = transaction.query_row(
            &format!("{} WHERE id = ?1", select_tasks()),
            params![id],
            map_task,
        )?;
        sync_repository::record_change(
            &transaction,
            "task",
            id,
            "upsert",
            serde_json::to_value(changed_task)?,
        )?;
        transaction.commit()?;

        self.get(id)
    }

    pub fn soft_delete(&self, id: &str) -> RepositoryResult<()> {
        let now = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
        let mut connection = self.database.connect()?;
        let transaction = connection.transaction()?;
        let deleted = transaction.execute(
            r#"
            UPDATE tasks
            SET deleted_at = ?2,
                updated_at = ?2
            WHERE id = ?1 AND deleted_at IS NULL AND purged_at IS NULL
            "#,
            params![id, now],
        )?;

        if deleted == 0 {
            return Err(RepositoryError::NotFound("task"));
        }
        let changed_task = transaction.query_row(
            &format!("{} WHERE id = ?1", select_tasks()),
            params![id],
            map_task,
        )?;
        sync_repository::record_change(
            &transaction,
            "task",
            id,
            "delete",
            serde_json::to_value(changed_task)?,
        )?;
        transaction.commit()?;

        Ok(())
    }

    pub fn set_completed(&self, id: &str, completed: bool) -> RepositoryResult<Task> {
        let mut connection = self.database.connect()?;
        let transaction = connection.transaction()?;
        let status = if completed { "done" } else { "todo" };
        let updated = transaction.execute(
            r#"
            UPDATE tasks
            SET status = ?2,
                completed_at = CASE
                    WHEN ?2 = 'done' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                    ELSE NULL
                END,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?1 AND deleted_at IS NULL AND purged_at IS NULL
            "#,
            params![id, status],
        )?;
        if updated == 0 {
            return Err(RepositoryError::NotFound("task"));
        }
        let changed_task = transaction.query_row(
            &format!("{} WHERE id = ?1", select_tasks()),
            params![id],
            map_task,
        )?;
        sync_repository::record_change(
            &transaction,
            "task",
            id,
            "upsert",
            serde_json::to_value(changed_task)?,
        )?;
        transaction.commit()?;

        self.get(id)
    }

    /// 从回收站恢复任务：清空删除时间戳。
    pub fn restore(&self, id: &str) -> RepositoryResult<Task> {
        let mut connection = self.database.connect()?;
        let transaction = connection.transaction()?;
        let updated = transaction.execute(
            r#"
            UPDATE tasks
            SET deleted_at = NULL,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?1 AND deleted_at IS NOT NULL AND purged_at IS NULL
            "#,
            params![id],
        )?;
        if updated == 0 {
            return Err(RepositoryError::NotFound("task"));
        }
        let changed_task = transaction.query_row(
            &format!("{} WHERE id = ?1", select_tasks()),
            params![id],
            map_task,
        )?;
        sync_repository::record_change(
            &transaction,
            "task",
            id,
            "upsert",
            serde_json::to_value(changed_task)?,
        )?;
        transaction.commit()?;

        self.get(id)
    }

    /// 从回收站中永久隐藏任务。业务行保留为同步 tombstone，避免快照构建时丢失 payload。
    pub fn permanent_delete(&self, id: &str) -> RepositoryResult<()> {
        let now = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
        let mut connection = self.database.connect()?;
        let transaction = connection.transaction()?;
        let updated = transaction.execute(
            r#"
            UPDATE tasks
            SET purged_at = ?2,
                updated_at = ?2
            WHERE id = ?1
              AND deleted_at IS NOT NULL
              AND purged_at IS NULL
            "#,
            params![id, now],
        )?;
        if updated == 0 {
            return Err(RepositoryError::NotFound("task"));
        }
        let changed_task = transaction.query_row(
            &format!("{} WHERE id = ?1", select_tasks()),
            params![id],
            map_task,
        )?;
        sync_repository::record_change(
            &transaction,
            "task",
            id,
            "delete",
            serde_json::to_value(changed_task)?,
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn empty_trash(&self) -> RepositoryResult<i64> {
        let ids = self.trash_ids_before(None)?;
        self.mark_purged(ids)
    }

    pub fn cleanup_trash(&self, retention_days: i64) -> RepositoryResult<i64> {
        if retention_days < 0 {
            return Err(RepositoryError::Validation(
                "trash retention days cannot be negative",
            ));
        }
        let threshold = Utc::now() - chrono::Duration::days(retention_days);
        let threshold = threshold.to_rfc3339_opts(SecondsFormat::Millis, true);
        let ids = self.trash_ids_before(Some(threshold.as_str()))?;
        self.mark_purged(ids)
    }

    fn trash_ids_before(&self, deleted_before: Option<&str>) -> RepositoryResult<Vec<String>> {
        let connection = self.database.connect()?;
        match deleted_before {
            Some(value) => {
                let mut statement = connection.prepare(
                    r#"
                    SELECT id FROM tasks
                    WHERE deleted_at IS NOT NULL
                      AND purged_at IS NULL
                      AND deleted_at <= ?1
                    ORDER BY deleted_at ASC
                    "#,
                )?;
                let rows = statement.query_map(params![value], |row| row.get::<_, String>(0))?;
                Ok(rows.collect::<Result<Vec<_>, _>>()?)
            }
            None => {
                let mut statement = connection.prepare(
                    r#"
                    SELECT id FROM tasks
                    WHERE deleted_at IS NOT NULL
                      AND purged_at IS NULL
                    ORDER BY deleted_at ASC
                    "#,
                )?;
                let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
                Ok(rows.collect::<Result<Vec<_>, _>>()?)
            }
        }
    }

    fn mark_purged(&self, ids: Vec<String>) -> RepositoryResult<i64> {
        if ids.is_empty() {
            return Ok(0);
        }
        let now = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
        let mut connection = self.database.connect()?;
        let transaction = connection.transaction()?;
        let mut count = 0_i64;
        for id in ids {
            let updated = transaction.execute(
                r#"
                UPDATE tasks
                SET purged_at = ?2,
                    updated_at = ?2
                WHERE id = ?1
                  AND deleted_at IS NOT NULL
                  AND purged_at IS NULL
                "#,
                params![id, now],
            )?;
            if updated == 0 {
                continue;
            }
            let changed_task = transaction.query_row(
                &format!("{} WHERE id = ?1", select_tasks()),
                params![id],
                map_task,
            )?;
            sync_repository::record_change(
                &transaction,
                "task",
                &id,
                "delete",
                serde_json::to_value(changed_task)?,
            )?;
            count += 1;
        }
        transaction.commit()?;
        Ok(count)
    }
}

fn push_view_scope(
    clauses: &mut Vec<String>,
    view: &str,
    show_completed: bool,
) -> RepositoryResult<()> {
    match view {
        "all" => {
            if !show_completed {
                clauses.push("t.status != 'done'".to_owned());
            }
        }
        "today" => clauses.push(
            r#"
            t.status = 'todo'
            AND COALESCE(t.scheduled_date, date(t.due_at, 'localtime')) = date('now', 'localtime')
            "#
            .to_owned(),
        ),
        "planned" => clauses.push(
            "t.status = 'todo' AND (t.scheduled_date IS NOT NULL OR t.due_at IS NOT NULL)"
                .to_owned(),
        ),
        "overdue" => clauses.push(
            r#"
            t.status = 'todo'
            AND t.due_at IS NOT NULL
            AND date(t.due_at, 'localtime') < date('now', 'localtime')
            "#
            .to_owned(),
        ),
        "no-date" => clauses.push("t.status = 'todo' AND t.due_at IS NULL".to_owned()),
        "important" => clauses.push("t.status = 'todo' AND t.priority = 2".to_owned()),
        "completed" => clauses.push("t.status = 'done'".to_owned()),
        // 回收站视图的过滤条件已在 query() 里按 deleted_view 处理，这里不再追加。
        "deleted" => {}
        _ => return Err(RepositoryError::Validation("invalid task view")),
    }
    Ok(())
}

/// tasks 表列名唯一清单：select_tasks / select_tasks_aliased 共用，
/// 新增任务列只改此处，两查询自动同步（防字段遗漏漂移）。
const TASK_COLUMNS: &[&str] = &[
    "id",
    "title",
    "note",
    "status",
    "priority",
    "list_id",
    "scheduled_date",
    "due_at",
    "completed_at",
    "sort_order",
    "remind_before",
    "remind_at",
    "reminded_at",
    "repeat_rule",
    "subtasks",
    "tags",
    "recurring_rule_id",
    "occurrence_at",
    "created_at",
    "updated_at",
    "deleted_at",
];

pub(crate) fn select_tasks() -> String {
    format!("SELECT {} FROM tasks", TASK_COLUMNS.join(", "))
}

fn select_tasks_aliased() -> String {
    let columns = TASK_COLUMNS
        .iter()
        .map(|column| format!("t.{column}"))
        .collect::<Vec<_>>()
        .join(", ");
    format!("SELECT {columns} FROM tasks t")
}

fn sort_clause(sort_by: &str) -> RepositoryResult<&'static str> {
    match sort_by {
        "priority" => Ok(r#"
            t.priority DESC,
            CASE WHEN COALESCE(t.scheduled_date, date(t.due_at, 'localtime')) IS NULL THEN 1 ELSE 0 END ASC,
            COALESCE(t.scheduled_date, date(t.due_at, 'localtime')) ASC,
            t.due_at ASC,
            t.created_at DESC
            "#),
        "date" => Ok(r#"
            CASE WHEN COALESCE(t.scheduled_date, date(t.due_at, 'localtime')) IS NULL THEN 1 ELSE 0 END ASC,
            COALESCE(t.scheduled_date, date(t.due_at, 'localtime')) ASC,
            t.due_at ASC,
            t.priority DESC,
            t.created_at DESC
            "#),
        "created" => Ok("t.created_at ASC"),
        "manual" => Ok("t.sort_order ASC, t.created_at ASC"),
        _ => Err(RepositoryError::Validation("invalid task sort")),
    }
}

fn escape_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

/// 前缀指令搜索：`p:2` / `l:工作` / `due:今天` / `due:过期` / `due:无`。
/// 其余文本作为标题/备注的全文匹配。指令以空格分隔，指令写法不合法时
/// 整段按原文匹配（宽松处理，不打断已有搜索习惯）。
struct ParsedSearchQuery {
    text: Option<String>,
    priority: Option<i64>,
    list_name: Option<String>,
    tag_name: Option<String>,
    due: Option<DueFilter>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DueFilter {
    Today,
    Overdue,
    None,
}

fn parse_search_query(query: &str) -> ParsedSearchQuery {
    let mut text_parts: Vec<&str> = Vec::new();
    let mut priority: Option<i64> = None;
    let mut list_name: Option<String> = None;
    let mut tag_name: Option<String> = None;
    let mut due: Option<DueFilter> = None;

    for token in query.split_whitespace() {
        if let Some(value) = token.strip_prefix("p:") {
            if let Ok(number) = value.parse::<i64>() {
                if (0..=2).contains(&number) {
                    priority = Some(number);
                    continue;
                }
            }
        }
        if let Some(value) = token.strip_prefix("l:") {
            let name = value.trim();
            if !name.is_empty() {
                list_name = Some(name.to_owned());
                continue;
            }
        }
        if let Some(value) = token.strip_prefix("tag:") {
            let name = value.trim().trim_start_matches('#');
            if !name.is_empty() {
                tag_name = Some(name.to_owned());
                continue;
            }
        }
        if let Some(value) = token.strip_prefix("due:") {
            let filter = match value {
                "今天" | "today" => Some(DueFilter::Today),
                "过期" | "overdue" => Some(DueFilter::Overdue),
                "无" | "none" => Some(DueFilter::None),
                _ => None,
            };
            if let Some(filter) = filter {
                due = Some(filter);
                continue;
            }
        }
        text_parts.push(token);
    }

    let text = if text_parts.is_empty() {
        None
    } else {
        Some(text_parts.join(" "))
    };
    ParsedSearchQuery {
        text,
        priority,
        list_name,
        tag_name,
        due,
    }
}

#[cfg(test)]
mod search_query_tests {
    use super::*;

    #[test]
    fn parses_priority_and_list_and_due_directives() {
        let parsed = parse_search_query("p:2 l:工作 due:今天");
        assert_eq!(parsed.text, None);
        assert_eq!(parsed.priority, Some(2));
        assert_eq!(parsed.list_name.as_deref(), Some("工作"));
        assert_eq!(parsed.due, Some(DueFilter::Today));
    }

    #[test]
    fn keeps_remaining_text_as_fulltext() {
        let parsed = parse_search_query("提交报告 p:1");
        assert_eq!(parsed.text.as_deref(), Some("提交报告"));
        assert_eq!(parsed.priority, Some(1));
        assert_eq!(parsed.list_name, None);
        assert_eq!(parsed.due, None);
    }

    #[test]
    fn invalid_directives_fall_back_to_fulltext() {
        let parsed = parse_search_query("p:9 due:明天");
        assert_eq!(parsed.text.as_deref(), Some("p:9 due:明天"));
        assert_eq!(parsed.priority, None);
        assert_eq!(parsed.due, None);
    }

    #[test]
    fn due_none_maps_to_null_due_filter() {
        let parsed = parse_search_query("due:无");
        assert_eq!(parsed.due, Some(DueFilter::None));
    }
}

/// P2-03：列清单防漂移守卫 —— TASK_COLUMNS 必须与 tasks 表实际列一致
/// （map_task 按 select 位置索引读列，列清单顺序变更会静默错位）。
#[cfg(test)]
mod column_guard_tests {
    use super::*;
    use crate::db::migrations;
    use rusqlite::Connection;

    #[test]
    fn select_columns_match_actual_table_columns() {
        let mut connection = Connection::open_in_memory().unwrap();
        migrations::apply_migrations(&mut connection).unwrap();
        let mut actual: Vec<String> = connection
            .prepare("PRAGMA table_info(tasks)")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        // purged_at 只作清理标记，不进业务投影。
        actual.retain(|column| column != "purged_at");

        let mut listed = TASK_COLUMNS.to_vec();
        listed.sort();
        actual.sort();
        assert_eq!(listed, actual, "TASK_COLUMNS 与 tasks 表实际列发生漂移");
    }

    #[test]
    fn select_variants_share_the_single_column_list() {
        let plain = select_tasks();
        let aliased = select_tasks_aliased();
        let plain_projection = &plain[..plain.find("FROM").unwrap()];
        let aliased_projection = &aliased[..aliased.find("FROM").unwrap()];
        assert_eq!(plain_projection.split(',').count(), TASK_COLUMNS.len());
        assert_eq!(aliased_projection.split(',').count(), TASK_COLUMNS.len());
    }
}

pub(crate) fn map_task(row: &Row<'_>) -> rusqlite::Result<Task> {
    let subtasks_json: String = row.get(14)?;
    let tags_json: String = row.get(15)?;
    Ok(Task {
        id: row.get(0)?,
        title: row.get(1)?,
        note: row.get(2)?,
        status: row.get(3)?,
        priority: row.get(4)?,
        list_id: row.get(5)?,
        scheduled_date: row.get(6)?,
        due_at: row.get(7)?,
        completed_at: row.get(8)?,
        sort_order: row.get(9)?,
        remind_before: row.get(10)?,
        remind_at: row.get(11)?,
        reminded_at: row.get(12)?,
        repeat_rule: row.get(13)?,
        subtasks: parse_subtasks_column(subtasks_json, 14)?,
        tags: parse_tags_column(tags_json, 15)?,
        recurring_rule_id: row.get(16)?,
        occurrence_at: row.get(17)?,
        created_at: row.get(18)?,
        updated_at: row.get(19)?,
        deleted_at: row.get(20)?,
    })
}

fn parse_subtasks_column(value: String, index: usize) -> rusqlite::Result<Vec<TaskSubtask>> {
    serde_json::from_str(&value).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(index, Type::Text, Box::new(error))
    })
}

fn parse_tags_column(value: String, index: usize) -> rusqlite::Result<Vec<String>> {
    serde_json::from_str(&value).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(index, Type::Text, Box::new(error))
    })
}

fn normalize_subtasks(mut subtasks: Vec<TaskSubtask>) -> RepositoryResult<Vec<TaskSubtask>> {
    if subtasks.len() > 100 {
        return Err(RepositoryError::Validation("too many subtasks"));
    }
    for (index, subtask) in subtasks.iter_mut().enumerate() {
        subtask.id = subtask.id.trim().to_owned();
        if subtask.id.is_empty() {
            subtask.id = Uuid::new_v4().to_string();
        }
        subtask.title = subtask.title.trim().to_owned();
        if subtask.title.is_empty() || subtask.title.len() > 512 {
            return Err(RepositoryError::Validation("invalid subtask title"));
        }
        chrono::DateTime::parse_from_rfc3339(&subtask.created_at)?;
        if let Some(completed_at) = subtask.completed_at.as_deref() {
            chrono::DateTime::parse_from_rfc3339(completed_at)?;
        }
        subtask.sort_order = index as i64;
    }
    Ok(subtasks)
}

fn normalize_tags(tags: Vec<String>) -> Vec<String> {
    let mut normalized: Vec<String> = Vec::new();
    for tag in tags {
        let tag = tag.trim().trim_start_matches('#').to_owned();
        if tag.is_empty() || tag.len() > 40 {
            continue;
        }
        if normalized
            .iter()
            .any(|item| item.eq_ignore_ascii_case(&tag))
        {
            continue;
        }
        normalized.push(tag);
        if normalized.len() >= 30 {
            break;
        }
    }
    normalized
}

fn normalize_scheduled_date(value: Option<String>) -> RepositoryResult<Option<String>> {
    let Some(value) = value.map(|item| item.trim().to_owned()) else {
        return Ok(None);
    };
    if value.is_empty() {
        return Ok(None);
    }
    chrono::NaiveDate::parse_from_str(&value, "%Y-%m-%d")
        .map_err(|_| RepositoryError::Validation("invalid scheduled date"))?;
    Ok(Some(value))
}

/// Compute `remind_at` from `due_at` and `remind_before` (in minutes).
/// Returns `None` if `due_at` is missing, or if the computed time is in the past.
fn compute_remind_at(due_at: Option<&str>, remind_before: Option<i64>) -> Option<String> {
    let due_at = due_at?;
    let minutes = remind_before?;
    if minutes <= 0 {
        return Some(due_at.to_owned());
    }
    offset_rfc3339(due_at, -minutes)
}

/// Offset an RFC 3339 timestamp by ±minutes.
fn offset_rfc3339(rfc3339: &str, offset_minutes: i64) -> Option<String> {
    let date = chrono::DateTime::parse_from_rfc3339(rfc3339).ok()?;
    let result = date + chrono::Duration::minutes(offset_minutes);
    (result.with_timezone(&chrono::Utc) > chrono::Utc::now()).then(|| {
        result
            .with_timezone(&chrono::Utc)
            .to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
    })
}

fn validate_title(title: &str) -> RepositoryResult<String> {
    let title = title.trim();
    if title.is_empty() {
        return Err(RepositoryError::Validation("task title cannot be empty"));
    }
    Ok(title.to_owned())
}

fn validate_status(status: &str) -> RepositoryResult<()> {
    if !matches!(status, "todo" | "done" | "archived") {
        return Err(RepositoryError::Validation("invalid task status"));
    }
    Ok(())
}

fn validate_priority(priority: i64) -> RepositoryResult<()> {
    if !(0..=2).contains(&priority) {
        return Err(RepositoryError::Validation(
            "priority must be between 0 and 2",
        ));
    }
    Ok(())
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

/// 标签管理（T-07 二期）变更类型。
#[derive(Debug, Clone, PartialEq)]
pub enum TagChange {
    Rename { from: String, to: String },
    Merge { from: String, to: String },
    Remove { from: String },
}

/// 对单个任务的 tags 应用变更（纯函数，便于单测与边界校验）：
/// - 标签为文本；变换结果去重、保持原顺序；
/// - rename/merge 的目标若与任务已有标签重复 → 只保留一份；
/// - 空标签/超长（>40 字节，与 sync validate 同口径）一律不允许进入结果。
pub(crate) fn rewrite_task_tags(tags: &[String], change: &TagChange) -> Vec<String> {
    let (from, to) = match change {
        TagChange::Remove { from } => (from.as_str(), None),
        TagChange::Rename { from, to } | TagChange::Merge { from, to } => {
            (from.as_str(), Some(to.as_str()))
        }
    };
    let mut out: Vec<String> = Vec::with_capacity(tags.len());
    for tag in tags {
        if tag == from {
            if let Some(target) = to {
                if !out.iter().any(|existing| existing == target) && valid_tag_length(target) {
                    out.push(target.to_string());
                }
            }
            continue;
        }
        if tag.is_empty() || !valid_tag_length(tag) || out.iter().any(|item| item == tag) {
            continue;
        }
        out.push(tag.clone());
    }
    out
}

fn valid_tag_length(tag: &str) -> bool {
    !tag.is_empty() && tag.len() <= 40
}

impl TaskRepository<'_> {
    /// 全表应用标签变更（Rename/Merge/Remove），返回实际受影响的任务数。
    /// 每行在事务内读-改-写；tags 无法解析为字符串数组的行跳过不报错
    /// （脏数据不扩散）；结果恒满足 sync 的 validate_task_tags 约束。
    pub fn apply_tag_change(&self, change: &TagChange) -> RepositoryResult<usize> {
        use rusqlite::TransactionBehavior;

        let mut connection = self.database.connect()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(RepositoryError::from)?;

        let rows: Vec<(String, String)> = {
            let mut statement = transaction
                .prepare("SELECT id, tags FROM tasks")
                .map_err(RepositoryError::from)?;
            let mapped = statement
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(RepositoryError::from)?;
            mapped
                .collect::<Result<_, _>>()
                .map_err(RepositoryError::from)?
        };

        let mut affected = 0usize;
        for (id, tags_json) in rows {
            let parsed: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
            let rewritten = rewrite_task_tags(&parsed, change);
            if rewritten == parsed {
                continue;
            }
            transaction
                .execute(
                    "UPDATE tasks SET tags = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?2",
                    rusqlite::params![
                        serde_json::to_string(&rewritten).unwrap_or_else(|_| "[]".to_string()),
                        id
                    ],
                )
                .map_err(RepositoryError::from)?;
            affected += 1;
        }
        transaction.commit().map_err(RepositoryError::from)?;
        Ok(affected)
    }
}

#[cfg(test)]
mod tag_change_tests {
    use super::*;

    fn tags(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| item.to_string()).collect()
    }

    #[test]
    fn rename_replaces_and_dedupes() {
        let change = TagChange::Rename {
            from: "a".to_string(),
            to: "c".to_string(),
        };
        assert_eq!(
            rewrite_task_tags(&tags(&["a", "b"]), &change),
            tags(&["c", "b"])
        );
        // 已含目标 c → 不重复
        assert_eq!(
            rewrite_task_tags(&tags(&["a", "c", "b"]), &change),
            tags(&["c", "b"])
        );
        // 不含 from → 原样
        assert_eq!(
            rewrite_task_tags(&tags(&["x", "y"]), &change),
            tags(&["x", "y"])
        );
    }

    #[test]
    fn merge_keeps_target_once() {
        let change = TagChange::Merge {
            from: "b".to_string(),
            to: "c".to_string(),
        };
        assert_eq!(
            rewrite_task_tags(&tags(&["a", "b", "c"]), &change),
            tags(&["a", "c"])
        );
        assert_eq!(rewrite_task_tags(&tags(&["b"]), &change), tags(&["c"]));
    }

    #[test]
    fn remove_strips_tag() {
        let change = TagChange::Remove {
            from: "a".to_string(),
        };
        assert_eq!(rewrite_task_tags(&tags(&["a", "b"]), &change), tags(&["b"]));
        assert_eq!(rewrite_task_tags(&tags(&["b"]), &change), tags(&["b"]));
    }

    #[test]
    fn never_emits_empty_or_oversized_tags() {
        let change = TagChange::Rename {
            from: "a".to_string(),
            to: "超长标签超长标签超长标签超长标签超长标签超长标签超长".to_string(),
        };
        assert_eq!(
            rewrite_task_tags(&tags(&["a", "b", ""]), &change),
            tags(&["b"])
        );
    }
}
