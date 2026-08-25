use chrono::{SecondsFormat, Utc};
use rusqlite::{params, Row};
use serde_json::json;
use uuid::Uuid;

use crate::error::{RepositoryError, RepositoryResult};
use crate::models::{CreateTaskLinkInput, Task, TaskLink};

use super::task_repository::{map_task, select_tasks};
use super::{sync_repository, Database};

pub struct TaskLinkRepository<'database> {
    database: &'database Database,
}

impl<'database> TaskLinkRepository<'database> {
    pub fn new(database: &'database Database) -> Self {
        Self { database }
    }

    pub fn list_by_task(&self, task_id: &str) -> RepositoryResult<Vec<TaskLink>> {
        let task_id = validate_id(task_id, "task")?;
        let connection = self.database.connect()?;
        let mut statement = connection.prepare(&format!(
            "{} WHERE l.source_task_id = ?1
                  AND l.deleted_at IS NULL
                  AND target.id IS NOT NULL
                  AND target.deleted_at IS NULL
                  AND target.purged_at IS NULL
             ORDER BY l.sort_order ASC, l.created_at ASC",
            select_task_links()
        ))?;
        let links = statement
            .query_map(params![task_id], map_task_link)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(links)
    }

    pub fn create(&self, input: CreateTaskLinkInput) -> RepositoryResult<TaskLink> {
        let source_task_id = validate_id(&input.source_task_id, "source task")?;
        let target_task_id = validate_id(&input.target_task_id, "target task")?;
        if source_task_id == target_task_id {
            return Err(RepositoryError::Validation("task cannot reference itself"));
        }

        let link_id = Uuid::new_v4().to_string();
        let mut connection = self.database.connect()?;
        let transaction = connection.transaction()?;
        ensure_live_task(&transaction, &source_task_id, "source task")?;
        ensure_live_task(&transaction, &target_task_id, "target task")?;

        if let Some(existing) = existing_live_link(&transaction, &source_task_id, &target_task_id)?
        {
            return Ok(existing);
        }

        transaction.execute(
            r#"
            INSERT INTO task_links (
                id, source_task_id, target_task_id, relation_type, sort_order
            ) VALUES (
                ?1, ?2, ?3, 'reference',
                COALESCE((SELECT MAX(sort_order) + 1000 FROM task_links WHERE source_task_id = ?2), 0)
            )
            "#,
            params![link_id, source_task_id, target_task_id],
        )?;
        let link = query_link(&transaction, &link_id, true)?;
        record_task_link_change(&transaction, &link, "upsert")?;
        transaction.commit()?;
        self.get(&link_id)
    }

    pub fn get(&self, id: &str) -> RepositoryResult<TaskLink> {
        let connection = self.database.connect()?;
        let result = connection.query_row(
            &format!(
                "{} WHERE l.id = ?1 AND l.deleted_at IS NULL",
                select_task_links()
            ),
            params![id],
            map_task_link,
        );
        map_not_found(result, "task link")
    }

    pub fn soft_delete(&self, id: &str) -> RepositoryResult<()> {
        let id = validate_id(id, "task link")?;
        let now = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
        let mut connection = self.database.connect()?;
        let transaction = connection.transaction()?;
        let existing = query_link(&transaction, &id, true)?;
        let deleted = transaction.execute(
            r#"
            UPDATE task_links
            SET deleted_at = ?2, updated_at = ?2
            WHERE id = ?1 AND deleted_at IS NULL
            "#,
            params![id, now],
        )?;
        if deleted == 0 {
            return Err(RepositoryError::NotFound("task link"));
        }
        let mut changed = existing;
        changed.deleted_at = Some(now);
        changed.updated_at = changed.deleted_at.clone().unwrap_or(changed.updated_at);
        record_task_link_change(&transaction, &changed, "delete")?;
        transaction.commit()?;
        Ok(())
    }

