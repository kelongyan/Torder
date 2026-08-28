use serde::Deserialize;
use tauri::{
    App, AppHandle, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};

use crate::db::settings_repository::SettingsRepository;
use crate::db::Database;

pub const WIDGET_LABEL: &str = "widget";
// 竖版便签：宽 280 / 默认高 360 / 最小 320 / 最大 560。
// 与 `src/services/widgetLayout.ts` 的常量保持口径一致。
// 高度由前端实测内容自然高度决定，MIN 320 用于保证任何内容量下都是竖版矩形。
const WIDGET_WIDTH: f64 = 280.0;
/// 初始高度占位。前端 `WidgetApp` 会按实测内容高度重设到
/// `[WIDGET_MIN_HEIGHT, MAX]` 之间；这里只给一个中等默认值。
const WIDGET_DEFAULT_HEIGHT: f64 = 360.0;
const WIDGET_MIN_HEIGHT: f64 = 320.0;
const WIDGET_MAX_HEIGHT: f64 = 560.0;
const EDGE_MARGIN: f64 = 24.0;
const TASKBAR_MARGIN: f64 = 64.0;

/// `widget` 设置键的 JSON 形状（前端 `widgetService.ts` 写入，两端字段须一致；
/// `anchorDate` 仅前端消费，serde 忽略未知字段，故此处不声明）。
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct WidgetSettings {
    pub enabled: bool,
    pub x: Option<f64>,
    pub y: Option<f64>,
}

pub fn read_widget_settings(app: &AppHandle) -> WidgetSettings {
    let database = app.state::<Database>();
    SettingsRepository::new(&database)
        .get("widget")
        .ok()
        .flatten()
        .and_then(|setting| serde_json::from_str(&setting.value).ok())
        .unwrap_or_default()
}

/// 只改 `enabled` 字段，保留 x/y/anchorDate（托盘开关与启动自愈共用）。
pub fn persist_widget_enabled(app: &AppHandle, enabled: bool) {
    use crate::models::UpsertSettingInput;

    let database = app.state::<Database>();
    let repository = SettingsRepository::new(&database);
    let mut value = repository
        .get("widget")
        .ok()
        .flatten()
        .and_then(|setting| serde_json::from_str::<serde_json::Value>(&setting.value).ok())
        .filter(serde_json::Value::is_object)
        .unwrap_or_else(|| serde_json::json!({}));
    value["enabled"] = serde_json::Value::Bool(enabled);
    if let Err(error) = repository.upsert(UpsertSettingInput {
        key: "widget".to_string(),
        value: value.to_string(),
    }) {
        eprintln!("widget enabled persistence failed: {error}");
    }
}

pub fn setup(app: &mut App) -> tauri::Result<()> {
    if read_widget_settings(app.handle()).enabled {
        if let Err(error) = create_widget_window(app.handle()) {
            eprintln!("widget window creation failed: {error}");
        }
    }
    Ok(())
}

pub fn create_widget_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(WIDGET_LABEL) {
        normalize_existing_widget_size(&window)?;
        window.show()?;
        return window.set_focus();
    }

    let settings = read_widget_settings(app);
    let position = resolve_position(app, settings.x, settings.y);
    let window = WebviewWindowBuilder::new(
        app,
        WIDGET_LABEL,
        WebviewUrl::App("index.html#widget".into()),
    )
    .title("Torder 桌面小窗")
    .inner_size(WIDGET_WIDTH, WIDGET_DEFAULT_HEIGHT)
    .min_inner_size(WIDGET_WIDTH, WIDGET_MIN_HEIGHT)
    .position(position.x, position.y)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .skip_taskbar(true)
    // 便签输入框不需要 WebView2 的「保存的信息」下拉（表单历史 + 个人信息建议）。
    // 权威开关在这里：Tauri 文档指出 WebView2 的 Suggestions 在某些情况下不遵守
    // DOM 上的 autocomplete="off"（前端那行只当字段级提示）。
    .general_autofill_enabled(false)
    .visible(true)
    .build()?;

    let window_to_hide = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = window_to_hide.hide();
        }
    });
    Ok(())
}

