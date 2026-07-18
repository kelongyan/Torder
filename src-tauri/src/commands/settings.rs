use tauri::State;

use crate::db::settings_repository::SettingsRepository;
use crate::db::Database;
use crate::models::{Setting, UpsertSettingInput};

#[tauri::command]
pub fn list_settings(database: State<'_, Database>) -> Result<Vec<Setting>, String> {
    SettingsRepository::new(&database)
        .list()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_setting(database: State<'_, Database>, key: String) -> Result<Option<Setting>, String> {
    SettingsRepository::new(&database)
        .get(&key)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn upsert_setting(
    database: State<'_, Database>,
    input: UpsertSettingInput,
) -> Result<Setting, String> {
    SettingsRepository::new(&database)
        .upsert(input)
        .map_err(|error| error.to_string())
}
