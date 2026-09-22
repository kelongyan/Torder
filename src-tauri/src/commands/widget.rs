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
/// 隐藏走淡出流程（W2-2），与托盘开关行为一致。
#[tauri::command]
pub fn set_widget_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    if enabled {
        widget::create_widget_window(&app).map_err(|error| error.to_string())?;
    } else {
        widget::request_widget_hide(&app);
    }
    Ok(())
}

/// 便签淡出动效播完后的落点：真正隐藏窗口（window 仍存活，下次 show 复用）。
/// 关窗按钮与托盘/设置开关的 `widget-hide-request` 流程共用。
#[tauri::command]
pub fn hide_widget_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(widget::WIDGET_LABEL) {
        window.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// 便签磨砂玻璃（Acrylic）。enabled=true 在 widget 窗口后面开启 SWCA Acrylic
/// 模糊（tint 用深色磨砂暗调 RGB(20, 24, 30)，alpha 即透明度旋钮 0–1 → 0–255，真生效）；
/// false 清除材质恢复不透明纸面。走自实现 SWCA（`crate::acrylic`）而非
/// window-vibrancy：后者在 Win11 22H2+ 走 SYSTEMBACKDROP 路线忽略 tint color，
/// 导致旋钮失灵且背板不渲染（2026-09-09 真机实锤后替换）。仅 Windows 10
/// v1809+ 生效，其它平台与 widget 窗口不存在时均为 no-op（前端按
/// noteTheme === "glass" 决定 enabled）。
/// 已知退化：Win10 v1903+/Win11 拖动窗口会卡顿（未公开 API 缺陷），
/// 见 docx/widget-glass-mode-plan-2026-09-09.md §4。
#[tauri::command]
pub fn set_widget_glass(app: AppHandle, enabled: bool, alpha: f64) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let Some(window) = app.get_webview_window(widget::WIDGET_LABEL) else {
            return Ok(());
        };
        let hwnd = window.hwnd().map_err(|error| error.to_string())?.0 as isize;
        if enabled {
            // SWCA Acrylic 的 tint_alpha 控制系统底板遮罩权重：全额 255 会糊成死黑实心板；
            // 折算到 0–120 区间（默认 0.5 对应 60 遮罩），保留充足通透感同时激发 DWM 磨砂模糊
            let tint_alpha = (alpha.clamp(0.0, 1.0) * 120.0).round() as u8;
            crate::acrylic::apply_acrylic(hwnd, (18, 22, 28, tint_alpha))?;
        } else {
            crate::acrylic::clear_acrylic(hwnd)?;
        }
    }

    #[cfg(not(target_os = "windows"))]
    let _ = (app, enabled, alpha);

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