/// 开发热更新或版本升级时，小窗可能仍保留横版时代的 360 宽。
/// 重新显示前按当前布局校准，并固定右下角，避免尺寸变化后跑出屏幕。
fn normalize_existing_widget_size(window: &WebviewWindow) -> tauri::Result<()> {
    let scale = window.scale_factor()?;
    let size = window.outer_size()?.to_logical::<f64>(scale);
    let position = window.outer_position()?.to_logical::<f64>(scale);
    let height = size.height.clamp(WIDGET_MIN_HEIGHT, WIDGET_MAX_HEIGHT);

    window.set_size(LogicalSize::new(WIDGET_WIDTH, height))?;
    window.set_position(LogicalPosition::new(
        position.x + size.width - WIDGET_WIDTH,
        position.y + size.height - height,
    ))?;
    Ok(())
}

/// 切换小窗可见性；窗口不存在时按需创建。返回切换后是否可见。
/// 托盘菜单路径：同时持久化 enabled，重启后按此恢复。
pub fn toggle_widget_window(app: &AppHandle) -> tauri::Result<bool> {
    if let Some(window) = app.get_webview_window(WIDGET_LABEL) {
        let visible = window.is_visible().unwrap_or(false);
        if visible {
            window.hide()?;
        } else {
            normalize_existing_widget_size(&window)?;
            window.show()?;
            window.set_focus()?;
        }
        persist_widget_enabled(app, !visible);
        return Ok(!visible);
    }
    create_widget_window(app)?;
    persist_widget_enabled(app, true);
    Ok(true)
}

pub fn is_widget_visible(app: &AppHandle) -> bool {
    app.get_webview_window(WIDGET_LABEL)
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false)
}

/// 保存坐标落在任一显示器逻辑矩形内则恢复，否则兜底主屏右下角。
/// monitor.size 含任务栏，无 work-area API，底部留边距近似。
fn resolve_position(
    app: &AppHandle,
    saved_x: Option<f64>,
    saved_y: Option<f64>,
) -> LogicalPosition<f64> {
    let monitors = app.available_monitors().unwrap_or_default();

    if let (Some(x), Some(y)) = (saved_x, saved_y) {
        for monitor in &monitors {
            let scale = monitor.scale_factor();
            let left = monitor.position().x as f64 / scale;
            let top = monitor.position().y as f64 / scale;
            let right = left + monitor.size().width as f64 / scale;
            let bottom = top + monitor.size().height as f64 / scale;
            if x >= left && y >= top && x < right && y < bottom {
                // 存档可能是旧版更宽 / 更矮窗口下的坐标，按当前尺寸收敛进边界
                return LogicalPosition::new(
                    x.min(right - WIDGET_WIDTH - EDGE_MARGIN),
                    y.min(bottom - WIDGET_DEFAULT_HEIGHT - TASKBAR_MARGIN),
                );
            }
        }
    }

    let fallback = monitors
        .iter()
        .find(|monitor| monitor.position().x == 0 && monitor.position().y == 0)
        .or(monitors.first());
    let Some(monitor) = fallback else {
        return LogicalPosition::new(EDGE_MARGIN, EDGE_MARGIN);
    };
    let scale = monitor.scale_factor();
    let left = monitor.position().x as f64 / scale;
    let top = monitor.position().y as f64 / scale;
    let width = monitor.size().width as f64 / scale;
    let height = monitor.size().height as f64 / scale;
    LogicalPosition::new(
        left + width - WIDGET_WIDTH - EDGE_MARGIN,
        top + height - WIDGET_DEFAULT_HEIGHT - TASKBAR_MARGIN,
    )
}
