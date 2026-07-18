use tauri::State;

use crate::db::Database;
use crate::models::DatabaseStatus;

#[tauri::command]
pub fn get_database_status(database: State<'_, Database>) -> Result<DatabaseStatus, String> {
    database.status().map_err(|error| error.to_string())
}
