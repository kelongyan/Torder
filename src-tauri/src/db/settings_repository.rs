use rusqlite::params;

use crate::error::{RepositoryError, RepositoryResult};
use crate::models::{Setting, UpsertSettingInput};

use super::Database;

pub struct SettingsRepository<'database> {
    database: &'database Database,
}

impl<'database> SettingsRepository<'database> {
    pub fn new(database: &'database Database) -> Self {
        Self { database }
    }

    pub fn list(&self) -> RepositoryResult<Vec<Setting>> {
        let connection = self.database.connect()?;
        let mut statement =
            connection.prepare("SELECT key, value, updated_at FROM settings ORDER BY key ASC")?;
        let settings = statement
            .query_map([], |row| {
                Ok(Setting {
                    key: row.get(0)?,
                    value: row.get(1)?,
                    updated_at: row.get(2)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(settings)
    }

    pub fn get(&self, key: &str) -> RepositoryResult<Option<Setting>> {
        let connection = self.database.connect()?;
        let result = connection.query_row(
            "SELECT key, value, updated_at FROM settings WHERE key = ?1",
            params![key],
            |row| {
                Ok(Setting {
                    key: row.get(0)?,
                    value: row.get(1)?,
                    updated_at: row.get(2)?,
                })
            },
        );
        match result {
            Ok(setting) => Ok(Some(setting)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(error) => Err(error.into()),
        }
    }

    pub fn upsert(&self, input: UpsertSettingInput) -> RepositoryResult<Setting> {
        let key = input.key.trim();
        if key.is_empty() {
            return Err(RepositoryError::Validation("setting key cannot be empty"));
        }
        serde_json::from_str::<serde_json::Value>(&input.value)
            .map_err(|_| RepositoryError::Validation("setting value must be valid JSON"))?;

        let connection = self.database.connect()?;
        connection.execute(
            r#"
            INSERT INTO settings (key, value) VALUES (?1, ?2)
            ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            "#,
            params![key, input.value],
        )?;
        self.get(key)?.ok_or(RepositoryError::NotFound("setting"))
    }
}
