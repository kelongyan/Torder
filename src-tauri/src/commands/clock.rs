use tauri::{AppHandle, Manager};
use crate::clock;

#[tauri::command]
pub fn toggle_clock(app: AppHandle) -> Result<bool, String> {
    let visible = clock::toggle_clock_window(&app).map_err(|error| error.to_string())?;
    crate::tray::set_clock_menu_checked(&app, visible);
    Ok(visible)
}

#[tauri::command]
pub fn set_clock_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    if enabled {
        clock::create_clock_window(&app).map_err(|error| error.to_string())?;
        clock::persist_clock_enabled(&app, true);
    } else {
        if let Some(window) = app.get_webview_window(clock::CLOCK_LABEL) {
            window.hide().map_err(|error| error.to_string())?;
        }
        clock::persist_clock_enabled(&app, false);
    }
    crate::tray::set_clock_menu_checked(&app, enabled);
    Ok(())
}

#[tauri::command]
pub fn patch_clock_settings(
    app: AppHandle,
    patch: serde_json::Value,
) -> Result<serde_json::Value, String> {
    clock::patch_clock_settings(&app, &patch)
}

#[tauri::command]
pub fn get_clock_settings(app: AppHandle) -> Result<clock::ClockSettings, String> {
    Ok(clock::read_clock_settings(&app))
}

