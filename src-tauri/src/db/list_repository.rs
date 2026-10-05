use rusqlite::{params, Row};
use serde_json::json;
use uuid::Uuid;

use crate::db::{recurring_repository, task_repository};
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

    /// 删除清单（issue #9：默认清单同样可删）。软删，行保留以满足外键。
    ///
    /// - 仅剩最后一个清单时拒绝：`tasks.list_id` / `recurring_rules.list_id`
    ///   均非空且外键指向清单，零清单状态不可表示。
    /// - 成员任务与循环规则迁入第一个剩余清单（sort_order 最小，与前端
    ///   `lists[0]` 兜底一致），逐个记录同步变更；清单删除本身也记一条。
    pub fn delete(&self, id: &str) -> RepositoryResult<()> {
        self.get(id)?;
        let mut connection = self.database.connect()?;
        let transaction = connection.transaction()?;
        let list_count: i64 = transaction.query_row(
            "SELECT COUNT(*) FROM lists WHERE deleted_at IS NULL",
            [],
            |row| row.get(0),
        )?;
        if list_count <= 1 {
            return Err(RepositoryError::Validation(
                "cannot delete the last remaining list",
            ));
        }
        let target_list_id: String = transaction.query_row(
            r#"
            SELECT id FROM lists
            WHERE deleted_at IS NULL AND id != ?1
            ORDER BY sort_order ASC, created_at ASC
            LIMIT 1
            "#,
            params![id],
            |row| row.get(0),
        )?;

        let task_ids: Vec<String> = {
            let mut statement = transaction.prepare(
                "SELECT id FROM tasks WHERE list_id = ?1 AND deleted_at IS NULL AND purged_at IS NULL",
            )?;
            let ids = statement
                .query_map(params![id], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            ids
        };
        for task_id in &task_ids {
            transaction.execute(
                r#"
                UPDATE tasks
                SET list_id = ?2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                WHERE id = ?1
                "#,
                params![task_id, target_list_id],
            )?;
            // 迁移后的任务逐个走完整载荷（serde 序列化）进同步队列，
            // 形状与 task_repository::update 一致。
            let changed_task = transaction.query_row(
                &format!("{} WHERE id = ?1", task_repository::select_tasks()),
                params![task_id],
                task_repository::map_task,
            )?;
            sync_repository::record_change(
                &transaction,
                "task",
                task_id,
                "upsert",
                serde_json::to_value(changed_task)?,
            )?;
        }

        // 循环规则的 list_id 一起迁走：否则未来生成的实例仍会落进已删清单。
        // next_due_at 等调度字段不动（list_id 不是调度字段）。
        let rule_ids: Vec<String> = {
            let mut statement = transaction.prepare(
                "SELECT id FROM recurring_rules WHERE list_id = ?1 AND deleted_at IS NULL",
            )?;
            let ids = statement
                .query_map(params![id], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            ids
        };
        for rule_id in &rule_ids {
            transaction.execute(
                r#"
                UPDATE recurring_rules
                SET list_id = ?2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                WHERE id = ?1
                "#,
                params![rule_id, target_list_id],
            )?;
            let changed_rule = transaction.query_row(
                &format!("{} WHERE id = ?1", recurring_repository::select_rules()),
                params![rule_id],
                recurring_repository::map_rule,
            )?;
            sync_repository::record_change(
                &transaction,
                "recurringRule",
                rule_id,
                "upsert",
                serde_json::to_value(changed_rule)?,
            )?;
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
