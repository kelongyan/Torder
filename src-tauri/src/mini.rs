use tauri::{AppHandle, LogicalPosition, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

/// 迷你速记窗（阶段 B / T-03）：`#mini` 独立入口。
///
/// 与 widget 同构但极简：固定尺寸、无边框、置顶、skip_taskbar，
/// **失焦自动隐藏**（快速速记用完即走）；关闭请求一律转为隐藏。
/// 位置取主屏右上角（光标级定位留待后续：需 MonitorFromPoint API）。
/// 窗口由全局热键（Ctrl Shift M）与主窗工具栏懒创建，启动不开窗。
pub const MINI_LABEL: &str = "mini";
const MINI_WIDTH: f64 = 420.0;
const MINI_HEIGHT: f64 = 216.0;
const EDGE_MARGIN: f64 = 24.0;
const TASKBAR_MARGIN: f64 = 64.0;

/// 切换迷你窗可见性；不存在时创建。
pub fn toggle_mini_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(MINI_LABEL) {
        if window.is_visible().unwrap_or(false) {
            window.hide()?;
        } else {
            window.show()?;
            window.set_focus()?;
        }
        return Ok(());
    }
    create_mini_window(app)?;
    Ok(())
}

pub fn create_mini_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(MINI_LABEL) {
        window.show()?;
        return window.set_focus();
    }

    let position = resolve_mini_position(app);
    let window =
        WebviewWindowBuilder::new(app, MINI_LABEL, WebviewUrl::App("index.html#mini".into()))
            .title("今序速记")
            .inner_size(MINI_WIDTH, MINI_HEIGHT)
            .position(position.x, position.y)
            .resizable(false)
            .maximizable(false)
            .decorations(false)
            .skip_taskbar(true)
            .always_on_top(true)
            // 与 widget 一致：禁掉 WebView2 的「保存的信息」下拉（表单历史）。
            .general_autofill_enabled(false)
            .visible(true)
            .build()?;

    let hide_window = window.clone();
    window.on_window_event(move |event| match event {
        // 失焦即隐藏：快速速记用完点外部自动收走。
        WindowEvent::Focused(false) => {
            let _ = hide_window.hide();
        }
        // 关闭请求转隐藏（与 widget 一致的语义，避免销毁后热键重建闪烁）。
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let _ = hide_window.hide();
        }
        _ => {}
    });
    Ok(())
}

/// 主屏右上角（留出任务栏与边距）。迷你窗不需要记忆位置。
fn resolve_mini_position(app: &AppHandle) -> LogicalPosition<f64> {
    let monitors = app.available_monitors().unwrap_or_default();
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
        left + width - MINI_WIDTH - EDGE_MARGIN,
        top + height - MINI_HEIGHT - TASKBAR_MARGIN,
    )
}
