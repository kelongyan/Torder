use rusqlite::{params, Row};
use uuid::Uuid;

use crate::error::{RepositoryError, RepositoryResult};
use crate::models::{CreateTagInput, Tag, UpdateTagInput};

use super::Database;

pub struct TagRepository<'database> {
    database: &'database Database,
}

impl<'database> TagRepository<'database> {
    pub fn new(database: &'database Database) -> Self {
        Self { database }
    }

    pub fn list(&self) -> RepositoryResult<Vec<Tag>> {
        let connection = self.database.connect()?;
        let mut statement = connection.prepare(
            r#"
            SELECT id, name, color, created_at, updated_at
            FROM tags ORDER BY name COLLATE NOCASE ASC
            "#,
        )?;
        let tags = statement
            .query_map([], map_tag)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(tags)
    }

    pub fn create(&self, input: CreateTagInput) -> RepositoryResult<Tag> {
        let name = validate_name(&input.name)?;
        let id = Uuid::new_v4().to_string();
        let connection = self.database.connect()?;
        connection.execute(
            "INSERT INTO tags (id, name, color) VALUES (?1, ?2, ?3)",
            params![id, name, input.color],
        )?;
        self.get(&id)
    }

    pub fn update(&self, input: UpdateTagInput) -> RepositoryResult<Tag> {
        let name = validate_name(&input.name)?;
        let connection = self.database.connect()?;
        let updated = connection.execute(
            r#"
            UPDATE tags
            SET name = ?2, color = ?3,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?1
            "#,
            params![input.id, name, input.color],
        )?;
        if updated == 0 {
            return Err(RepositoryError::NotFound("tag"));
        }
        self.get(&input.id)
    }

    pub fn delete(&self, id: &str) -> RepositoryResult<()> {
        let connection = self.database.connect()?;
        let deleted = connection.execute("DELETE FROM tags WHERE id = ?1", params![id])?;
        if deleted == 0 {
            return Err(RepositoryError::NotFound("tag"));
        }
        Ok(())
    }

    fn get(&self, id: &str) -> RepositoryResult<Tag> {
        let connection = self.database.connect()?;
        let result = connection.query_row(
            r#"
            SELECT id, name, color, created_at, updated_at
            FROM tags WHERE id = ?1
            "#,
            params![id],
            map_tag,
        );
        match result {
            Ok(tag) => Ok(tag),
            Err(rusqlite::Error::QueryReturnedNoRows) => Err(RepositoryError::NotFound("tag")),
            Err(error) => Err(error.into()),
        }
    }
}

fn map_tag(row: &Row<'_>) -> rusqlite::Result<Tag> {
    Ok(Tag {
        id: row.get(0)?,
        name: row.get(1)?,
        color: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
    })
}

fn validate_name(name: &str) -> RepositoryResult<String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(RepositoryError::Validation("tag name cannot be empty"));
    }
    Ok(name.to_owned())
}
