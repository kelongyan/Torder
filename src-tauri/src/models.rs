use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskSubtask {
    pub id: String,
    pub title: String,
    pub completed: bool,
    pub created_at: String,
    pub completed_at: Option<String>,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    pub note: Option<String>,
    pub status: String,
    pub priority: i64,
    pub list_id: String,
    pub scheduled_date: Option<String>,
    pub due_at: Option<String>,
    pub completed_at: Option<String>,
    pub sort_order: i64,
    pub remind_before: Option<i64>,
    pub remind_at: Option<String>,
    pub reminded_at: Option<String>,
    pub repeat_rule: Option<String>,
    pub subtasks: Vec<TaskSubtask>,
    pub tags: Vec<String>,
    pub recurring_rule_id: Option<String>,
    pub occurrence_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecurringRule {
    pub id: String,
    pub title: String,
    pub note: Option<String>,
    pub priority: i64,
    pub list_id: String,
    pub frequency: String,
    pub interval_count: i64,
    pub weekdays: Vec<i64>,
    pub month_day: Option<i64>,
    pub first_due_at: String,
    pub next_due_at: Option<String>,
    pub timezone: String,
    pub generate_ahead_minutes: i64,
    pub remind_before: Option<i64>,
    pub end_at: Option<String>,
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRecurringRuleInput {
    pub source_task_id: Option<String>,
    pub title: String,
    pub note: Option<String>,
    pub priority: i64,
    pub list_id: String,
    pub frequency: String,
    pub interval_count: i64,
    pub weekdays: Vec<i64>,
    pub month_day: Option<i64>,
    pub first_due_at: String,
    pub timezone: String,
    pub generate_ahead_minutes: i64,
    pub remind_before: Option<i64>,
    pub end_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRecurringRuleInput {
    pub id: String,
    pub title: String,
    pub note: Option<String>,
    pub priority: i64,
    pub list_id: String,
    pub frequency: String,
    pub interval_count: i64,
    pub weekdays: Vec<i64>,
    pub month_day: Option<i64>,
    pub first_due_at: String,
    pub timezone: String,
    pub generate_ahead_minutes: i64,
    pub remind_before: Option<i64>,
    pub end_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecurringGenerationResult {
    pub generated_count: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskInput {
    pub title: String,
    pub note: Option<String>,
    pub priority: Option<i64>,
    pub list_id: Option<String>,
    pub scheduled_date: Option<String>,
    pub due_at: Option<String>,
    pub sort_order: Option<i64>,
    pub remind_before: Option<i64>,
    pub repeat_rule: Option<String>,
    pub subtasks: Option<Vec<TaskSubtask>>,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTaskInput {
    pub id: String,
    pub title: String,
    pub note: Option<String>,
    pub status: String,
    pub priority: i64,
    pub list_id: String,
    pub scheduled_date: Option<String>,
    pub due_at: Option<String>,
    pub sort_order: i64,
    pub remind_before: Option<i64>,
    pub repeat_rule: Option<String>,
    pub subtasks: Vec<TaskSubtask>,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentBlob {
    pub id: String,
    pub content_sha256: String,
    pub size_bytes: i64,
    pub mime_type: Option<String>,
    pub local_relative_path: String,
    pub remote_path: Option<String>,
    pub encryption_key_id: Option<String>,
    pub sync_state: String,
    pub last_error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub task_id: String,
    pub kind: String,
    pub blob_id: Option<String>,
    pub display_name: String,
    pub original_name: Option<String>,
    pub external_url: Option<String>,
    pub content_sha256: Option<String>,
    pub size_bytes: Option<i64>,
    pub mime_type: Option<String>,
    pub local_relative_path: Option<String>,
    pub remote_path: Option<String>,
    pub encryption_key_id: Option<String>,
    pub sync_state: Option<String>,
    pub last_error: Option<String>,
    pub local_path: Option<String>,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAttachmentInput {
    pub task_id: String,
    pub source_path: String,
    pub display_name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWebLinkAttachmentInput {
    pub task_id: String,
    pub url: String,
    pub display_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentQueryInput {
    pub task_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentTransferStatus {
    pub pending_upload: i64,
    pub pending_download: i64,
    pub failed: i64,
    pub missing: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentDiagnostics {
    pub managed_count: i64,
    pub managed_bytes: i64,
    pub orphan_count: i64,
    pub orphan_bytes: i64,
    pub pending_upload: i64,
    pub pending_download: i64,
    pub failed: i64,
    pub missing: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskQueryInput {
    pub scope_kind: String,
    pub scope_value: String,
    pub query: Option<String>,
    pub sort_by: Option<String>,
    pub show_completed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskList {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub sort_order: i64,
    pub is_default: bool,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateListInput {
    pub name: String,
    pub color: Option<String>,
    pub sort_order: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateListInput {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Setting {
    pub key: String,
    pub value: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertSettingInput {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseStatus {
    pub database_path: String,
    pub schema_version: i64,
    pub list_count: i64,
    pub task_count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub state: String,
    pub configured: bool,
    pub has_credential: bool,
    pub server_url: Option<String>,
    pub remote_path: Option<String>,
    pub username: Option<String>,
    pub device_name: Option<String>,
    pub pending_changes: i64,
    pub conflict_count: i64,
    pub phase: Option<String>,
    pub last_sync_at: Option<String>,
    pub last_error: Option<String>,
    pub encryption_enabled: bool,
    pub encryption_key_available: bool,
    pub encryption_key_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncChange {
    pub id: String,
    pub entity: String,
    pub object_id: String,
    pub operation: String,
    pub base_revision: i64,
    pub revision: i64,
    pub payload_json: String,
    pub created_at: String,
    pub uploaded_at: Option<String>,
    pub remote_sequence: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncConflict {
    pub id: String,
    pub entity: String,
    pub object_id: String,
    pub local_revision: i64,
    pub remote_revision: i64,
    pub local_payload_json: String,
    pub remote_payload_json: String,
    pub detected_at: String,
    pub resolved_at: Option<String>,
    pub resolution: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncDevice {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub last_sync_at: Option<String>,
    pub last_remote_sequence: i64,
    pub enabled: bool,
    pub current: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncCleanupResult {
    pub changes_removed: i64,
    pub tombstones_removed: i64,
    pub attachment_blobs_removed: i64,
    pub attachment_bytes_removed: i64,
    pub remote_attachment_blobs_removed: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncRemoteInspection {
    pub initialized: bool,
    pub requires_confirmation: bool,
    pub unknown_entries: Vec<String>,
    pub encryption_enabled: bool,
    pub encryption_key_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEvent {
    pub id: String,
    pub title: String,
    pub event_type: String,
    pub start_date: String,
    pub end_date: String,
    pub note: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCalendarEventInput {
    pub title: String,
    pub event_type: String,
    pub start_date: String,
    pub end_date: String,
    pub note: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCalendarEventInput {
    pub id: String,
    pub title: String,
    pub event_type: String,
    pub start_date: String,
    pub end_date: String,
    pub note: Option<String>,
}
