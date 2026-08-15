use tauri::State;

use crate::db::calendar_event_repository::CalendarEventRepository;
use crate::db::Database;
use crate::models::{CalendarEvent, CreateCalendarEventInput, UpdateCalendarEventInput};

#[tauri::command]
pub fn list_calendar_events(
    database: State<'_, Database>,
) -> Result<Vec<CalendarEvent>, String> {
    CalendarEventRepository::new(&database)
        .list()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn create_calendar_event(
    database: State<'_, Database>,
    input: CreateCalendarEventInput,
) -> Result<CalendarEvent, String> {
    CalendarEventRepository::new(&database)
        .create(input)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn update_calendar_event(
    database: State<'_, Database>,
    input: UpdateCalendarEventInput,
) -> Result<CalendarEvent, String> {
    CalendarEventRepository::new(&database)
        .update(input)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn delete_calendar_event(
    database: State<'_, Database>,
    id: String,
) -> Result<(), String> {
    CalendarEventRepository::new(&database)
        .soft_delete(&id)
        .map_err(|error| error.to_string())
}