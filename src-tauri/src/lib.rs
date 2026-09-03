pub mod backup;
pub mod commands;
pub mod db;
pub mod error;
#[cfg(desktop)]
mod mini;
pub mod models;
mod recurrence;
pub mod runtime;
pub mod sync;
#[cfg(desktop)]
mod tray;
#[cfg(desktop)]
mod widget;

use tauri::Manager;

use db::Database;

#[cfg(target_os = "android")]
fn initialize_android_tls_verifier() -> Result<(), jni::errors::Error> {
    use jni::{objects::JObject, JavaVM};

    let ctx = ndk_context::android_context();
    let vm = ctx.vm() as *mut jni::sys::JavaVM;
    let java_vm = unsafe { JavaVM::from_raw(vm) };
    java_vm.attach_current_thread(|env| {
        let context = unsafe { JObject::from_raw(env, ctx.context() as jni::sys::jobject) };
        rustls_platform_verifier::android::init_with_env(env, context)
    })
}

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
    let _ = backup::backup_database(&app, &database);
}

fn run_trash_cleanup_if_configured(app: tauri::AppHandle) {
    use db::settings_repository::SettingsRepository;
    use db::task_repository::TaskRepository;

    let database = app.state::<Database>();
    let retention_days = SettingsRepository::new(&database)
        .get("trashRetentionDays")
        .ok()
        .flatten()
        .and_then(|setting| serde_json::from_str::<Option<i64>>(&setting.value).ok())
        .flatten()
        .filter(|days| *days >= 0);
    let Some(retention_days) = retention_days else {
        return;
    };
    if let Err(error) = TaskRepository::new(&database).cleanup_trash(retention_days) {
        eprintln!("trash cleanup failed: {error}");
    }
}

#[cfg(desktop)]
fn setup_global_quick_add(app: &tauri::App) -> tauri::Result<()> {
    use tauri::Emitter;
    use tauri_plugin_global_shortcut::{
        Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
    };

    let quick_add = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyT);
    let mini_add = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyM);
    app.handle().plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |app, shortcut, event| {
                if shortcut == &quick_add && event.state() == ShortcutState::Pressed {
                    tray::show_main_window(app);
                    let _ = app.emit("tray-quick-add", ());
                }
                if shortcut == &mini_add && event.state() == ShortcutState::Pressed {
                    if let Err(error) = mini::toggle_mini_window(app) {
                        eprintln!("mini window toggle failed: {error}");
                    }
                }
            })
            .build(),
    )?;
    app.global_shortcut()
        .register(quick_add)
        .unwrap_or_else(|error| eprintln!("global shortcut register failed: {error}"));
    app.global_shortcut()
        .register(mini_add)
        .unwrap_or_else(|error| eprintln!("global shortcut register failed: {error}"));
    Ok(())
}

