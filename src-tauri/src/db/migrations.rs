use rusqlite::{params, Connection};

use crate::error::RepositoryResult;

struct Migration {
    version: i64,
    name: &'static str,
    sql: &'static str,
}

const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        name: "create_core_schema",
        sql: r#"
        CREATE TABLE lists (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL COLLATE NOCASE UNIQUE,
            color TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );

        CREATE TABLE tasks (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL CHECK (length(trim(title)) > 0),
            note TEXT,
            status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'done', 'archived')),
            priority INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 2),
            list_id TEXT NOT NULL DEFAULT 'inbox',
            due_at TEXT,
            remind_at TEXT,
            reminded_at TEXT,
            completed_at TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            deleted_at TEXT,
            FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE RESTRICT
        );

        CREATE TABLE tags (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL COLLATE NOCASE UNIQUE,
            color TEXT,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );

        CREATE TABLE task_tags (
            task_id TEXT NOT NULL,
            tag_id TEXT NOT NULL,
            PRIMARY KEY (task_id, tag_id),
            FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
            FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
        );

        CREATE TABLE settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );

        CREATE INDEX idx_tasks_active_status ON tasks(status, deleted_at);
        CREATE INDEX idx_tasks_due_at ON tasks(due_at) WHERE deleted_at IS NULL;
        CREATE INDEX idx_tasks_list_id ON tasks(list_id) WHERE deleted_at IS NULL;
        CREATE INDEX idx_tasks_remind_at ON tasks(remind_at) WHERE deleted_at IS NULL;
        CREATE INDEX idx_task_tags_tag_id ON task_tags(tag_id);
        "#,
    },
    Migration {
        version: 2,
        name: "initialize_app_settings",
        sql: r#"
        INSERT OR IGNORE INTO settings (key, value) VALUES ('theme', '"system"');
        INSERT OR IGNORE INTO settings (key, value) VALUES ('defaultView', '"today"');
        INSERT OR IGNORE INTO settings (key, value) VALUES ('defaultReminderMinutes', 'null');
        INSERT OR IGNORE INTO settings (key, value) VALUES ('launchAtStartup', 'false');
        "#,
    },
];

pub fn apply_migrations(connection: &mut Connection) -> RepositoryResult<()> {
    connection.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        "#,
    )?;

    let current_version = connection.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |row| row.get::<_, i64>(0),
    )?;

    for migration in MIGRATIONS
        .iter()
        .filter(|migration| migration.version > current_version)
    {
        let transaction = connection.transaction()?;
        transaction.execute_batch(migration.sql)?;
        transaction.execute(
            "INSERT INTO schema_migrations (version, name) VALUES (?1, ?2)",
            params![migration.version, migration.name],
        )?;
        transaction.commit()?;
    }

    Ok(())
}
