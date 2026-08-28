use serde::Deserialize;
use tauri::{
    App, AppHandle, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};

use crate::db::settings_repository::SettingsRepository;
use crate::db::Database;

pub const WIDGET_LABEL: &str = "widget";
// 竖版便签尺寸区间：宽 240–480（默认 280）/ 高 320–560（默认 360）。
// 与 `src/services/widgetLayout.ts` 的常量保持口径一致，改这里要同步改那边。
// MIN 320 用于保证任何内容量下都是竖版矩形。
//
// 尺寸有两种模式，由 `widget` 设置键的 `sizeMode` 决定（仅前端消费）：
// - "auto"（默认）：高度由前端实测内容自然高度决定，w/h 不落盘；
// - "manual"：用户拖过 resize 手柄，尺寸由落盘的 w/h 决定，前端不再自动改高。
//
// min/max 交给窗口自身声明（而不是只在前端夹取）：拖拽过程中前端没有介入机会，
// 必须让 OS 在拖动时就把尺寸限在区间内；这同时也约束了 Aero Snap 能吸成多大。
const WIDGET_DEFAULT_WIDTH: f64 = 280.0;
const WIDGET_MIN_WIDTH: f64 = 240.0;
const WIDGET_MAX_WIDTH: f64 = 480.0;
/// 初始高度占位。auto 模式下前端 `WidgetApp` 会按实测内容高度重设到
/// `[WIDGET_MIN_HEIGHT, MAX]` 之间；这里只给一个中等默认值。
const WIDGET_DEFAULT_HEIGHT: f64 = 360.0;
const WIDGET_MIN_HEIGHT: f64 = 320.0;
const WIDGET_MAX_HEIGHT: f64 = 560.0;
const EDGE_MARGIN: f64 = 24.0;
const TASKBAR_MARGIN: f64 = 64.0;

