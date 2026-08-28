use rusqlite::{params, Row};
use serde_json::json;
use uuid::Uuid;

use crate::error::{RepositoryError, RepositoryResult};
use crate::models::{CreateListInput, TaskList, UpdateListInput};

use super::{sync_repository, Database};

pub struct ListRepository<'database> {
    database: &'database Database,
}

impl<'database> ListRepository<'database> {
    pub fn new(database: &'database Database) -> Self {
        Self { database }
    }

    pub fn list(&self) -> RepositoryResult<Vec<TaskList>> {
        let connection = self.database.connect()?;
        let mut statement = connection.prepare(
            r#"
            SELECT id, name, color, sort_order, is_default, created_at, updated_at, deleted_at
            FROM lists WHERE deleted_at IS NULL
            ORDER BY sort_order ASC, created_at ASC
            "#,
        )?;
        let lists = statement
            .query_map([], map_list)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(lists)
    }

    pub fn create(&self, input: CreateListInput) -> RepositoryResult<TaskList> {
        let name = validate_name(&input.name)?;
        let id = Uuid::new_v4().to_string();
        let mut connection = self.database.connect()?;
        let transaction = connection.transaction()?;
        // 默认排到现有清单末尾（最大 sort_order + 1），与前端 mock 的默认值一致。
        let sort_order = match input.sort_order {
            Some(sort_order) => sort_order,
            None => transaction.query_row(
                "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM lists WHERE deleted_at IS NULL",
                [],
                |row| row.get::<_, i64>(0),
            )?,
        };
        transaction.execute(
            "INSERT INTO lists (id, name, color, sort_order) VALUES (?1, ?2, ?3, ?4)",
            params![id, name, input.color, sort_order],
        )?;
        sync_repository::record_change(
            &transaction,
            "list",
            &id,
            "upsert",
            json!({
                "id": id,
                "name": name,
                "color": input.color,
                "sortOrder": sort_order,
                "isDefault": false,
                "deletedAt": null,
            }),
        )?;
        transaction.commit()?;
        self.get(&id)
    }

    pub fn update(&self, input: UpdateListInput) -> RepositoryResult<TaskList> {
        let name = validate_name(&input.name)?;
        let mut connection = self.database.connect()?;
        let transaction = connection.transaction()?;
        let updated = transaction.execute(
            r#"
            UPDATE lists
            SET name = ?2, color = ?3, sort_order = ?4,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?1 AND deleted_at IS NULL
            "#,
            params![input.id, name, input.color, input.sort_order],
        )?;
        if updated == 0 {
            return Err(RepositoryError::NotFound("list"));
        }
        sync_repository::record_change(
            &transaction,
            "list",
            &input.id,
            "upsert",
            json!({
                "id": input.id,
                "name": name,
                "color": input.color,
                "sortOrder": input.sort_order,
            }),
        )?;
        transaction.commit()?;
        self.get(&input.id)
    }

    pub fn delete(&self, id: &str) -> RepositoryResult<()> {
        let list = self.get(id)?;
        if list.is_default {
            return Err(RepositoryError::Validation(
                "default lists cannot be deleted",
            ));
        }
        let mut connection = self.database.connect()?;
        let transaction = connection.transaction()?;
        let member_count: i64 = transaction.query_row(
            "SELECT COUNT(*) FROM tasks WHERE list_id = ?1 AND deleted_at IS NULL AND purged_at IS NULL",
            params![id],
            |row| row.get(0),
        )?;
        if member_count > 0 {
            return Err(RepositoryError::Validation(
                "list still contains tasks",
            ));
        }
        let deleted_at = chrono::Utc::now().to_rfc3339();
        let updated = transaction.execute(
            "UPDATE lists SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1 AND deleted_at IS NULL",
            params![id, deleted_at],
        )?;
        if updated == 0 {
            return Err(RepositoryError::NotFound("list"));
        }
        sync_repository::record_change(
            &transaction,
            "list",
            id,
            "delete",
            json!({ "id": id, "deletedAt": deleted_at }),
        )?;
        transaction.commit()?;
        Ok(())
    }

    fn get(&self, id: &str) -> RepositoryResult<TaskList> {
        let connection = self.database.connect()?;
        let result = connection.query_row(
            r#"
            SELECT id, name, color, sort_order, is_default, created_at, updated_at, deleted_at
            FROM lists WHERE id = ?1 AND deleted_at IS NULL
            "#,
            params![id],
            map_list,
        );
        match result {
            Ok(list) => Ok(list),
            Err(rusqlite::Error::QueryReturnedNoRows) => Err(RepositoryError::NotFound("list")),
            Err(error) => Err(error.into()),
        }
    }
}

fn map_list(row: &Row<'_>) -> rusqlite::Result<TaskList> {
    Ok(TaskList {
        id: row.get(0)?,
        name: row.get(1)?,
        color: row.get(2)?,
        sort_order: row.get(3)?,
        is_default: row.get::<_, i64>(4)? == 1,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
        deleted_at: row.get(7)?,
    })
}

fn validate_name(name: &str) -> RepositoryResult<String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(RepositoryError::Validation("list name cannot be empty"));
    }
    Ok(name.to_owned())
}
