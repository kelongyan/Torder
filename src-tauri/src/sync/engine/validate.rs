use serde_json::Value;

use super::{
    crypto, supported_protocol, MAX_BATCH_OPERATIONS, MAX_ID_LENGTH, MAX_JSON_DEPTH,
    MAX_STRING_LENGTH, MIN_SUPPORTED_SCHEMA_VERSION, SCHEMA_VERSION,
};
use crate::error::{RepositoryError, RepositoryResult};
use crate::sync::manifest::{ChangeOperation, Manifest};

pub fn validate_manifest(manifest: &Manifest) -> RepositoryResult<()> {
    if !supported_protocol(manifest.protocol)
        || manifest.format != "torder-sync"
        || !(MIN_SUPPORTED_SCHEMA_VERSION..=SCHEMA_VERSION).contains(&manifest.schema_version)
        || manifest.latest_sequence < 0
        || manifest.snapshot_sequence < 0
        || manifest.snapshot_sequence > manifest.latest_sequence
        || uuid::Uuid::parse_str(&manifest.collection_id).is_err()
    {
        return Err(RepositoryError::Validation("incompatible remote manifest"));
    }
    if let Some(config) = &manifest.encryption {
        crypto::validate_config(config)?;
    }
    if manifest.devices.len() > 100
        || manifest.devices.iter().any(|device| {
            device.id.trim().is_empty()
                || device.id.len() > MAX_ID_LENGTH
                || device.name.trim().is_empty()
                || device.name.len() > 512
                || device.last_sequence < 0
                || device.last_sequence > manifest.latest_sequence
                || chrono::DateTime::parse_from_rfc3339(&device.last_seen_at).is_err()
        })
    {
        return Err(RepositoryError::Validation(
            "invalid remote manifest device summary",
        ));
    }
    Ok(())
}

pub fn validate_operation(operation: &ChangeOperation) -> RepositoryResult<()> {
    if !matches!(
        operation.entity.as_str(),
        "list" | "recurringRule" | "task" | "calendarEvent" | "attachment" | "taskLink"
    ) {
        return Err(RepositoryError::Validation("invalid sync entity"));
    }
    if !matches!(operation.operation.as_str(), "upsert" | "delete") {
        return Err(RepositoryError::Validation("invalid sync operation"));
    }
    if operation.object_id.trim().is_empty() || operation.id.trim().is_empty() {
        return Err(RepositoryError::Validation("invalid sync object id"));
    }
    if operation.id.len() > MAX_ID_LENGTH || operation.object_id.len() > MAX_ID_LENGTH {
        return Err(RepositoryError::Validation("sync object id is too long"));
    }
    if operation.base_revision < 0
        || operation.revision <= operation.base_revision
        || operation.revision < 1
    {
        return Err(RepositoryError::Validation("invalid sync revision"));
    }
    if chrono::DateTime::parse_from_rfc3339(&operation.changed_at).is_err() {
        return Err(RepositoryError::Validation(
            "invalid sync operation timestamp",
        ));
    }
    if !operation.payload.is_object() {
        return Err(RepositoryError::Validation("invalid sync payload"));
    }
    validate_json_limits(&operation.payload, 0)?;
    let payload = operation
        .payload
        .as_object()
        .expect("checked payload object");
    if let Some(id) = payload.get("id") {
        let id = id.as_str().ok_or(RepositoryError::Validation(
            "sync payload id must be a string",
        ))?;
        if id != operation.object_id {
            return Err(RepositoryError::Validation(
                "sync payload id does not match object id",
            ));
        }
    }
    validate_entity_fields(&operation.entity, payload)?;
    // 删除操作的 payload 必须携带字符串型 deletedAt（P1-03：简化布尔表达
    // 式，与 is_some_and + 取反的写法语义完全等价）
    if operation.operation == "delete" && payload.get("deletedAt").and_then(Value::as_str).is_none()
    {
        return Err(RepositoryError::Validation(
            "sync delete payload requires deletedAt",
        ));
    }
    Ok(())
}