/// 开机自启动自愈：设置键与系统注册表实际状态对账。
/// 安装目录变化后 Run 键指向失效路径，此处用当前 exe 路径重写。
#[cfg(desktop)]
fn reconcile_launch_at_startup(app: &tauri::AppHandle) {
    use db::settings_repository::SettingsRepository;
    use tauri_plugin_autostart::ManagerExt;

    let enabled = SettingsRepository::new(&app.state::<Database>())
        .get("launchAtStartup")
        .ok()
        .flatten()
        .map(|setting| setting.value == "true")
        .unwrap_or(false);
    let manager = app.autolaunch();
    match (enabled, manager.is_enabled()) {
        (true, Ok(false)) => {
            if let Err(error) = manager.enable() {
                eprintln!("autostart self-heal enable failed: {error}");
            }
        }
        (false, Ok(true)) => {
            if let Err(error) = manager.disable() {
                eprintln!("autostart self-heal disable failed: {error}");
            }
        }
        (_, Err(error)) => eprintln!("autostart state check failed: {error}"),
        _ => {}
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init());

    // 开机自启动仅桌面平台可用；--silent 使开机拉起时静默驻留托盘
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_autostart::init(
        tauri_plugin_autostart::MacosLauncher::LaunchAgent,
        Some(vec!["--silent"]),
    ));

    builder
        .setup(|app| {
            #[cfg(target_os = "android")]
            initialize_android_tls_verifier().map_err(|error| {
                std::io::Error::other(format!(
                    "Android TLS verifier initialization failed: {error}"
                ))
            })?;

            #[cfg(target_os = "windows")]
            if let Some(window) = app.get_webview_window("main") {
                if let Err(error) = window_vibrancy::apply_mica(&window, None) {
                    eprintln!("Windows Mica is unavailable; using CSS glass fallback: {error}");
                }
            }

            let database_path = app.path().app_data_dir()?.join("torder.sqlite");
            let database = Database::initialize(database_path.clone())?;
            runtime::scheduler::start(app.handle().clone(), database.clone());
            app.manage(database);
            app.manage(sync::SyncRuntime::default());
            runtime::notifier::start_notifier(app.handle().clone(), database_path);
            #[cfg(desktop)]
            reconcile_launch_at_startup(app.handle());
            #[cfg(desktop)]
            tray::setup(app)?;
            #[cfg(desktop)]
            setup_global_quick_add(app)?;
            #[cfg(desktop)]
            {
                widget::setup(app)?;
                tray::set_widget_menu_checked(
                    app.handle(),
                    widget::is_widget_visible(app.handle()),
                );
                // 开机自启动以 --silent 拉起：静默驻留托盘，不弹主窗口
                if std::env::args().any(|arg| arg == "--silent") {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.hide();
                    }
                }
            }

            let backup_handle = app.handle().clone();
            std::thread::spawn(move || run_startup_backup_if_enabled(backup_handle));
            run_trash_cleanup_if_configured(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::get_app_info,
            commands::app::set_window_material_theme,
            commands::database::get_database_status,
            commands::focus::notify_focus_finished,
            commands::backup::backup_database,
            commands::backup::export_tasks,
            commands::backup::list_backups,
            commands::backup::preview_backup_import,
            commands::backup::import_backup_selection,
            commands::backup::restore_backup,
            commands::attachment::list_task_attachments,
            commands::attachment::count_task_attachments,
            commands::attachment::add_managed_attachment,
            commands::attachment::add_local_attachment_reference,
            commands::attachment::add_web_link_attachment,
            commands::attachment::delete_attachment,
            commands::attachment::open_attachment,
            commands::attachment::reveal_attachment,
            commands::attachment::get_attachment_transfer_status,
            commands::task::create_task,
            commands::task::get_task,
            commands::task::query_tasks,
            commands::task::query_tasks_for_date,
            commands::task::update_task,
            commands::task::snooze_task_reminder,
            commands::task::delete_task,
            commands::task::set_task_completed,
            commands::task::restore_task,
            commands::task::permanent_delete_task,
            commands::task::empty_trash,
            commands::task::cleanup_trash,
            commands::task_link::list_task_links,
            commands::task_link::create_task_link,
            commands::task_link::delete_task_link,
            commands::task_link::search_linkable_tasks,
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
            commands::sync::get_sync_status,
            commands::sync::list_pending_sync_changes,
            commands::sync::list_sync_conflicts,
            commands::sync::list_sync_devices,
            commands::sync::revoke_sync_device,
            commands::sync::cleanup_sync_history,
            commands::sync::export_sync_diagnostics,
            commands::sync::resolve_sync_conflict,
            commands::sync::test_sync_connection,
            commands::sync::save_sync_config,
            commands::sync::remove_sync_config,
            commands::sync::rotate_sync_encryption,
            commands::sync::run_sync,
            commands::calendar_event::list_calendar_events,
            commands::calendar_event::create_calendar_event,
            commands::calendar_event::update_calendar_event,
            commands::calendar_event::delete_calendar_event,
            #[cfg(desktop)]
            commands::widget::set_launch_at_startup,
            #[cfg(desktop)]
            commands::widget::show_main_window,
            #[cfg(desktop)]
            commands::widget::set_widget_enabled,
            #[cfg(desktop)]
            commands::widget::patch_widget_settings,
            #[cfg(desktop)]
            commands::widget::import_note_font,
            #[cfg(desktop)]
            commands::widget::read_note_font_bytes,
            #[cfg(desktop)]
            commands::mini::toggle_mini,
            commands::tag::manage_tag,
            #[cfg(desktop)]
            commands::widget::remove_note_font,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Torder");
}
