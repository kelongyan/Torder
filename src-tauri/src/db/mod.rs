pub mod list_repository;
pub mod migrations;
pub mod settings_repository;
pub mod task_repository;

#[cfg(test)]
mod database_tests;

use std::path::PathBuf;
use std::time::Duration;

use rusqlite::{params, Connection};

use crate::error::RepositoryResult;
use crate::models::DatabaseStatus;

#[derive(Debug)]
pub struct Database {
    path: PathBuf,
}

impl Database {
    pub fn initialize(path: PathBuf) -> RepositoryResult<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let database = Self { path };
        let mut connection = database.connect()?;
        migrations::apply_migrations(&mut connection)?;
        Self::initialize_default_lists(&mut connection)?;

        Ok(database)
    }

    pub fn connect(&self) -> RepositoryResult<Connection> {
        let connection = Connection::open(&self.path)?;
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.execute_batch(
            r#"
            PRAGMA foreign_keys = ON;
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            "#,
        )?;
        Ok(connection)
    }

    pub fn status(&self) -> RepositoryResult<DatabaseStatus> {
        let connection = self.connect()?;
        let schema_version = connection.query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )?;
        let list_count =
            connection.query_row("SELECT COUNT(*) FROM lists", [], |row| row.get(0))?;
        let task_count = connection.query_row(
            "SELECT COUNT(*) FROM tasks WHERE deleted_at IS NULL",
            [],
            |row| row.get(0),
        )?;

        Ok(DatabaseStatus {
            database_path: self.path.display().to_string(),
            schema_version,
            list_count,
            task_count,
        })
    }

    fn initialize_default_lists(connection: &mut Connection) -> RepositoryResult<()> {
        let transaction = connection.transaction()?;
        for (id, name, color, sort_order) in [
            ("work", "工作", "#6366f1", 0),
            ("personal", "个人", "#22c55e", 1),
            ("study", "学习", "#a855f7", 2),
        ] {
            transaction.execute(
                r#"
                INSERT OR IGNORE INTO lists (id, name, color, sort_order, is_default)
                VALUES (?1, ?2, ?3, ?4, 1)
                "#,
                params![id, name, color, sort_order],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }
}