pub fn validate_json_limits(value: &Value, depth: usize) -> RepositoryResult<()> {
    if depth > MAX_JSON_DEPTH {
        return Err(RepositoryError::Validation(
            "sync payload is too deeply nested",
        ));
    }
    match value {
        Value::String(value) if value.len() > MAX_STRING_LENGTH => Err(
            RepositoryError::Validation("sync payload string is too long"),
        ),
        Value::Array(values) => {
            if values.len() > MAX_BATCH_OPERATIONS {
                return Err(RepositoryError::Validation(
                    "sync payload array is too large",
                ));
            }
            values
                .iter()
                .try_for_each(|value| validate_json_limits(value, depth + 1))
        }
        Value::Object(values) => {
            if values.len() > 64 {
                return Err(RepositoryError::Validation(
                    "sync payload has too many fields",
                ));
            }
            values
                .values()
                .try_for_each(|value| validate_json_limits(value, depth + 1))
        }
        _ => Ok(()),
    }
}

pub fn validate_entity_fields(
    entity: &str,
    payload: &serde_json::Map<String, Value>,
) -> RepositoryResult<()> {
    for key in payload.keys() {
        let allowed = match entity {
            "list" => matches!(
                key.as_str(),
                "id" | "name"
                    | "color"
                    | "sortOrder"
                    | "isDefault"
                    | "createdAt"
                    | "updatedAt"
                    | "deletedAt"
            ),
            "recurringRule" => matches!(
                key.as_str(),
                "id" | "title"
                    | "note"
                    | "priority"
                    | "listId"
                    | "frequency"
                    | "intervalCount"
                    | "weekdays"
                    | "monthDay"
                    | "firstDueAt"
                    | "nextDueAt"
                    | "timezone"
                    | "generateAheadMinutes"
                    | "remindBefore"
                    | "endAt"
                    | "enabled"
                    | "createdAt"
                    | "updatedAt"
                    | "deletedAt"
            ),
            "task" => matches!(
                key.as_str(),
                "id" | "title"
                    | "note"
                    | "status"
                    | "priority"
                    | "listId"
                    | "scheduledDate"
                    | "dueAt"
                    | "completedAt"
                    | "sortOrder"
                    | "remindBefore"
                    | "remindAt"
                    | "remindedAt"
                    | "repeatRule"
                    | "subtasks"
                    | "tags"
                    | "recurringRuleId"
                    | "occurrenceAt"
                    | "createdAt"
                    | "updatedAt"
                    | "deletedAt"
            ),
            "calendarEvent" => matches!(
                key.as_str(),
                "id" | "title"
                    | "eventType"
                    | "startDate"
                    | "endDate"
                    | "note"
                    | "createdAt"
                    | "updatedAt"
                    | "deletedAt"
            ),
            "attachment" => matches!(
                key.as_str(),
                "id" | "taskId"
                    | "kind"
                    | "blobId"
                    | "displayName"
                    | "originalName"
                    | "externalUrl"
                    | "contentSha256"
                    | "sizeBytes"
                    | "mimeType"
                    | "remotePath"
                    | "encryptionKeyId"
                    | "sortOrder"
                    | "createdAt"
                    | "updatedAt"
                    | "deletedAt"
            ),
            "taskLink" => matches!(
                key.as_str(),
                "id" | "sourceTaskId"
                    | "targetTaskId"
                    | "relationType"
                    | "sortOrder"
                    | "createdAt"
                    | "updatedAt"
                    | "deletedAt"
            ),
            _ => false,
        };
        if !allowed {
            return Err(RepositoryError::Validation("unknown sync payload field"));
        }
    }

    string_field(payload, "id", MAX_ID_LENGTH)?;
    string_field(payload, "listId", MAX_ID_LENGTH)?;
    string_field(payload, "taskId", MAX_ID_LENGTH)?;
    string_field(payload, "sourceTaskId", MAX_ID_LENGTH)?;
    string_field(payload, "targetTaskId", MAX_ID_LENGTH)?;
    string_field(payload, "blobId", MAX_ID_LENGTH)?;
    string_field(payload, "recurringRuleId", MAX_ID_LENGTH)?;
    string_field(payload, "repeatRule", MAX_STRING_LENGTH)?;
    string_field(payload, "color", 64)?;
    string_field(payload, "name", 512)?;
    string_field(payload, "title", 512)?;
    string_field(payload, "displayName", 512)?;
    string_field(payload, "originalName", 512)?;
    string_field(payload, "note", MAX_STRING_LENGTH)?;
    string_field(payload, "status", 32)?;
    string_field(payload, "eventType", 32)?;
    string_field(payload, "frequency", 32)?;
    string_field(payload, "timezone", 64)?;
    string_field(payload, "kind", 32)?;
    string_field(payload, "relationType", 32)?;
    string_field(payload, "externalUrl", 2048)?;
    string_field(payload, "contentSha256", 128)?;
    string_field(payload, "mimeType", 255)?;
    string_field(payload, "remotePath", 512)?;
    string_field(payload, "encryptionKeyId", MAX_ID_LENGTH)?;

    if let Some(value) = payload.get("kind") {
        if !matches!(value.as_str(), Some("managed" | "webLink")) {
            return Err(RepositoryError::Validation("invalid sync attachment kind"));
        }
    }
    if let Some(value) = payload.get("relationType") {
        if !matches!(value.as_str(), Some("reference")) {
            return Err(RepositoryError::Validation(
                "invalid sync task link relation",
            ));
        }
    }
    if entity == "taskLink" {
        let source = payload.get("sourceTaskId").and_then(Value::as_str);
        let target = payload.get("targetTaskId").and_then(Value::as_str);
        match (source, target) {
            (Some(source), Some(target)) if source != target => {}
            (Some(_), Some(_)) => {
                return Err(RepositoryError::Validation(
                    "task link cannot reference itself",
                ));
            }
            _ if payload.contains_key("deletedAt") => {}
            _ => {
                return Err(RepositoryError::Validation(
                    "task link payload is incomplete",
                ));
            }
        }
    }
    if let Some(value) = payload.get("externalUrl") {
        if !value.is_null() {
            let url = value
                .as_str()
                .ok_or(RepositoryError::Validation("sync field must be a string"))?;
            if !(url.starts_with("https://") || url.starts_with("http://")) {
                return Err(RepositoryError::Validation("invalid sync attachment URL"));
            }
        }
    }
    if entity == "attachment" {
        match payload.get("kind").and_then(Value::as_str) {
            Some("managed") => {
                if payload.get("blobId").and_then(Value::as_str).is_none()
                    || payload
                        .get("contentSha256")
                        .and_then(Value::as_str)
                        .is_none()
                    || payload.get("sizeBytes").and_then(Value::as_i64).is_none()
                    || payload.get("remotePath").and_then(Value::as_str).is_none()
                {
                    return Err(RepositoryError::Validation(
                        "managed attachment payload is incomplete",
                    ));
                }
            }
            Some("webLink") => {
                if payload.get("externalUrl").and_then(Value::as_str).is_none() {
                    return Err(RepositoryError::Validation(
                        "web link attachment payload is incomplete",
                    ));
                }
            }
            Some(_) => {}
            None => {
                if !payload.contains_key("deletedAt") {
                    return Err(RepositoryError::Validation(
                        "attachment payload requires kind",
                    ));
                }
            }
        }
    }
    if let Some(value) = payload.get("status") {
        if !matches!(value.as_str(), Some("todo" | "done" | "archived")) {
            return Err(RepositoryError::Validation("invalid sync task status"));
        }
    }
    if let Some(value) = payload.get("eventType") {
        if !matches!(value.as_str(), Some("leave" | "trip" | "other")) {
            return Err(RepositoryError::Validation(
                "invalid sync calendar event type",
            ));
        }
    }
    if let Some(value) = payload.get("frequency") {
        if !matches!(
            value.as_str(),
            Some("daily" | "weekly" | "monthly" | "quarterly")
        ) {
            return Err(RepositoryError::Validation(
                "invalid sync recurring frequency",
            ));
        }
    }
    integer_range(payload, "priority", 0, 2)?;
    integer_range(payload, "sortOrder", i64::MIN, i64::MAX)?;
    integer_range(payload, "sizeBytes", 0, i64::MAX)?;
    integer_range(payload, "intervalCount", 1, 365)?;
    integer_range(payload, "monthDay", 1, 31)?;
    integer_range(payload, "generateAheadMinutes", 0, 525_600)?;
    integer_range(payload, "remindBefore", 0, 525_600)?;
    validate_weekdays(payload.get("weekdays"))?;
    validate_task_tags(payload.get("tags"))?;
    validate_subtasks(payload.get("subtasks"))?;
    boolean_field(payload, "isDefault")?;
    boolean_field(payload, "enabled")?;

    for key in [
        "createdAt",
        "updatedAt",
        "deletedAt",
        "dueAt",
        "completedAt",
        "remindAt",
        "remindedAt",
        "occurrenceAt",
        "firstDueAt",
        "nextDueAt",
        "endAt",
    ] {
        timestamp_field(payload, key)?;
    }
    date_field(payload, "startDate")?;
    date_field(payload, "endDate")?;
    date_field(payload, "scheduledDate")?;
    if let (Some(start), Some(end)) = (
        payload.get("startDate").and_then(Value::as_str),
        payload.get("endDate").and_then(Value::as_str),
    ) {
        if end < start {
            return Err(RepositoryError::Validation(
                "sync calendar event end date precedes start date",
            ));
        }
    }
    if let Some(value) = payload.get("timezone") {
        value
            .as_str()
            .ok_or(RepositoryError::Validation(
                "sync timezone must be a string",
            ))?
            .parse::<chrono_tz::Tz>()
            .map_err(|_| RepositoryError::Validation("invalid sync timezone"))?;
    }
    Ok(())
}