    pub fn search_linkable_tasks(
        &self,
        source_task_id: &str,
        query: Option<String>,
        limit: i64,
    ) -> RepositoryResult<Vec<Task>> {
        let source_task_id = validate_id(source_task_id, "source task")?;
        let query = query.unwrap_or_default().trim().to_owned();
        let pattern = format!("%{}%", escape_like(&query));
        let connection = self.database.connect()?;
        let sql = format!(
            "{} WHERE id <> ?1
                  AND deleted_at IS NULL
                  AND purged_at IS NULL
                  AND status != 'archived'
                  AND NOT EXISTS (
                    SELECT 1 FROM task_links AS link
                    WHERE link.source_task_id = ?1
                      AND link.target_task_id = tasks.id
                      AND link.deleted_at IS NULL
                  )
                  AND (?2 = '' OR title LIKE ?3 ESCAPE '\\' OR COALESCE(note, '') LIKE ?3 ESCAPE '\\')
             ORDER BY updated_at DESC, created_at DESC
             LIMIT ?4",
            select_tasks()
        );
        let mut statement = connection.prepare(&sql)?;
        let tasks = statement
            .query_map(
                params![source_task_id, query, pattern, limit.clamp(1, 20)],
                map_task,
            )?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(tasks)
    }
}

pub(crate) fn task_link_sync_payload(link: &TaskLink) -> serde_json::Value {
    json!({
        "id": link.id,
        "sourceTaskId": link.source_task_id,
        "targetTaskId": link.target_task_id,
        "relationType": link.relation_type,
        "sortOrder": link.sort_order,
        "createdAt": link.created_at,
        "updatedAt": link.updated_at,
        "deletedAt": link.deleted_at,
    })
}

fn select_task_links() -> &'static str {
    r#"
    SELECT l.id, l.source_task_id, l.target_task_id, l.relation_type, l.sort_order,
           target.title, target.status, target.list_id, target.scheduled_date, target.due_at,
           l.created_at, l.updated_at, l.deleted_at
    FROM task_links AS l
    LEFT JOIN tasks AS target ON target.id = l.target_task_id
    "#
}

fn map_task_link(row: &Row<'_>) -> rusqlite::Result<TaskLink> {
    Ok(TaskLink {
        id: row.get(0)?,
        source_task_id: row.get(1)?,
        target_task_id: row.get(2)?,
        relation_type: row.get(3)?,
        sort_order: row.get(4)?,
        target_title: row.get(5)?,
        target_status: row.get(6)?,
        target_list_id: row.get(7)?,
        target_scheduled_date: row.get(8)?,
        target_due_at: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
        deleted_at: row.get(12)?,
    })
}

fn existing_live_link(
    transaction: &rusqlite::Transaction<'_>,
    source_task_id: &str,
    target_task_id: &str,
) -> RepositoryResult<Option<TaskLink>> {
    let result = transaction.query_row(
        &format!(
            "{} WHERE l.source_task_id = ?1
                  AND l.target_task_id = ?2
                  AND l.relation_type = 'reference'
                  AND l.deleted_at IS NULL",
            select_task_links()
        ),
        params![source_task_id, target_task_id],
        map_task_link,
    );
    match result {
        Ok(link) => Ok(Some(link)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn query_link(
    transaction: &rusqlite::Transaction<'_>,
    id: &str,
    include_deleted: bool,
) -> RepositoryResult<TaskLink> {
    let deleted_clause = if include_deleted {
        ""
    } else {
        " AND l.deleted_at IS NULL"
    };
    map_not_found(
        transaction.query_row(
            &format!("{} WHERE l.id = ?1{deleted_clause}", select_task_links()),
            params![id],
            map_task_link,
        ),
        "task link",
    )
}

fn ensure_live_task(
    transaction: &rusqlite::Transaction<'_>,
    id: &str,
    label: &'static str,
) -> RepositoryResult<()> {
    let exists: i64 = transaction.query_row(
        "SELECT COUNT(*) FROM tasks WHERE id = ?1 AND deleted_at IS NULL AND purged_at IS NULL",
        params![id],
        |row| row.get(0),
    )?;
    if exists == 0 {
        return Err(RepositoryError::NotFound(label));
    }
    Ok(())
}

fn record_task_link_change(
    transaction: &rusqlite::Transaction<'_>,
    link: &TaskLink,
    operation: &str,
) -> RepositoryResult<()> {
    sync_repository::record_change(
        transaction,
        "taskLink",
        &link.id,
        operation,
        task_link_sync_payload(link),
    )
}

fn validate_id(value: &str, label: &'static str) -> RepositoryResult<String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 128 {
        return Err(RepositoryError::Validation(match label {
            "source task" => "invalid source task id",
            "target task" => "invalid target task id",
            _ => "invalid task link id",
        }));
    }
    Ok(value.to_owned())
}

fn escape_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
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
