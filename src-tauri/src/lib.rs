mod commands;
mod db;
mod error;
mod models;
mod tray;

use tauri::Manager;

use db::Database;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(target_os = "windows")]
            if let Some(window) = app.get_webview_window("main") {
                if let Err(error) = window_vibrancy::apply_mica(&window, None) {
                    eprintln!("Windows Mica is unavailable; using CSS glass fallback: {error}");
                }
            }

            let database_path = app.path().app_data_dir()?.join("torder.sqlite");
            let database = Database::initialize(database_path)?;
            app.manage(database);
            tray::setup(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::get_app_info,
            commands::app::set_window_material_theme,
            commands::database::get_database_status,
            commands::task::create_task,
            commands::task::get_task,
            commands::task::query_tasks,
            commands::task::update_task,
            commands::task::delete_task,
            commands::task::set_task_completed,
            commands::list::list_lists,
            commands::list::create_list,
            commands::list::update_list,
            commands::list::delete_list,
            commands::settings::list_settings,
            commands::settings::get_setting,
            commands::settings::upsert_setting,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Torder");
}
