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
        let priority = input.priority.unwrap_or(1);
        validate_priority(priority)?;
        let id = Uuid::new_v4().to_string();
        let list_id = input.list_id.unwrap_or_else(|| "work".to_owned());
        let connection = self.database.connect()?;

        connection.execute(
            r#"
            INSERT INTO tasks (
                id, title, note, priority, list_id, due_at, sort_order
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            "#,
            params![
                id,
                title,
                input.note,
                priority,
                list_id,
                input.due_at,
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

    pub fn query(&self, input: TaskQueryInput) -> RepositoryResult<Vec<Task>> {
        let mut clauses = vec![
            "t.deleted_at IS NULL".to_owned(),
            "t.status != 'archived'".to_owned(),
        ];
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
                let pattern = format!("%{}%", escape_like(&query));
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
                completed_at = CASE
                    WHEN ?4 = 'done' AND completed_at IS NULL
                        THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                    WHEN ?4 != 'done' THEN NULL
                    ELSE completed_at
                END,
                sort_order = ?8,
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
            AND t.due_at IS NOT NULL
            AND date(t.due_at, 'localtime') = date('now', 'localtime')
            "#
            .to_owned(),
        ),
        "planned" => clauses.push("t.status = 'todo' AND t.due_at IS NOT NULL".to_owned()),
        "important" => clauses.push("t.status = 'todo' AND t.priority = 2".to_owned()),
        "completed" => clauses.push("t.status = 'done'".to_owned()),
        _ => return Err(RepositoryError::Validation("invalid task view")),
    }
    Ok(())
}

fn select_tasks() -> &'static str {
    r#"
    SELECT id, title, note, status, priority, list_id, due_at,
           completed_at, sort_order, created_at, updated_at, deleted_at
    FROM tasks
    "#
}

fn select_tasks_aliased() -> &'static str {
    r#"
    SELECT t.id, t.title, t.note, t.status, t.priority, t.list_id, t.due_at,
           t.completed_at, t.sort_order, t.created_at, t.updated_at, t.deleted_at
    FROM tasks t
    "#
}

fn sort_clause(sort_by: &str) -> RepositoryResult<&'static str> {
    match sort_by {
        "priority" => Ok(r#"
            t.priority DESC,
            CASE WHEN t.due_at IS NULL THEN 1 ELSE 0 END ASC,
            t.due_at ASC,
            t.created_at DESC
            "#),
        "date" => Ok(r#"
            CASE WHEN t.due_at IS NULL THEN 1 ELSE 0 END ASC,
            t.due_at ASC,
            t.priority DESC,
            t.created_at DESC
            "#),
        "created" => Ok("t.created_at ASC"),
        _ => Err(RepositoryError::Validation("invalid task sort")),
    }
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
        completed_at: row.get(7)?,
        sort_order: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
        deleted_at: row.get(11)?,
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