pub fn string_field(
    payload: &serde_json::Map<String, Value>,
    key: &str,
    max_length: usize,
) -> RepositoryResult<()> {
    let Some(value) = payload.get(key) else {
        return Ok(());
    };
    if value.is_null()
        && matches!(
            key,
            "note"
                | "color"
                | "recurringRuleId"
                | "repeatRule"
                | "blobId"
                | "originalName"
                | "externalUrl"
                | "contentSha256"
                | "mimeType"
                | "remotePath"
                | "encryptionKeyId"
        )
    {
        return Ok(());
    }
    let value = value
        .as_str()
        .ok_or(RepositoryError::Validation("sync field must be a string"))?;
    if value.len() > max_length
        || (matches!(
            key,
            "id" | "name"
                | "title"
                | "displayName"
                | "taskId"
                | "sourceTaskId"
                | "targetTaskId"
                | "relationType"
        ) && value.trim().is_empty())
    {
        return Err(RepositoryError::Validation("sync string field is invalid"));
    }
    Ok(())
}

pub fn integer_range(
    payload: &serde_json::Map<String, Value>,
    key: &str,
    min: i64,
    max: i64,
) -> RepositoryResult<()> {
    let Some(value) = payload.get(key) else {
        return Ok(());
    };
    if value.is_null() && matches!(key, "monthDay" | "remindBefore" | "sizeBytes") {
        return Ok(());
    }
    let value = value.as_i64().ok_or(RepositoryError::Validation(
        "sync numeric field must be an integer",
    ))?;
    if value < min || value > max {
        return Err(RepositoryError::Validation(
            "sync numeric field is out of range",
        ));
    }
    Ok(())
}

