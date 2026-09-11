use serde::{Deserialize, Serialize};
use tauri::{
    App, AppHandle, LogicalPosition, LogicalSize, Manager, WebviewUrl,
    WebviewWindowBuilder, WindowEvent,
};

use crate::db::settings_repository::SettingsRepository;
use crate::db::Database;

pub const CLOCK_LABEL: &str = "clock";
// 时钟挂件是横版可拉伸挂件（巨字时间 + 日期）。尺寸区间与
// `src/services/clockService.ts` 的口径保持一致，改这里要同步改那边。
//
// min/max 交给窗口自身声明，而不是只在前端夹取：拖拽过程中前端没有介入机会，
// 必须让 OS 在拖动时就把尺寸限在区间内；这同时也约束了 Aero Snap 能吸成多大。
const CLOCK_DEFAULT_WIDTH: f64 = 320.0;
const CLOCK_MIN_WIDTH: f64 = 200.0;
const CLOCK_MAX_WIDTH: f64 = 720.0;
const CLOCK_DEFAULT_HEIGHT: f64 = 180.0;
const CLOCK_MIN_HEIGHT: f64 = 120.0;
const CLOCK_MAX_HEIGHT: f64 = 480.0;
const EDGE_MARGIN: f64 = 24.0;
const TOP_MARGIN: f64 = 48.0;

#[derive(Deserialize, Serialize, Default, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct ClockSettings {
    pub enabled: bool,
    pub x: Option<f64>,
    pub y: Option<f64>,
    /// 手动拉伸后的窗口尺寸（逻辑像素）。由前端在 resize 结束后写入；
    /// 无值（或值非法）时回落到默认尺寸建窗。
    pub w: Option<f64>,
    pub h: Option<f64>,
    pub always_on_top: Option<bool>,
    pub locked: Option<bool>,
}

pub fn read_clock_settings(app: &AppHandle) -> ClockSettings {
    let database = app.state::<Database>();
    SettingsRepository::new(&database)
        .get("clock")
        .ok()
        .flatten()
        .and_then(|setting| serde_json::from_str(&setting.value).ok())
        .unwrap_or_default()
}

pub fn patch_clock_settings(
    app: &AppHandle,
    patch: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    use rusqlite::{params, OptionalExtension, TransactionBehavior};

    let patch_map = patch
        .as_object()
        .ok_or_else(|| "clock settings patch must be a JSON object".to_string())?;

    let database = app.state::<Database>();
    let mut connection = database.connect().map_err(|error| error.to_string())?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;

    let current = transaction
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params!["clock"],
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
            params!["clock", value.to_string()],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(value)
}

pub fn persist_clock_enabled(app: &AppHandle, enabled: bool) {
    if let Err(error) = patch_clock_settings(app, &serde_json::json!({ "enabled": enabled })) {
        eprintln!("clock enabled persistence failed: {error}");
    }
}

pub fn setup(app: &mut App) -> tauri::Result<()> {
    if read_clock_settings(app.handle()).enabled {
        if let Err(error) = create_clock_window(app.handle()) {
            eprintln!("clock window creation failed: {error}");
        }
    }
    Ok(())
}

/// 摘除时钟窗口原生装饰残迹所需的 DWM 调用。raw-dylib 直接生成导入桩，
/// 不必为一个符号引入 windows crate 依赖（acrylic.rs 同思路；那边因
/// SetWindowCompositionAttribute 未公开才被迫走 LoadLibrary 动态解析）。
#[cfg(target_os = "windows")]
mod win32 {
    use core::ffi::c_void;
    use core::mem::size_of;

    #[link(name = "dwmapi", kind = "raw-dylib")]
    extern "system" {
        fn DwmSetWindowAttribute(
            hwnd: isize,
            attribute: u32,
            value: *const c_void,
            size: u32,
        ) -> i32;
    }

    /// DWMWA_BORDER_COLOR（Win11 build 22000+）：窗口 1px 边框颜色。
    const DWMWA_BORDER_COLOR: u32 = 34;
    /// DWMWA_COLOR_NONE：哨兵值而非颜色，表示「完全不画边框」。
    const DWMWA_COLOR_NONE: u32 = 0xFFFF_FFFE;

    /// 摘掉 Win11 给带 WS_CAPTION 样式的窗口画的 1px DWM 边框。tao 的
    /// 无边框窗口为保住 DWM 动画/贴靠语义在 HWND 上保留了 WS_CAPTION，
    /// `.shadow(false)` 只能摘掉 WM_NCCALCSIZE 的客户区内缩，管不到这圈
    /// 描边。Win10 不认识该属性，调用失败静默忽略（那时也没有这圈边框）。
    pub fn remove_dwm_border(hwnd: isize) {
        let color = DWMWA_COLOR_NONE;
        let _ = unsafe {
            DwmSetWindowAttribute(
                hwnd,
                DWMWA_BORDER_COLOR,
                &color as *const u32 as *const c_void,
                size_of::<u32>() as u32,
            )
        };
    }
}

/// 剥掉时钟窗口的原生装饰残迹（Win11 1px DWM 边框）。
///
/// 反面教训（2026-09-10，别再踩）：曾试图用 `SetWindowRgn` 圆角区域把
/// 窗口裁成与 `.clock-shell` 一致的圆角——透明 WebView 的透明像素 RGB
/// 是白色、alpha 为 0，区域边界把它们从预乘合成的中途切断，沿整条区域
/// 轮廓露出一圈半透明白边（深色壁纸上格外刺眼，正是「包裹时钟的透明
/// 容器」投诉的最后一层来源）；且 SetWindowRgn 还会连带把
/// DWMWA_BORDER_COLOR 重置回默认。纸面圆角由 CSS border-radius + 真实
/// 透明天然完成，这里只需要摘边框——**不要给透明挂件上窗口区域**。
#[cfg(target_os = "windows")]
fn strip_native_frame(window: &tauri::WebviewWindow) {
    if let Ok(hwnd) = window.hwnd() {
        win32::remove_dwm_border(hwnd.0 as isize);
    }
}

