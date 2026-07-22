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
    Migration {
        version: 3,
        name: "align_prototype_schema",
        sql: r#"
        UPDATE lists
        SET name = name || '（旧）'
        WHERE id NOT IN ('work', 'personal', 'study')
          AND name IN ('工作', '个人', '学习');

        INSERT OR IGNORE INTO lists (id, name, color, sort_order, is_default)
        VALUES ('work', '工作', '#6366f1', 0, 1);
        INSERT OR IGNORE INTO lists (id, name, color, sort_order, is_default)
        VALUES ('personal', '个人', '#22c55e', 1, 1);
        INSERT OR IGNORE INTO lists (id, name, color, sort_order, is_default)
        VALUES ('study', '学习', '#a855f7', 2, 1);

        UPDATE lists
        SET name = '工作', color = '#6366f1', sort_order = 0, is_default = 1
        WHERE id = 'work';
        UPDATE lists
        SET name = '个人', color = '#22c55e', sort_order = 1, is_default = 1
        WHERE id = 'personal';
        UPDATE lists
        SET name = '学习', color = '#a855f7', sort_order = 2, is_default = 1
        WHERE id = 'study';
        UPDATE lists
        SET is_default = 0
        WHERE id NOT IN ('work', 'personal', 'study');

        UPDATE tasks SET list_id = 'work' WHERE list_id = 'inbox';
        UPDATE tasks SET list_id = 'personal' WHERE list_id = 'life';
        UPDATE tasks
        SET list_id = 'work'
        WHERE list_id NOT IN (SELECT id FROM lists);

        DROP TABLE IF EXISTS task_tags;
        DROP TABLE IF EXISTS tags;

        CREATE TABLE tasks_next (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL CHECK (length(trim(title)) > 0),
            note TEXT,
            status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'done', 'archived')),
            priority INTEGER NOT NULL DEFAULT 1 CHECK (priority BETWEEN 0 AND 2),
            list_id TEXT NOT NULL DEFAULT 'work',
            due_at TEXT,
            completed_at TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            deleted_at TEXT,
            FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE RESTRICT
        );

        INSERT INTO tasks_next (
            id, title, note, status, priority, list_id, due_at,
            completed_at, sort_order, created_at, updated_at, deleted_at
        )
        SELECT
            id, title, note, status, priority,
            CASE
                WHEN list_id IN (SELECT id FROM lists) THEN list_id
                ELSE 'work'
            END,
            due_at, completed_at, sort_order, created_at, updated_at, deleted_at
        FROM tasks;

        DROP TABLE tasks;
        ALTER TABLE tasks_next RENAME TO tasks;

        DELETE FROM lists WHERE id IN ('inbox', 'life');

        CREATE INDEX idx_tasks_active_status ON tasks(status, deleted_at);
        CREATE INDEX idx_tasks_due_at ON tasks(due_at) WHERE deleted_at IS NULL;
        CREATE INDEX idx_tasks_list_id ON tasks(list_id) WHERE deleted_at IS NULL;

        DELETE FROM settings WHERE key NOT IN ('theme');
        INSERT OR IGNORE INTO settings (key, value) VALUES ('theme', '"dark"');
        UPDATE settings
        SET value = '"dark"', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE key = 'theme'
          AND value NOT IN ('"dark"', '"light"', '"system"');
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