pub fn boolean_field(payload: &serde_json::Map<String, Value>, key: &str) -> RepositoryResult<()> {
    if let Some(value) = payload.get(key) {
        value.as_bool().ok_or(RepositoryError::Validation(
            "sync boolean field must be a boolean",
        ))?;
    }
    Ok(())
}

pub fn validate_weekdays(value: Option<&Value>) -> RepositoryResult<()> {
    let Some(value) = value else { return Ok(()) };
    let weekdays = value.as_array().ok_or(RepositoryError::Validation(
        "sync weekdays must be an array",
    ))?;
    if weekdays.len() > 7
        || weekdays
            .iter()
            .any(|day| day.as_i64().is_none_or(|day| !(0..=6).contains(&day)))
    {
        return Err(RepositoryError::Validation("invalid sync weekdays"));
    }
    Ok(())
}

pub fn validate_task_tags(value: Option<&Value>) -> RepositoryResult<()> {
    let Some(value) = value else { return Ok(()) };
    let tags = value
        .as_array()
        .ok_or(RepositoryError::Validation("sync tags must be an array"))?;
    if tags.len() > 30
        || tags.iter().any(|tag| {
            tag.as_str()
                .is_none_or(|tag| tag.trim().is_empty() || tag.len() > 40)
        })
    {
        return Err(RepositoryError::Validation("invalid sync tags"));
    }
    Ok(())
}

