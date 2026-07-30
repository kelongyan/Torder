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
        let remind_at = compute_remind_at(input.due_at.as_deref(), input.remind_before);
        let connection = self.database.connect()?;

        connection.execute(
            r#"
            INSERT INTO tasks (
                id, title, note, priority, list_id, due_at, sort_order,
                remind_before, remind_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            "#,
            params![
                id,
                title,
                input.note,
                priority,
                list_id,
                input.due_at,
                input.sort_order.unwrap_or(0),
                input.remind_before,
                remind_at,
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
        let remind_at = compute_remind_at(input.due_at.as_deref(), input.remind_before);
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
                remind_before = ?9,
                remind_at = ?10,
                reminded_at = CASE
                    WHEN ?7 IS NOT NULL AND ?7 != due_at THEN NULL
                    ELSE reminded_at
                END,
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
                input.sort_order,
                input.remind_before,
                remind_at,
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
           completed_at, sort_order, remind_before, remind_at, reminded_at,
           created_at, updated_at, deleted_at
    FROM tasks
    "#
}

fn select_tasks_aliased() -> &'static str {
    r#"
    SELECT t.id, t.title, t.note, t.status, t.priority, t.list_id, t.due_at,
           t.completed_at, t.sort_order, t.remind_before, t.remind_at, t.reminded_at,
           t.created_at, t.updated_at, t.deleted_at
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
        remind_before: row.get(9)?,
        remind_at: row.get(10)?,
        reminded_at: row.get(11)?,
        created_at: row.get(12)?,
        updated_at: row.get(13)?,
        deleted_at: row.get(14)?,
    })
}

/// Compute `remind_at` from `due_at` and `remind_before` (in minutes).
/// Returns `None` if `due_at` is missing, or if the computed time is in the past.
fn compute_remind_at(due_at: Option<&str>, remind_before: Option<i64>) -> Option<String> {
    let due_at = due_at?;
    let minutes = remind_before.unwrap_or(1440); // default 1 day (24h)
    if minutes <= 0 {
        return Some(due_at.to_owned());
    }
    offset_rfc3339(due_at, -minutes)
}

/// Offset an RFC 3339 timestamp by ±minutes.
fn offset_rfc3339(rfc3339: &str, offset_minutes: i64) -> Option<String> {
    // Parse "2024-03-15T14:30:00Z" or "2024-03-15T14:30:00.123Z"
    let rest = rfc3339.strip_suffix('Z')?;
    let (date_part, time_part) = rest.split_once('T')?;
    let time_clean = time_part.split('.').next().unwrap_or(time_part);

    let (year_str, month_str, day_str) = split_date(date_part)?;
    let (hour_str, minute_str, second_str) = split_time(time_clean)?;

    let year = year_str.parse::<i64>().ok()?;
    let month = month_str.parse::<i64>().ok()?;
    let day = day_str.parse::<i64>().ok()?;
    let hour = hour_str.parse::<i64>().ok()?;
    let minute = minute_str.parse::<i64>().ok()?;
    let second = second_str.parse::<i64>().ok()?;

    // Convert to total minutes since epoch (approximately)
    let total = to_epoch_minutes(year, month, day, hour, minute) + offset_minutes;

    // Check if the result is in the past
    let now_approx = to_epoch_minutes_approx();
    if total <= now_approx {
        return None;
    }

    let (nyear, nmonth, nday, nhour, nminute) = from_epoch_minutes(total);
    format_date_time(nyear, nmonth, nday, nhour, nminute, second)
}

fn split_date(s: &str) -> Option<(&str, &str, &str)> {
    let mut parts = s.split('-');
    Some((parts.next()?, parts.next()?, parts.next()?))
}

fn split_time(s: &str) -> Option<(&str, &str, &str)> {
    let mut parts = s.split(':');
    Some((parts.next()?, parts.next()?, parts.next()?))
}

fn is_leap(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

fn days_in_month(year: i64, month: i64) -> i64 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if is_leap(year) {
                29
            } else {
                28
            }
        }
        _ => 30,
    }
}

fn to_epoch_minutes(year: i64, month: i64, day: i64, hour: i64, minute: i64) -> i64 {
    // Approximate: count days from 1970-01-01
    let mut days = 0;
    for y in 1970..year {
        days += if is_leap(y) { 366 } else { 365 };
    }
    for m in 1..month {
        days += days_in_month(year, m);
    }
    days += day - 1;
    days * 1440 + hour * 60 + minute
}

fn to_epoch_minutes_approx() -> i64 {
    // Rough current time using std::time — not perfect but good enough for the guard.
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    (now.as_secs() / 60) as i64
}

fn from_epoch_minutes(total: i64) -> (i64, i64, i64, i64, i64) {
    let mut remaining = total;
    let minute = remaining.rem_euclid(60);
    remaining /= 60;
    let hour = remaining.rem_euclid(24);
    remaining /= 24;

    let mut year = 1970;
    loop {
        let days = if is_leap(year) { 366 } else { 365 };
        if remaining < days {
            break;
        }
        remaining -= days;
        year += 1;
    }
    let mut month = 1;
    loop {
        let dim = days_in_month(year, month);
        if remaining < dim {
            break;
        }
        remaining -= dim;
        month += 1;
    }
    let day = remaining + 1;
    (year, month, day, hour, minute)
}

fn format_date_time(year: i64, month: i64, day: i64, hour: i64, minute: i64, second: i64) -> Option<String> {
    Some(format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        year, month, day, hour, minute, second
    ))
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
