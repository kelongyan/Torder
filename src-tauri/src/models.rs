use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    pub note: Option<String>,
    pub status: String,
    pub priority: i64,
    pub list_id: String,
    pub due_at: Option<String>,
    pub completed_at: Option<String>,
    pub sort_order: i64,
    pub remind_before: Option<i64>,
    pub remind_at: Option<String>,
    pub reminded_at: Option<String>,
    pub repeat_rule: Option<String>,
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
    pub due_at: Option<String>,
    pub sort_order: Option<i64>,
    pub remind_before: Option<i64>,
    pub repeat_rule: Option<String>,
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
    pub due_at: Option<String>,
    pub sort_order: i64,
    pub remind_before: Option<i64>,
    pub repeat_rule: Option<String>,
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
