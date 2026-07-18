use rusqlite::{params, Row};
use uuid::Uuid;

use crate::error::{RepositoryError, RepositoryResult};
use crate::models::{CreateListInput, TaskList, UpdateListInput};

use super::Database;

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
            SELECT id, name, color, sort_order, is_default, created_at, updated_at
            FROM lists
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
        let connection = self.database.connect()?;
        connection.execute(
            "INSERT INTO lists (id, name, color, sort_order) VALUES (?1, ?2, ?3, ?4)",
            params![id, name, input.color, input.sort_order.unwrap_or(0)],
        )?;
        self.get(&id)
    }

    pub fn update(&self, input: UpdateListInput) -> RepositoryResult<TaskList> {
        let name = validate_name(&input.name)?;
        let connection = self.database.connect()?;
        let updated = connection.execute(
            r#"
            UPDATE lists
            SET name = ?2, color = ?3, sort_order = ?4,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?1
            "#,
            params![input.id, name, input.color, input.sort_order],
        )?;
        if updated == 0 {
            return Err(RepositoryError::NotFound("list"));
        }
        self.get(&input.id)
    }

    pub fn delete(&self, id: &str) -> RepositoryResult<()> {
        let list = self.get(id)?;
        if list.is_default {
            return Err(RepositoryError::Validation(
                "default lists cannot be deleted",
            ));
        }
        let connection = self.database.connect()?;
        connection.execute("DELETE FROM lists WHERE id = ?1", params![id])?;
        Ok(())
    }

    fn get(&self, id: &str) -> RepositoryResult<TaskList> {
        let connection = self.database.connect()?;
        let result = connection.query_row(
            r#"
            SELECT id, name, color, sort_order, is_default, created_at, updated_at
            FROM lists WHERE id = ?1
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
    })
}

fn validate_name(name: &str) -> RepositoryResult<String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(RepositoryError::Validation("list name cannot be empty"));
    }
    Ok(name.to_owned())
}
