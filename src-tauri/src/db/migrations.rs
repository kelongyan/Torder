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
        VALUES ('work', '工作', '#bd93f9', 0, 1);
        INSERT OR IGNORE INTO lists (id, name, color, sort_order, is_default)
        VALUES ('personal', '个人', '#50fa7b', 1, 1);
        INSERT OR IGNORE INTO lists (id, name, color, sort_order, is_default)
        VALUES ('study', '学习', '#8be9fd', 2, 1);

        UPDATE lists
        SET name = '工作', color = '#bd93f9', sort_order = 0, is_default = 1
        WHERE id = 'work';
        UPDATE lists
        SET name = '个人', color = '#50fa7b', sort_order = 1, is_default = 1
        WHERE id = 'personal';
        UPDATE lists
        SET name = '学习', color = '#8be9fd', sort_order = 2, is_default = 1
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
    Migration {
        version: 4,
        name: "apply_dracula_default_list_colors",
        sql: r##"
        UPDATE lists
        SET color = '#bd93f9', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = 'work'
          AND is_default = 1
          AND (color IS NULL OR lower(color) = '#6366f1');

        UPDATE lists
        SET color = '#50fa7b', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = 'personal'
          AND is_default = 1
          AND (color IS NULL OR lower(color) = '#22c55e');

        UPDATE lists
        SET color = '#8be9fd', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = 'study'
          AND is_default = 1
          AND (color IS NULL OR lower(color) = '#a855f7');
        "##,
    },
    Migration {
        version: 5,
        name: "add_reminder_columns",
        sql: r#"
        ALTER TABLE tasks ADD COLUMN remind_before INTEGER;

        ALTER TABLE tasks ADD COLUMN remind_at TEXT;

        ALTER TABLE tasks ADD COLUMN reminded_at TEXT;

        CREATE INDEX IF NOT EXISTS idx_tasks_remind_at
            ON tasks(remind_at) WHERE deleted_at IS NULL AND reminded_at IS NULL;
        "#,
    },
    Migration {
        version: 6,
        name: "add_repeat_rule",
        sql: r#"
        ALTER TABLE tasks ADD COLUMN repeat_rule TEXT;
        "#,
    },
    Migration {
        version: 7,
        name: "add_recurring_rules",
        sql: r#"
        CREATE TABLE recurring_rules (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL CHECK (length(trim(title)) > 0),
            note TEXT,
            priority INTEGER NOT NULL DEFAULT 1 CHECK (priority BETWEEN 0 AND 2),
            list_id TEXT NOT NULL DEFAULT 'work',
            frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'quarterly')),
            interval_count INTEGER NOT NULL DEFAULT 1 CHECK (interval_count >= 1),
            weekdays TEXT NOT NULL DEFAULT '[]',
            month_day INTEGER CHECK (month_day BETWEEN 1 AND 31),
            first_due_at TEXT NOT NULL,
            next_due_at TEXT,
            timezone TEXT NOT NULL DEFAULT 'UTC',
            generate_ahead_minutes INTEGER NOT NULL DEFAULT 0 CHECK (generate_ahead_minutes >= 0),
            remind_before INTEGER,
            end_at TEXT,
            enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            deleted_at TEXT,
            FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE RESTRICT
        );

        ALTER TABLE tasks ADD COLUMN recurring_rule_id TEXT REFERENCES recurring_rules(id) ON DELETE SET NULL;
        ALTER TABLE tasks ADD COLUMN occurrence_at TEXT;

        CREATE INDEX idx_recurring_rules_next_due
            ON recurring_rules(next_due_at)
            WHERE enabled = 1 AND deleted_at IS NULL;
        CREATE INDEX idx_tasks_recurring_rule
            ON tasks(recurring_rule_id)
            WHERE recurring_rule_id IS NOT NULL;
        CREATE UNIQUE INDEX idx_tasks_recurring_occurrence
            ON tasks(recurring_rule_id, occurrence_at)
            WHERE recurring_rule_id IS NOT NULL AND occurrence_at IS NOT NULL;

        INSERT INTO recurring_rules (
            id, title, note, priority, list_id, frequency, interval_count,
            weekdays, month_day, first_due_at, next_due_at, timezone,
            generate_ahead_minutes, remind_before
        )
        SELECT
            'legacy-' || id, title, note, priority, list_id, repeat_rule, 1,
            CASE
                WHEN repeat_rule = 'weekly'
                    THEN '[' || CAST(strftime('%w', due_at) AS INTEGER) || ']'
                ELSE '[]'
            END,
            CASE
                WHEN repeat_rule = 'monthly' THEN CAST(strftime('%d', due_at) AS INTEGER)
                ELSE NULL
            END,
            due_at, due_at, 'UTC', 0, remind_before
        FROM tasks
        WHERE status = 'todo'
          AND deleted_at IS NULL
          AND due_at IS NOT NULL
          AND repeat_rule IN ('daily', 'weekly', 'monthly');

        UPDATE tasks
        SET recurring_rule_id = 'legacy-' || id,
            occurrence_at = due_at,
            repeat_rule = NULL
        WHERE status = 'todo'
          AND deleted_at IS NULL
          AND due_at IS NOT NULL
          AND repeat_rule IN ('daily', 'weekly', 'monthly');
        "#,
    },
    Migration {
        version: 8,
        name: "scope_recurring_occurrence_uniqueness_to_live_tasks",
        // 旧索引把软删除的实例也算进唯一约束，导致用户删掉一个循环实例后
        // INSERT OR IGNORE 永远被静默忽略，该实例再也无法重新生成。
        // 唯一性应只约束“存活任务”，即每个 occurrence 至多一条未删除记录。
        // 旧索引的约束范围是新索引的超集，因此不可能存在需要清理的重复行，
        // 新索引一定能建立成功，无需（也不应）删除任何任务数据。
        sql: r#"
        DROP INDEX IF EXISTS idx_tasks_recurring_occurrence;

        CREATE UNIQUE INDEX idx_tasks_recurring_occurrence
            ON tasks(recurring_rule_id, occurrence_at)
            WHERE recurring_rule_id IS NOT NULL
              AND occurrence_at IS NOT NULL
              AND deleted_at IS NULL;
        "#,
    },
    Migration {
        version: 9,
        name: "add_calendar_events",
        sql: r#"
        CREATE TABLE calendar_events (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL CHECK (length(trim(title)) > 0),
            event_type TEXT NOT NULL CHECK (event_type IN ('leave', 'trip')),
            start_date TEXT NOT NULL,
            end_date TEXT NOT NULL CHECK (end_date >= start_date),
            note TEXT,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            deleted_at TEXT
        );

        CREATE INDEX idx_calendar_events_dates
            ON calendar_events(start_date, end_date)
            WHERE deleted_at IS NULL;
        "#,
    },
    Migration {
        version: 10,
        name: "add_sync_metadata",
        sql: r#"
        ALTER TABLE lists ADD COLUMN deleted_at TEXT;

        CREATE INDEX idx_lists_active_order
            ON lists(sort_order, created_at) WHERE deleted_at IS NULL;

        CREATE TABLE sync_devices (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL,
            last_sync_at TEXT,
            last_remote_sequence INTEGER NOT NULL DEFAULT 0,
            enabled INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE sync_objects (
            entity TEXT NOT NULL,
            object_id TEXT NOT NULL,
            revision INTEGER NOT NULL DEFAULT 0,
            last_changed_at TEXT NOT NULL,
            last_source_device TEXT,
            deleted_at TEXT,
            PRIMARY KEY (entity, object_id)
        );

        CREATE TABLE sync_changes (
            id TEXT PRIMARY KEY,
            entity TEXT NOT NULL,
            object_id TEXT NOT NULL,
            operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete')),
            base_revision INTEGER NOT NULL,
            revision INTEGER NOT NULL,
            payload_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            uploaded_at TEXT,
            remote_sequence INTEGER
        );

        CREATE INDEX idx_sync_changes_pending
            ON sync_changes(uploaded_at, created_at);
        CREATE INDEX idx_sync_changes_object
            ON sync_changes(entity, object_id, revision);

        CREATE TABLE sync_conflicts (
            id TEXT PRIMARY KEY,
            entity TEXT NOT NULL,
            object_id TEXT NOT NULL,
            local_revision INTEGER NOT NULL,
            remote_revision INTEGER NOT NULL,
            local_payload_json TEXT NOT NULL,
            remote_payload_json TEXT NOT NULL,
            detected_at TEXT NOT NULL,
            resolved_at TEXT,
            resolution TEXT
        );

        CREATE TABLE sync_state (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        "#,
    },
];

/// 当前代码内置的最高 schema 版本，供备份校验与导出元数据复用。
pub const CURRENT_SCHEMA_VERSION: i64 = MIGRATIONS[MIGRATIONS.len() - 1].version;

pub fn apply_migrations(connection: &mut Connection) -> RepositoryResult<()> {
    apply_migrations_through(connection, i64::MAX)
}

fn apply_migrations_through(
    connection: &mut Connection,
    maximum_version: i64,
) -> RepositoryResult<()> {
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

    for migration in MIGRATIONS.iter().filter(|migration| {
        migration.version > current_version && migration.version <= maximum_version
    }) {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_active_legacy_repeat_task_without_duplication() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch("PRAGMA foreign_keys = ON;")
            .unwrap();
        apply_migrations_through(&mut connection, 6).unwrap();
        connection
            .execute(
                r#"
                INSERT INTO tasks (
                    id, title, status, priority, list_id, due_at, sort_order,
                    remind_before, repeat_rule
                ) VALUES ('legacy-task', '旧循环任务', 'todo', 1, 'work',
                          '2026-08-10T09:00:00Z', 0, 60, 'weekly')
                "#,
                [],
            )
            .unwrap();

        apply_migrations(&mut connection).unwrap();

        let rule_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM recurring_rules WHERE id = 'legacy-legacy-task'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let link: (Option<String>, Option<String>, Option<String>) = connection
            .query_row(
                "SELECT recurring_rule_id, occurrence_at, repeat_rule FROM tasks WHERE id = 'legacy-task'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(rule_count, 1);
        assert_eq!(link.0.as_deref(), Some("legacy-legacy-task"));
        assert_eq!(link.1.as_deref(), Some("2026-08-10T09:00:00Z"));
        assert_eq!(link.2, None);
    }
}
