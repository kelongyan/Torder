use tauri::State;

use crate::db::recurring_repository::RecurringRuleRepository;
use crate::db::Database;
use crate::models::{
    CreateRecurringRuleInput, RecurringGenerationResult, RecurringRule, UpdateRecurringRuleInput,
};

#[tauri::command]
pub fn list_recurring_rules(database: State<'_, Database>) -> Result<Vec<RecurringRule>, String> {
    RecurringRuleRepository::new(&database)
        .list()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn create_recurring_rule(
    database: State<'_, Database>,
    input: CreateRecurringRuleInput,
) -> Result<RecurringRule, String> {
    let repository = RecurringRuleRepository::new(&database);
    let rule = repository
        .create(input)
        .map_err(|error| error.to_string())?;
    repository
        .generate_due()
        .map_err(|error| error.to_string())?;
    repository.get(&rule.id).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn update_recurring_rule(
    database: State<'_, Database>,
    input: UpdateRecurringRuleInput,
) -> Result<RecurringRule, String> {
    let repository = RecurringRuleRepository::new(&database);
    let rule = repository
        .update(input)
        .map_err(|error| error.to_string())?;
    repository
        .generate_due()
        .map_err(|error| error.to_string())?;
    repository.get(&rule.id).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn set_recurring_rule_enabled(
    database: State<'_, Database>,
    id: String,
    enabled: bool,
) -> Result<RecurringRule, String> {
    RecurringRuleRepository::new(&database)
        .set_enabled(&id, enabled)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn skip_next_recurring_occurrence(
    database: State<'_, Database>,
    id: String,
) -> Result<RecurringRule, String> {
    RecurringRuleRepository::new(&database)
        .skip_next(&id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn generate_next_recurring_occurrence(
    database: State<'_, Database>,
    id: String,
) -> Result<RecurringGenerationResult, String> {
    RecurringRuleRepository::new(&database)
        .generate_next_now(&id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn delete_recurring_rule(
    database: State<'_, Database>,
    id: String,
    delete_future_tasks: bool,
) -> Result<(), String> {
    RecurringRuleRepository::new(&database)
        .soft_delete(&id, delete_future_tasks)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn generate_due_recurring_tasks(
    database: State<'_, Database>,
) -> Result<RecurringGenerationResult, String> {
    RecurringRuleRepository::new(&database)
        .generate_due()
        .map_err(|error| error.to_string())
}
