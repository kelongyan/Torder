use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, Row};
use uuid::Uuid;

use crate::error::{RepositoryError, RepositoryResult};
use crate::models::{CreateTaskInput, Task, TaskQueryInput, UpdateTaskInput};

use super::Database;

pub struct TaskRepository<'database> {
    database: &'database Database,
}

impl<'database> TaskRepository<'database> {
    pub fn new(database: &'database Database) -> Self {
        Self { database }
    }

    pub fn create(&self, input: CreateTaskInput) -> RepositoryResult<Task> {
        let title = validate_title(&input.title)?;
        let priority = input.priority.unwrap_or(0);
        validate_priority(priority)?;
        let id = Uuid::new_v4().to_string();
        let list_id = input.list_id.unwrap_or_else(|| "inbox".to_owned());
        let connection = self.database.connect()?;

        connection.execute(
            r#"
            INSERT INTO tasks (
                id, title, note, priority, list_id, due_at, remind_at, sort_order
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            "#,
            params![
                id,
                title,
                input.note,
                priority,
                list_id,
                input.due_at,
                input.remind_at,
                input.sort_order.unwrap_or(0)
            ],
        )?;

        self.get(&id)
    }

    pub fn get(&self, id: &str) -> RepositoryResult<Task> {
        let connection = self.database.connect()?;
        let result = connection.query_row(
            &format!("{} WHERE id = ?1 AND deleted_at IS NULL", select_tasks()),
            params![id],
            map_task,
        );
        map_not_found(result, "task")
    }

    pub fn list_all_todo(&self) -> RepositoryResult<Vec<Task>> {
        self.query_tasks("status = 'todo' AND deleted_at IS NULL", default_sort())
    }

    pub fn list_today(&self) -> RepositoryResult<Vec<Task>> {
        self.query_tasks(
            r#"
            status = 'todo'
            AND deleted_at IS NULL
            AND due_at IS NOT NULL
            AND (
                datetime(due_at) < datetime('now')
                OR date(due_at, 'localtime') = date('now', 'localtime')
            )
            "#,
            default_sort(),
        )
    }

    pub fn list_completed(&self) -> RepositoryResult<Vec<Task>> {
        self.query_tasks(
            "status = 'done' AND deleted_at IS NULL",
            "completed_at DESC, created_at DESC",
        )
    }

    pub fn list_overdue(&self) -> RepositoryResult<Vec<Task>> {
        self.query_tasks(
            r#"
            status = 'todo'
            AND deleted_at IS NULL
            AND due_at IS NOT NULL
            AND datetime(due_at) < datetime('now')
            "#,
            default_sort(),
        )
    }

    pub fn query(&self, input: TaskQueryInput) -> RepositoryResult<Vec<Task>> {
        let mut clauses = vec!["t.deleted_at IS NULL".to_owned()];
        let mut values = Vec::<Value>::new();

        match input.view.as_str() {
            "today" => clauses.push(
                r#"
                t.status = 'todo'
                AND t.due_at IS NOT NULL
                AND (
                    datetime(t.due_at) < datetime('now')
                    OR date(t.due_at, 'localtime') = date('now', 'localtime')
                )
                "#
                .to_owned(),
            ),
            "all" => clauses.push("t.status = 'todo'".to_owned()),
            "completed" => clauses.push("t.status = 'done'".to_owned()),
            "overdue" => clauses.push(
                r#"
                t.status = 'todo'
                AND t.due_at IS NOT NULL
                AND datetime(t.due_at) < datetime('now')
                "#
                .to_owned(),
            ),
            _ => return Err(RepositoryError::Validation("invalid task view")),
        }

        if let Some(query) = input.query.map(|query| query.trim().to_owned()) {
            if !query.is_empty() {
                let pattern = format!("%{}%", escape_like(&query));
                clauses.push(
                    r#"
                    (
                        t.title LIKE ? ESCAPE '\'
                        OR COALESCE(t.note, '') LIKE ? ESCAPE '\'
                        OR EXISTS (
                            SELECT 1 FROM lists list_search
                            WHERE list_search.id = t.list_id
                              AND list_search.name LIKE ? ESCAPE '\'
                        )
                        OR EXISTS (
                            SELECT 1
                            FROM task_tags task_tag_search
                            JOIN tags tag_search ON tag_search.id = task_tag_search.tag_id
                            WHERE task_tag_search.task_id = t.id
                              AND tag_search.name LIKE ? ESCAPE '\'
                        )
                    )
                    "#
                    .to_owned(),
                );
                for _ in 0..4 {
                    values.push(Value::Text(pattern.clone()));
                }
            }
        }

        if let Some(date_filter) = input.date_filter.as_deref() {
            let date_clause = match date_filter {
                "today" => {
                    "t.due_at IS NOT NULL AND date(t.due_at, 'localtime') = date('now', 'localtime')"
                }
                "overdue" => {
                    "t.due_at IS NOT NULL AND datetime(t.due_at) < datetime('now')"
                }
                "next7" => {
                    r#"
                    t.due_at IS NOT NULL
                    AND date(t.due_at, 'localtime') >= date('now', 'localtime')
                    AND date(t.due_at, 'localtime') < date('now', 'localtime', '+7 days')
                    "#
                }
                "none" => "t.due_at IS NULL",
                _ => return Err(RepositoryError::Validation("invalid date filter")),
            };
            clauses.push(date_clause.to_owned());
        }

        if !input.priorities.is_empty() {
            for priority in &input.priorities {
                validate_priority(*priority)?;
            }
            clauses.push(format!(
                "t.priority IN ({})",
                placeholders(input.priorities.len())
            ));
            values.extend(input.priorities.into_iter().map(Value::Integer));
        }

        if !input.list_ids.is_empty() {
            clauses.push(format!(
                "t.list_id IN ({})",
                placeholders(input.list_ids.len())
            ));
            values.extend(input.list_ids.into_iter().map(Value::Text));
        }

        if !input.tag_ids.is_empty() {
            clauses.push(format!(
                r#"
                EXISTS (
                    SELECT 1 FROM task_tags task_tag_filter
                    WHERE task_tag_filter.task_id = t.id
                      AND task_tag_filter.tag_id IN ({})
                )
                "#,
                placeholders(input.tag_ids.len())
            ));
            values.extend(input.tag_ids.into_iter().map(Value::Text));
        }

        let order = if input.view == "completed" {
            "t.completed_at DESC, t.created_at DESC"
        } else {
            default_sort_aliased()
        };
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

    pub fn update(&self, input: UpdateTaskInput) -> RepositoryResult<Task> {
        let title = validate_title(&input.title)?;
        validate_status(&input.status)?;
        validate_priority(input.priority)?;
        let connection = self.database.connect()?;
        let updated = connection.execute(
            r#"
            UPDATE tasks
            SET title = ?2,
                note = ?3,
                status = ?4,
                priority = ?5,
                list_id = ?6,
                due_at = ?7,
                remind_at = ?8,
                reminded_at = CASE WHEN remind_at IS NOT ?8 THEN NULL ELSE reminded_at END,
                completed_at = CASE
                    WHEN ?4 = 'done' AND completed_at IS NULL
                        THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                    WHEN ?4 != 'done' THEN NULL
                    ELSE completed_at
                END,
                sort_order = ?9,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?1 AND deleted_at IS NULL
            "#,
            params![
                input.id,
                title,
                input.note,
                input.status,
                input.priority,
                input.list_id,
                input.due_at,
                input.remind_at,
                input.sort_order
            ],
        )?;

        if updated == 0 {
            return Err(RepositoryError::NotFound("task"));
        }

        self.get(&input.id)
    }

    pub fn soft_delete(&self, id: &str) -> RepositoryResult<()> {
        let connection = self.database.connect()?;
        let deleted = connection.execute(
            r#"
            UPDATE tasks
            SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?1 AND deleted_at IS NULL
            "#,
            params![id],
        )?;

        if deleted == 0 {
            return Err(RepositoryError::NotFound("task"));
        }

        Ok(())
    }

    pub fn set_completed(&self, id: &str, completed: bool) -> RepositoryResult<Task> {
        let connection = self.database.connect()?;
        let status = if completed { "done" } else { "todo" };
        let updated = connection.execute(
            r#"
            UPDATE tasks
            SET status = ?2,
                completed_at = CASE
                    WHEN ?2 = 'done' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                    ELSE NULL
                END,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?1 AND deleted_at IS NULL
            "#,
            params![id, status],
        )?;
        if updated == 0 {
            return Err(RepositoryError::NotFound("task"));
        }
        self.get(id)
    }

    pub fn list_due_reminders(&self) -> RepositoryResult<Vec<Task>> {
        self.query_tasks(
            r#"
            status = 'todo'
            AND deleted_at IS NULL
            AND remind_at IS NOT NULL
            AND reminded_at IS NULL
            AND datetime(remind_at) <= datetime('now')
            "#,
            "remind_at ASC, created_at ASC",
        )
    }

    pub fn mark_reminded(&self, id: &str) -> RepositoryResult<Task> {
        let connection = self.database.connect()?;
        let updated = connection.execute(
            r#"
            UPDATE tasks
            SET reminded_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?1
              AND status = 'todo'
              AND deleted_at IS NULL
              AND remind_at IS NOT NULL
              AND reminded_at IS NULL
            "#,
            params![id],
        )?;
        if updated == 0 {
            return Err(RepositoryError::NotFound("pending reminder"));
        }
        self.get(id)
    }

    pub fn snooze_reminder(&self, id: &str, minutes: i64) -> RepositoryResult<Task> {
        if !(1..=1440).contains(&minutes) {
            return Err(RepositoryError::Validation(
                "snooze minutes must be between 1 and 1440",
            ));
        }
        let modifier = format!("+{minutes} minutes");
        let connection = self.database.connect()?;
        let updated = connection.execute(
            r#"
            UPDATE tasks
            SET remind_at = strftime('%Y-%m-%dT%H:%M:%fZ', datetime('now', ?2)),
                reminded_at = NULL,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?1 AND status = 'todo' AND deleted_at IS NULL
            "#,
            params![id, modifier],
        )?;
        if updated == 0 {
            return Err(RepositoryError::NotFound("task"));
        }
        self.get(id)
    }

    pub fn set_tags(&self, task_id: &str, tag_ids: &[String]) -> RepositoryResult<()> {
        self.get(task_id)?;
        let mut connection = self.database.connect()?;
        let transaction = connection.transaction()?;
        transaction.execute("DELETE FROM task_tags WHERE task_id = ?1", params![task_id])?;
        for tag_id in tag_ids {
            transaction.execute(
                "INSERT INTO task_tags (task_id, tag_id) VALUES (?1, ?2)",
                params![task_id, tag_id],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn list_tag_ids(&self, task_id: &str) -> RepositoryResult<Vec<String>> {
        let connection = self.database.connect()?;
        let mut statement = connection
            .prepare("SELECT tag_id FROM task_tags WHERE task_id = ?1 ORDER BY tag_id ASC")?;
        let tag_ids = statement
            .query_map(params![task_id], |row| row.get(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(tag_ids)
    }

    fn query_tasks(&self, filter: &str, order: &str) -> RepositoryResult<Vec<Task>> {
        let connection = self.database.connect()?;
        let mut statement = connection.prepare(&format!(
            "{} WHERE {filter} ORDER BY {order}",
            select_tasks()
        ))?;
        let tasks = statement
            .query_map([], map_task)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(tasks)
    }
}

fn select_tasks() -> &'static str {
    r#"
    SELECT id, title, note, status, priority, list_id, due_at, remind_at,
           reminded_at, completed_at, sort_order, created_at, updated_at, deleted_at
    FROM tasks
    "#
}

fn select_tasks_aliased() -> &'static str {
    r#"
    SELECT t.id, t.title, t.note, t.status, t.priority, t.list_id, t.due_at, t.remind_at,
           t.reminded_at, t.completed_at, t.sort_order, t.created_at, t.updated_at, t.deleted_at
    FROM tasks t
    "#
}

fn default_sort() -> &'static str {
    r#"
    CASE
        WHEN due_at IS NOT NULL AND datetime(due_at) < datetime('now') THEN 0
        WHEN due_at IS NOT NULL AND date(due_at, 'localtime') = date('now', 'localtime') THEN 1
        WHEN remind_at IS NOT NULL THEN 2
        WHEN priority = 2 THEN 3
        ELSE 4
    END ASC,
    priority DESC,
    sort_order ASC,
    created_at DESC
    "#
}

fn default_sort_aliased() -> &'static str {
    r#"
    CASE
        WHEN t.due_at IS NOT NULL AND datetime(t.due_at) < datetime('now') THEN 0
        WHEN t.due_at IS NOT NULL AND date(t.due_at, 'localtime') = date('now', 'localtime') THEN 1
        WHEN t.remind_at IS NOT NULL THEN 2
        WHEN t.priority = 2 THEN 3
        ELSE 4
    END ASC,
    t.priority DESC,
    t.sort_order ASC,
    t.created_at DESC
    "#
}

fn placeholders(count: usize) -> String {
    std::iter::repeat_n("?", count)
        .collect::<Vec<_>>()
        .join(", ")
}

fn escape_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
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
