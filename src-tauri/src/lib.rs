pub mod commands;
pub mod db;
pub mod error;
pub mod models;
mod notifier;
mod recurrence;
mod recurring_scheduler;
mod tray;

use tauri::Manager;

use db::Database;

fn run_startup_backup_if_enabled(app: tauri::AppHandle) {
    use db::settings_repository::SettingsRepository;

    let database = app.state::<Database>();
    let enabled = SettingsRepository::new(&database)
        .get("autoBackup")
        .ok()
        .flatten()
        .map(|setting| setting.value == "true")
        .unwrap_or(false);
    if !enabled {
        return;
    }
    let _ = commands::backup::backup_database_impl(&app);
}

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
            let database = Database::initialize(database_path.clone())?;
            recurring_scheduler::start(app.handle().clone(), database.clone());
            app.manage(database);
            notifier::start_notifier(app.handle().clone(), database_path);
            tray::setup(app)?;

            run_startup_backup_if_enabled(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::get_app_info,
            commands::app::open_download_page,
            commands::app::set_window_material_theme,
            commands::database::get_database_status,
            commands::backup::backup_database,
            commands::backup::export_tasks,
            commands::backup::list_backups,
            commands::backup::restore_backup,
            commands::task::create_task,
            commands::task::get_task,
            commands::task::query_tasks,
            commands::task::update_task,
            commands::task::delete_task,
            commands::task::set_task_completed,
            commands::recurring::list_recurring_rules,
            commands::recurring::create_recurring_rule,
            commands::recurring::update_recurring_rule,
            commands::recurring::set_recurring_rule_enabled,
            commands::recurring::skip_next_recurring_occurrence,
            commands::recurring::generate_next_recurring_occurrence,
            commands::recurring::delete_recurring_rule,
            commands::recurring::generate_due_recurring_tasks,
            commands::list::list_lists,
            commands::list::create_list,
            commands::list::update_list,
            commands::list::delete_list,
            commands::settings::list_settings,
            commands::settings::get_setting,
            commands::settings::upsert_setting,
            commands::calendar_event::list_calendar_events,
            commands::calendar_event::create_calendar_event,
            commands::calendar_event::update_calendar_event,
            commands::calendar_event::delete_calendar_event,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Torder");
}
