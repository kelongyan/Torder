// 设备身份与存量对象引导。

use super::*;

use serde_json::Value;

use crate::db::sync_repository;
use crate::error::RepositoryResult;

pub(crate) fn device_id(connection: &rusqlite::Connection) -> RepositoryResult<String> {
    if let Some(value) = sync_repository::get_state(connection, "deviceId")? {
        return Ok(value);
    }
    let value = uuid::Uuid::new_v4().to_string();
    sync_repository::set_state(connection, "deviceId", &value)?;
    Ok(value)
}

pub(crate) fn device_name(connection: &rusqlite::Connection) -> RepositoryResult<String> {
    Ok(sync_repository::get_state(connection, "deviceName")?
        .unwrap_or_else(|| format!("Torder · {}", std::env::consts::OS)))
}

pub(crate) fn remote_device_name(id: &str) -> String {
    let short_id = id.chars().take(8).collect::<String>();
    format!("远端设备 · {short_id}")
}

pub(crate) fn bootstrap_existing_objects(
    connection: &mut rusqlite::Connection,
) -> RepositoryResult<()> {
    let transaction = connection.transaction()?;
    for (entity, query) in [
        (
            "list",
            "SELECT item.id FROM lists AS item LEFT JOIN sync_objects AS object ON object.entity = 'list' AND object.object_id = item.id WHERE object.object_id IS NULL AND item.is_default = 0",
        ),
        (
            "recurringRule",
            "SELECT item.id FROM recurring_rules AS item LEFT JOIN sync_objects AS object ON object.entity = 'recurringRule' AND object.object_id = item.id WHERE object.object_id IS NULL",
        ),
        (
            "task",
            "SELECT item.id FROM tasks AS item LEFT JOIN sync_objects AS object ON object.entity = 'task' AND object.object_id = item.id WHERE object.object_id IS NULL",
        ),
        (
            "taskLink",
            "SELECT item.id FROM task_links AS item LEFT JOIN sync_objects AS object ON object.entity = 'taskLink' AND object.object_id = item.id WHERE object.object_id IS NULL",
        ),
        (
            "attachment",
            "SELECT item.id FROM task_attachments AS item LEFT JOIN sync_objects AS object ON object.entity = 'attachment' AND object.object_id = item.id WHERE object.object_id IS NULL",
        ),
        (
            "calendarEvent",
            "SELECT item.id FROM calendar_events AS item LEFT JOIN sync_objects AS object ON object.entity = 'calendarEvent' AND object.object_id = item.id WHERE object.object_id IS NULL",
        ),
    ] {
        let ids = {
            let mut statement = transaction.prepare(query)?;
            let values = statement
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            values
        };
        for id in ids {
            let payload = current_payload(&transaction, entity, &id)?;
            let operation = if payload.get("deletedAt").and_then(Value::as_str).is_some() {
                "delete"
            } else {
                "upsert"
            };
            sync_repository::record_change(&transaction, entity, &id, operation, payload)?;
        }
    }
    transaction.commit()?;
    Ok(())
}