pub fn validate_subtasks(value: Option<&Value>) -> RepositoryResult<()> {
    let Some(value) = value else { return Ok(()) };
    let subtasks = value.as_array().ok_or(RepositoryError::Validation(
        "sync subtasks must be an array",
    ))?;
    if subtasks.len() > 100 {
        return Err(RepositoryError::Validation("too many sync subtasks"));
    }
    for subtask in subtasks {
        let Some(subtask) = subtask.as_object() else {
            return Err(RepositoryError::Validation("invalid sync subtask"));
        };
        let title = subtask
            .get("title")
            .and_then(Value::as_str)
            .ok_or(RepositoryError::Validation("invalid sync subtask title"))?;
        if title.trim().is_empty() || title.len() > 512 {
            return Err(RepositoryError::Validation("invalid sync subtask title"));
        }
        let id = subtask
            .get("id")
            .and_then(Value::as_str)
            .ok_or(RepositoryError::Validation("invalid sync subtask id"))?;
        if id.trim().is_empty() || id.len() > MAX_ID_LENGTH {
            return Err(RepositoryError::Validation("invalid sync subtask id"));
        }
        if !subtask.get("completed").is_some_and(Value::is_boolean) {
            return Err(RepositoryError::Validation(
                "invalid sync subtask completion",
            ));
        }
        if !subtask.get("sortOrder").is_some_and(Value::is_i64) {
            return Err(RepositoryError::Validation(
                "invalid sync subtask sort order",
            ));
        }
        let created_at =
            subtask
                .get("createdAt")
                .and_then(Value::as_str)
                .ok_or(RepositoryError::Validation(
                    "invalid sync subtask timestamp",
                ))?;
        chrono::DateTime::parse_from_rfc3339(created_at)
            .map_err(|_| RepositoryError::Validation("invalid sync subtask timestamp"))?;
        if let Some(completed_at) = subtask.get("completedAt") {
            if !completed_at.is_null() {
                let completed_at = completed_at.as_str().ok_or(RepositoryError::Validation(
                    "invalid sync subtask timestamp",
                ))?;
                chrono::DateTime::parse_from_rfc3339(completed_at)
                    .map_err(|_| RepositoryError::Validation("invalid sync subtask timestamp"))?;
            }
        }
    }
    Ok(())
}

pub fn timestamp_field(
    payload: &serde_json::Map<String, Value>,
    key: &str,
) -> RepositoryResult<()> {
    let Some(value) = payload.get(key) else {
        return Ok(());
    };
    if value.is_null()
        && matches!(
            key,
            "deletedAt"
                | "dueAt"
                | "completedAt"
                | "remindAt"
                | "remindedAt"
                | "occurrenceAt"
                | "nextDueAt"
                | "endAt"
        )
    {
        return Ok(());
    }
    let value = value.as_str().ok_or(RepositoryError::Validation(
        "sync timestamp must be a string",
    ))?;
    chrono::DateTime::parse_from_rfc3339(value)
        .map_err(|_| RepositoryError::Validation("invalid sync timestamp"))?;
    Ok(())
}

pub fn date_field(payload: &serde_json::Map<String, Value>, key: &str) -> RepositoryResult<()> {
    let Some(value) = payload.get(key) else {
        return Ok(());
    };
    if value.is_null() && key == "scheduledDate" {
        return Ok(());
    }
    let value = value
        .as_str()
        .ok_or(RepositoryError::Validation("sync date must be a string"))?;
    chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| RepositoryError::Validation("invalid sync date"))?;
    Ok(())
}
