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
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("Torder（今序）")
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let database_path = app.path().app_data_dir()?.join("torder.sqlite");
            let database = Database::initialize(database_path)?;
            app.manage(database);
            tray::setup(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::get_app_info,
            commands::backup::export_backup,
            commands::backup::inspect_backup,
            commands::backup::restore_backup,
            commands::database::get_database_status,
            commands::task::create_task,
            commands::task::get_task,
            commands::task::list_tasks,
            commands::task::list_today_tasks,
            commands::task::list_completed_tasks,
            commands::task::list_overdue_tasks,
            commands::task::list_due_reminders,
            commands::task::query_tasks,
            commands::task::update_task,
            commands::task::delete_task,
            commands::task::set_task_completed,
            commands::task::mark_task_reminded,
            commands::task::snooze_task_reminder,
            commands::task::set_task_tags,
            commands::task::list_task_tag_ids,
            commands::list::list_lists,
            commands::list::create_list,
            commands::list::update_list,
            commands::list::delete_list,
            commands::tag::list_tags,
            commands::tag::create_tag,
            commands::tag::update_tag,
            commands::tag::delete_tag,
            commands::settings::list_settings,
            commands::settings::get_setting,
            commands::settings::upsert_setting,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Torder");
}
