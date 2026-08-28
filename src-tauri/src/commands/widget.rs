use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::ManagerExt;

use crate::db::settings_repository::SettingsRepository;
use crate::db::Database;
use crate::models::UpsertSettingInput;
use crate::tray;
use crate::widget;

/// 开关机自启动：先写系统注册表，成功后再持久化设置键（系统失败则不写，前端回滚开关）。
/// 每次启动时 `lib.rs` 会用当前 exe 路径对账自愈，修复安装目录变化后的路径漂移。
#[tauri::command]
pub fn set_launch_at_startup(app: AppHandle, enabled: bool) -> Result<(), String> {
    let manager = app.autolaunch();
    if enabled {
        manager.enable().map_err(|error| error.to_string())?;
    } else {
        manager.disable().map_err(|error| error.to_string())?;
    }
    let database = app.state::<Database>();
    SettingsRepository::new(&database)
        .upsert(UpsertSettingInput {
            key: "launchAtStartup".to_string(),
            value: enabled.to_string(),
        })
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn show_main_window(app: AppHandle) {
    tray::show_main_window(&app);
}

/// 设置面板开关用：显示/隐藏小窗。`enabled` 设置键由前端经 `patch_widget_settings` 写入。
#[tauri::command]
pub fn set_widget_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    if enabled {
        widget::create_widget_window(&app).map_err(|error| error.to_string())?;
    } else if let Some(window) = app.get_webview_window(widget::WIDGET_LABEL) {
        window.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// 原子 patch `widget` 设置键：读-改-写在 Rust 侧单条 IMMEDIATE 事务内完成，
/// 修复跨窗口（主窗设置开关 ↔ widget 窗几何防抖写）各自 get→merge→upsert
/// 互相吞字段的竞态；Rust `WidgetSettings` 未声明的前端字段（`anchorDate`）
/// 原样保留。返回合并后的完整 JSON 供前端归一化。
#[tauri::command]
pub fn patch_widget_settings(
    app: AppHandle,
    patch: serde_json::Value,
) -> Result<serde_json::Value, String> {
    widget::patch_widget_settings(&app, &patch)
}