/// `widget` 设置键的 JSON 形状（前端 `widgetService.ts` 写入，两端字段须一致；
/// `anchorDate` / `sizeMode` 仅前端消费，serde 忽略未知字段，故此处不声明）。
///
/// `w`/`h` 只在 manual 模式下由前端写入、切回 auto 时清空。所以这里"有值就用"
/// 是安全的：不会出现按陈旧尺寸建窗、前端再跳一下的闪烁。
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct WidgetSettings {
    pub enabled: bool,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub w: Option<f64>,
    pub h: Option<f64>,
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

/// `widget` 设置键的读-改-写单点：在一条 IMMEDIATE 事务内完成
/// 「读当前 JSON → 按字段合并 patch → 写回」。主窗设置开关与 widget 窗几何
/// 防抖写分属两个窗口，此前各自 get→merge→upsert 并发执行、互相吞字段；
/// 现在两侧都经由此函数串行化。`WidgetSettings` 未声明、仅前端消费的字段
/// （如 `anchorDate`）原样保留，patch 中显式给出的字段（含 null）覆盖。
///
/// upsert SQL 须与 `settings_repository::upsert` 保持一致，改一处要同步另一处。
pub fn patch_widget_settings(
    app: &AppHandle,
    patch: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    use rusqlite::{params, OptionalExtension, TransactionBehavior};

    let patch_map = patch
        .as_object()
        .ok_or_else(|| "widget settings patch must be a JSON object".to_string())?;

    let database = app.state::<Database>();
    let mut connection = database.connect().map_err(|error| error.to_string())?;
    // IMMEDIATE：先拿写锁再读取，保证并发 patch 在这里完全串行
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;

    let current = transaction
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params!["widget"],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;

    let mut value = current
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .filter(serde_json::Value::is_object)
        .unwrap_or_else(|| serde_json::json!({}));
    let merged = value
        .as_object_mut()
        .expect("value is checked to be an object above");
    for (key, field) in patch_map {
        merged.insert(key.clone(), field.clone());
    }

    transaction
        .execute(
            r#"
            INSERT INTO settings (key, value) VALUES (?1, ?2)
            ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            "#,
            params!["widget", value.to_string()],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(value)
}

/// 只改 `enabled` 字段，保留 x/y/anchorDate（托盘开关与启动自愈共用）。
/// 走 `patch_widget_settings` 共享同一个原子合并点。
pub fn persist_widget_enabled(app: &AppHandle, enabled: bool) {
    if let Err(error) = patch_widget_settings(app, &serde_json::json!({ "enabled": enabled })) {
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
    let size = resolve_size(settings.w, settings.h);
    let position = resolve_position(app, settings.x, settings.y, size);
    let window = WebviewWindowBuilder::new(
        app,
        WIDGET_LABEL,
        WebviewUrl::App("index.html#widget".into()),
    )
    .title("Torder 桌面小窗")
    .inner_size(size.width, size.height)
    .min_inner_size(WIDGET_MIN_WIDTH, WIDGET_MIN_HEIGHT)
    .max_inner_size(WIDGET_MAX_WIDTH, WIDGET_MAX_HEIGHT)
    .position(position.x, position.y)
    .resizable(true)
    // 必须显式禁用最大化。Tauri 注入的 drag.js 在拖拽区上双击时发
    // `internal_toggle_maximize`，而该命令的实现是
    // `if is_resizable() { if is_maximizable() { maximize() } }`——
    // 换句话说，此前保护便签不被双击铺满全屏的正是 resizable(false)。
    // 现在为了鼠标拉伸打开了 resizable，就必须由 maximizable(false) 接管这道防线，
    // 否则在纸面（整张纸都是 data-tauri-drag-region="deep"）上双击就会最大化。
    .maximizable(false)
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

/// 存档尺寸 → 合法窗口尺寸。缺字段走默认值，有值则夹进区间。
fn resolve_size(saved_w: Option<f64>, saved_h: Option<f64>) -> LogicalSize<f64> {
    LogicalSize::new(
        saved_w
            .filter(|value| value.is_finite())
            .unwrap_or(WIDGET_DEFAULT_WIDTH)
            .clamp(WIDGET_MIN_WIDTH, WIDGET_MAX_WIDTH),
        saved_h
            .filter(|value| value.is_finite())
            .unwrap_or(WIDGET_DEFAULT_HEIGHT)
            .clamp(WIDGET_MIN_HEIGHT, WIDGET_MAX_HEIGHT),
    )
}

/// 版本升级后，小窗可能仍保留旧布局时代的尺寸（例如横版时代的 360 宽，
/// 或早于尺寸区间收窄前的存档）。重新显示前把两维各自夹进当前合法区间，
/// 并固定右下角，避免尺寸变化后跑出屏幕。
///
/// 注意：宽度现在归用户管（manual 模式），所以这里只做"夹取"，
/// 不再像早期那样把宽度强行拉回某个固定值。
fn normalize_existing_widget_size(window: &WebviewWindow) -> tauri::Result<()> {
    let scale = window.scale_factor()?;
    let size = window.outer_size()?.to_logical::<f64>(scale);
    let position = window.outer_position()?.to_logical::<f64>(scale);
    let width = size.width.clamp(WIDGET_MIN_WIDTH, WIDGET_MAX_WIDTH);
    let height = size.height.clamp(WIDGET_MIN_HEIGHT, WIDGET_MAX_HEIGHT);
    if (width - size.width).abs() < 1.0 && (height - size.height).abs() < 1.0 {
        return Ok(());
    }

    window.set_size(LogicalSize::new(width, height))?;
    window.set_position(LogicalPosition::new(
        position.x + size.width - width,
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
///
/// `size` 必须是本次实际建窗尺寸（而不是默认值常量）：恢复一个被拉到 480×560
/// 的便签时，用默认尺寸算收敛边界会把它推出屏幕右下角。
fn resolve_position(
    app: &AppHandle,
    saved_x: Option<f64>,
    saved_y: Option<f64>,
    size: LogicalSize<f64>,
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
                    x.min(right - size.width - EDGE_MARGIN),
                    y.min(bottom - size.height - TASKBAR_MARGIN),
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
        left + width - size.width - EDGE_MARGIN,
        top + height - size.height - TASKBAR_MARGIN,
    )
}