pub fn create_clock_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(CLOCK_LABEL) {
        window.show()?;
        return window.set_focus();
    }

    let settings = read_clock_settings(app);
    let size = resolve_size(settings.w, settings.h);
    let position = resolve_position(app, settings.x, settings.y, size);
    let window = WebviewWindowBuilder::new(
        app,
        CLOCK_LABEL,
        WebviewUrl::App("index.html#clock".into()),
    )
    .title("Torder 桌面时钟")
    .inner_size(size.width, size.height)
    .min_inner_size(CLOCK_MIN_WIDTH, CLOCK_MIN_HEIGHT)
    .max_inner_size(CLOCK_MAX_WIDTH, CLOCK_MAX_HEIGHT)
    .position(position.x, position.y)
    // 可鼠标拉伸。注意 maximizable(false) 在这里不是装饰而是承重结构：
    // Tauri 注入的 drag.js 在拖拽区上双击会发 internal_toggle_maximize，
    // 而该命令的门槛是 `is_resizable() && is_maximizable()`。打开 resizable
    // 之后，挡住「双击挂件被拉成整屏」的就只剩 maximizable(false)。
    .resizable(true)
    .maximizable(false)
    .decorations(false)
    .transparent(true)
    // 必须显式关闭阴影。tao 在 Windows 上以 MARKER_UNDECORATED_SHADOW 表示
    // 「无边框但要阴影」；该标志为真时，tao 会在 WM_NCCALCSIZE 里按
    // get_frame_thickness(dpi) 把客户区四周内缩（高 DPI 下 4~6px），窗口因此
    // 留出一圈非客户区——因为 transparent(true)，这圈区域就表现为包裹在挂件
    // 外面的一层透明容器。设为 false 后客户区铺满整窗；残余的 Win11 1px DWM
    // 边框由下方 strip_native_frame 摘除。
    // 反面教训：不要再用 SetWindowLongPtr + SetWindowPos(SWP_FRAMECHANGED) 去
    // 「补」样式，那会把非客户区交回 DefWindowProc，系统会按窗口样式里的
    // WS_CAPTION 重新画出原生标题栏（这正是本文件此前那段 FFI 造成的故障）。
    .shadow(false)
    .skip_taskbar(true)
    .always_on_top(settings.always_on_top.unwrap_or(false))
    .general_autofill_enabled(false)
    .visible(true)
    .build()?;

    // 建窗即剥掉原生装饰残迹（1px DWM 边框），见 strip_native_frame 的教训注释。
    #[cfg(target_os = "windows")]
    strip_native_frame(&window);

    let window_to_hide = window.clone();
    let app_handle = app.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = window_to_hide.hide();
            persist_clock_enabled(&app_handle, false);
            crate::tray::set_clock_menu_checked(&app_handle, false);
        }
    });
    Ok(())
}

/// 存档尺寸 → 合法窗口尺寸。缺字段或值非法时走默认值，有值则夹进区间。
/// 与 `widget.rs::resolve_size` 同构：拖拽区间由窗口的 min/max 声明，
/// 这里只负责建窗时把陈旧或越界的存档值修正回来。
fn resolve_size(saved_w: Option<f64>, saved_h: Option<f64>) -> LogicalSize<f64> {
    LogicalSize::new(
        saved_w
            .filter(|value| value.is_finite())
            .unwrap_or(CLOCK_DEFAULT_WIDTH)
            .clamp(CLOCK_MIN_WIDTH, CLOCK_MAX_WIDTH),
        saved_h
            .filter(|value| value.is_finite())
            .unwrap_or(CLOCK_DEFAULT_HEIGHT)
            .clamp(CLOCK_MIN_HEIGHT, CLOCK_MAX_HEIGHT),
    )
}

pub fn toggle_clock_window(app: &AppHandle) -> tauri::Result<bool> {
    if let Some(window) = app.get_webview_window(CLOCK_LABEL) {
        let visible = window.is_visible().unwrap_or(false);
        if visible {
            persist_clock_enabled(app, false);
            let _ = window.hide();
        } else {
            window.show()?;
            window.set_focus()?;
            persist_clock_enabled(app, true);
        }
        return Ok(!visible);
    }
    create_clock_window(app)?;
    persist_clock_enabled(app, true);
    Ok(true)
}

#[allow(dead_code)]
pub fn is_clock_visible(app: &AppHandle) -> bool {
    app.get_webview_window(CLOCK_LABEL)
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false)
}

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
                return LogicalPosition::new(
                    x.min(right - size.width - EDGE_MARGIN),
                    y.min(bottom - size.height - EDGE_MARGIN),
                );
            }
        }
    }

    let fallback = monitors
        .iter()
        .find(|monitor| monitor.position().x == 0 && monitor.position().y == 0)
        .or(monitors.first());
    let Some(monitor) = fallback else {
        return LogicalPosition::new(EDGE_MARGIN, TOP_MARGIN);
    };
    let scale = monitor.scale_factor();
    let left = monitor.position().x as f64 / scale;
    let top = monitor.position().y as f64 / scale;
    let width = monitor.size().width as f64 / scale;
    LogicalPosition::new(
        left + width - size.width - EDGE_MARGIN,
        top + TOP_MARGIN,
    )
}
