use serde::Deserialize;
use tauri::{
    App, AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindow,
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
/// `anchorDate` / `sizeMode` / `note*` 外观字段（noteTheme/noteOpacity/noteFont/
/// noteFontSize/noteTexture/noteRules/notePin/noteDots/noteHideDone）仅前端消费，
/// serde 忽略未知字段，故此处不声明）。
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
    // 便签设置走自己的事务（不经 SettingsRepository::upsert），同步变更记录
    // 要在这里单独补——漏了它便签外观改动永远同步不到别的设备。记录的是
    // 裁剪后的值（只含外观字段），几何与开关不会上云。
    crate::db::settings_repository::record_settings_change(&transaction, "widget", &value)
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
    // 必须显式关闭阴影（时钟窗 clock.rs 同款坑）。tao 在 Windows 上以
    // MARKER_UNDECORATED_SHADOW 表示「无边框但要阴影」，默认 true；该标志为真
    // 时 tao 会在 WM_NCCALCSIZE 里按 get_frame_thickness(dpi) 把客户区四周内缩
    // （util.rs::calculate_insets_for_dpi：left/right/bottom = 框厚，top = 1 逻辑
    // 像素），窗口因此留出一圈非客户区——因为 transparent(true)，这圈区域表现为
    // 包裹在纸面外面的透明/黑边容器。实测（2026-09-29，100% DPI）便签窗口外框
    // 335x493 而客户区/wry webview 只有 319x484，即左右各 8px、上 1px、下 8px
    // 的黑边——正是用户报告的「两边似乎多出一点区域」。此前它被 SWCA 磨砂背板
    // 盖住看不见，2026-09-29 引入固定功能清掉 acrylic 后显形。
    // `.shadow(false)` 之后客户区铺满整窗；残余的 Win11 1px DWM 描边由下方
    // strip_native_frame 摘除（注意：不要再用 SetWindowLongPtr+SWP_FRAMECHANGED
    // 去「补」样式——那会把非客户区交回 DefWindowProc，系统会按样式里的
    // WS_CAPTION 重新画出原生标题栏，clock.rs 有完整反面教训）。
    .shadow(false)
    .transparent(true)
    .skip_taskbar(true)
    // 便签输入框不需要 WebView2 的「保存的信息」下拉（表单历史 + 个人信息建议）。
    // 权威开关在这里：Tauri 文档指出 WebView2 的 Suggestions 在某些情况下不遵守
    // DOM 上的 autocomplete="off"（前端那行只当字段级提示）。
    .general_autofill_enabled(false)
    .visible(true)
    .build()?;

    // 建窗即剥掉原生装饰残迹（Win11 1px DWM 边框），与 clock.rs 一致。
    #[cfg(target_os = "windows")]
    strip_native_frame(&window);

    // 首帧窗口层状态对账：wry 的 webview bounds 定格在**建窗时**的客户区口径。
    // 建窗时 NC 内缩尚未被 NCCALCSIZE 收编，wry 已按「当时的客户区」测算过一遍；
    // 我们随后用 FFI 改的样式/宿主关系都不会让它自动重算。做一次 1px resize
    // 往返强制它按当前客户区重算，保证纸面覆盖窗口每一个像素。
    #[cfg(target_os = "windows")]
    force_webview_bounds_resync(&window);

    let window_to_hide = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = window_to_hide.hide();
        }
    });
    Ok(())
}

/// 便签「固定」的窗口层副作用（2026-09-29）。
///
/// 「显示桌面」（任务栏右下角按钮 / Win+D，shell 的 ToggleDesktop）有两层效果：
///
/// 1. **最小化**：shell 只最小化「带系统菜单」的窗口。tao 在 `to_window_styles`
///    里给所有窗口无条件加 `WS_SYSMENU`（`skip_taskbar` 只调
///    `ITaskbarList::DeleteTab`，管不到这件事）——清掉
///    `WS_SYSMENU / WS_MINIMIZEBOX / WS_MAXIMIZEBOX` 即可豁免最小化
///    （实测：不清理时 Win+D 后 `IsIconic=true`、窗口被搬到 -32000,-32000；
///    清理后同样触发，`IsIconic` 恒 false、rect 不变）。
/// 2. **全局飞出动画**：DWM 合成层的 sweep 动画会扫过所有**顶层**窗口——窗口
///    状态不变但像素被带走一帧再弹回（用户描述的「隐藏又自动弹出来」）。这条
///    与样式无关：实测（`.tmp/probe-toplevel-exempt.ps1`，品红测试窗 + 像素级
///    变化统计 + 对照窗必须被最小化才算一轮有效）清 SYSMENU、`DeleteTab`、
///    `WS_EX_TOOLWINDOW`、`WS_EX_NOACTIVATE`、`DWMWA_TRANSITIONS_FORCEDISABLED`、
///    `DWMWA_DISALLOW_PEEK`、`DWMWA_EXCLUDED_FROM_PEEK` 及其任意组合，sweep 一律
///    照扫（像素签名 1 → 0）。
///    **唯一豁免**：把 Progman 设为窗口的 **owner**（`SetWindowLongPtr(GWLP_HWNDPARENT,
///    progman)`，注意不是 `SetParent`）——窗口仍是顶层 popup，但 shell 的 sweep
///    不再收它（同轮对照窗被最小化、测试窗逐帧像素零变化，`.tmp` 探针实测）。
///    这不改变 Z 序层级：锁定后的便签依然是「可被应用窗口盖住」的普通窗口。
///
/// - `locked=false`：清 owner + 恢复 tao 默认样式位 + `set_skip_taskbar(false)`
///   （AddTab 重新注册任务栏），显示桌面时便签跟其他窗口一起被最小化
///   （「正常状态全部隐藏」），任务栏出现按钮可供找回。
/// - `locked=true`：`set_skip_taskbar(true)`（DeleteTab）+ 清可最小化样式 +
///   owner=Progman。Acrylic 不需要动：窗口始终是顶层，SWCA 照常可用
///   （2026-09-29 之前那套「挂成 Progman 子窗口」的做法才会黑死玻璃纸面）。
///
/// 幂等可重复调用；窗口不存在（便签未开启）时 no-op。
pub fn set_widget_locked(app: &AppHandle, locked: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let Some(window) = app.get_webview_window(WIDGET_LABEL) else {
            return Ok(());
        };
        // 任务栏注册决定 ToggleDesktop 是否收这个窗：skip_taskbar(true) 走
        // ITaskbarList::DeleteTab，被删 tab 的窗口会被「显示桌面」跳过
        // （实测：未固定的便签 Win+D 从不被最小化，同进程主窗每轮都收）。
        // 未固定要「跟其他窗口一起隐藏」就必须 AddTab 开回来（skip=false，
        // 任务栏会出现便签按钮，语义是普通窗口）；固定态保持 skip=true。
        window.set_skip_taskbar(locked).map_err(|error| error.to_string())?;
        let hwnd = window.hwnd().map_err(|error| error.to_string())?.0 as isize;
        unsafe { apply_widget_locked(hwnd, locked) }?;
        // 样式位/owner 变过之后强制 wry 按当前客户区重算 webview bounds。
        force_webview_bounds_resync(&window);
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, locked);
        Ok(())
    }
}

/// 摘掉 Win11 给带 WS_CAPTION 样式的窗口画的 1px DWM 描边（clock.rs 同款：
/// 无边框窗口为保住 DWM 动画/贴靠语义在 HWND 上仍保留 WS_CAPTION，
/// `.shadow(false)` 只能摘掉 WM_NCCALCSIZE 的客户区内缩，管不到这圈描边）。
#[cfg(target_os = "windows")]
fn strip_native_frame(window: &WebviewWindow) {
    if let Ok(hwnd) = window.hwnd() {
        crate::clock::remove_dwm_border(hwnd.0 as isize);
    }
}

/// 强制 wry 重算 webview bounds（纸面必须覆盖每一个像素）。
///
/// wry 的 webview bounds 定格在**上一次窗口 resize 时**的客户区口径；我们通过
/// FFI 改窗口样式（清 NC 面样式）或宿主关系时不会触发 wry 的 resize 回调，它
/// 就永远按旧口径把 webview 摆小一圈——之前被 SWCA 磨砂背板盖住看不见，清掉
/// acrylic 后以黑框显形（2026-09-29 用户报告「两边多出区域」）。做一次 1px
/// `SetWindowPos` resize 往返逼它重算。
///
/// 必须用 FFI 的物理尺寸：tauri `set_size` 的 Size 语义要过 DPI 上下文换算，
/// 会把窗口越改越大（踩过）。flags = SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE。
#[cfg(target_os = "windows")]
fn force_webview_bounds_resync(window: &WebviewWindow) {
    let Ok(size) = window.outer_size() else {
        return;
    };
    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    let (width, height) = (size.width as i32, size.height as i32);
    if width < 4 || height < 4 {
        return;
    }
    use widget_lock_ffi::*;
    unsafe {
        SetWindowPos(hwnd.0 as isize, 0, 0, 0, width - 1, height - 1, 0x16);
        SetWindowPos(hwnd.0 as isize, 0, 0, 0, width, height, 0x16);
    }
}

#[cfg(target_os = "windows")]
mod widget_lock_ffi {
    /// EnumWindows 回调签名（`WNDENUMPROC`）：返回 0 停止枚举。
    pub type EnumWindowsProc = unsafe extern "system" fn(isize, isize) -> i32;

    #[link(name = "user32")]
    extern "system" {
        pub fn GetWindowLongPtrW(hwnd: isize, index: i32) -> isize;
        pub fn SetWindowLongPtrW(hwnd: isize, index: i32, value: isize) -> isize;
        pub fn EnumWindows(callback: EnumWindowsProc, param: isize) -> i32;
        pub fn GetClassNameW(hwnd: isize, buffer: *mut u16, max_count: i32) -> i32;
        pub fn SetWindowPos(
            hwnd: isize,
            after: isize,
            x: i32,
            y: i32,
            cx: i32,
            cy: i32,
            flags: u32,
        ) -> i32;
    }
}

/// 找桌面宿主 Progman 的窗口句柄。
///
/// 不用 `FindWindowW("Progman", ..)`：本机实测该调用恒返回 0（原因未明，
/// 2026-09-29 探针实锤），必须走 `EnumWindows` + 类名比对。
#[cfg(target_os = "windows")]
fn find_progman() -> isize {
    use widget_lock_ffi::*;

    // EnumWindows 回调是 extern "system" fn；用栈上变量传结果，不引入全局状态。
    struct Probe {
        found: isize,
    }
    unsafe extern "system" fn callback(hwnd: isize, param: isize) -> i32 {
        let probe = &mut *(param as *mut Probe);
        let mut buffer = [0u16; 64];
        let len = GetClassNameW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32);
        // "Progman" 的 UTF-16 编码（长度 7）
        const EXPECTED: [u16; 7] = [80, 114, 111, 103, 109, 97, 110];
        if len == 7 && buffer[..7] == EXPECTED {
            probe.found = hwnd;
            return 0; // 找到即停
        }
        1
    }

    let mut probe = Probe { found: 0 };
    unsafe {
        EnumWindows(callback, &mut probe as *mut Probe as isize);
    }
    probe.found
}

#[cfg(target_os = "windows")]
unsafe fn apply_widget_locked(hwnd: isize, locked: bool) -> Result<(), String> {
    use widget_lock_ffi::*;

    const GWL_STYLE: i32 = -16;
    const GWLP_HWNDPARENT: i32 = -8;
    const WS_MAXIMIZEBOX: isize = 0x0001_0000;
    const WS_MINIMIZEBOX: isize = 0x0002_0000;
    const WS_SYSMENU: isize = 0x0008_0000;
    const SWP_NOSIZE: u32 = 0x0001;
    const SWP_NOMOVE: u32 = 0x0002;
    const SWP_NOZORDER: u32 = 0x0004;
    const SWP_NOACTIVATE: u32 = 0x0010;
    const SWP_FRAMECHANGED: u32 = 0x0020;

    // 只清「可最小化」相关的三个样式位：ToggleDesktop 的最小化集合按
    // 「带系统菜单」筛选。CAPTION / SIZEBOX 必须保留——tao 的 WM_NCCALCSIZE
    // 处理（无边框窗口靠它把客户区铺满 + 保 DWM 贴靠语义）依赖样式位不被动过；
    // 之前把它整片清掉再补 WS_POPUP 的写法会把非客户区交回 DefWindowProc，
    // 系统按残留样式重画边框（clock.rs 的反面教训，勿重蹈）。
    const MINIMIZE_MASK: isize = WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX;
    // 原始 tao 形态：清样式前先记下「带这三个位」的形态，解锁时按位恢复。
    const TAO_BASE: isize = WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX;

    // ---- 样式：固定 → 清可最小化位；解锁 → 恢复 ----
    let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
    let next_style = if locked {
        style & !MINIMIZE_MASK
    } else {
        // 只补回可最小化位，其余样式位（CAPTION/SIZEBOX/CLIPSIBLINGS…）保持原样
        style | (TAO_BASE & !style)
    };
    if next_style != style {
        SetWindowLongPtrW(hwnd, GWL_STYLE, next_style);
        SetWindowPos(
            hwnd,
            0,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
        );
    }

    // ---- owner：固定 → Progman（免 sweep 动画）；解锁 → 清 owner ----
    // GWLP_HWNDPARENT 对顶层窗口即「owner」语义（不是 SetParent 的父子关系），
    // 窗口不会变成子窗口，Z 序与合成行为保持顶层窗口语义。
    let progman = find_progman();
    if locked {
        if progman != 0 && GetWindowLongPtrW(hwnd, GWLP_HWNDPARENT) != progman {
            SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, progman);
        }
    } else if GetWindowLongPtrW(hwnd, GWLP_HWNDPARENT) != 0 {
        SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, 0);
    }
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

/// 触发便签「淡出隐藏」流程（方案书 widget-ux-polish-plan-2026-09-08.md W2-2）：
/// 1. emit `widget-hide-request` 到 widget 窗，前端复用 `.is-closing` 播 360ms 淡出；
/// 2. 前端播完后 invoke `hide_widget_window`（commands/widget.rs）执行真正 hide；
/// 3. 这里同时起 500ms 兜底线程——WebView 卡死 / 事件丢失时直接 hide，
///    宁可硬切不可失灵。
///
/// 返回是否找到了窗口（调用方据此决定是否需要建窗）。
pub fn request_widget_hide(app: &AppHandle) -> bool {
    let Some(window) = app.get_webview_window(WIDGET_LABEL) else {
        return false;
    };
    if !window.is_visible().unwrap_or(false) {
        return true; // 已隐藏，视为成功
    }
    if let Err(error) = app.emit_to(WIDGET_LABEL, "widget-hide-request", ()) {
        eprintln!("widget hide-request emit failed: {error}");
        let _ = window.hide();
        return true;
    }
    let fallback = window;
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(500));
        if fallback.is_visible().unwrap_or(false) {
            let _ = fallback.hide();
        }
    });
    true
}

/// 切换小窗可见性；窗口不存在时按需创建。返回切换后是否可见。
/// 托盘菜单路径：同时持久化 enabled，重启后按此恢复。
/// 显隐均走事件驱动的前端动效（W2-2）：show 后 emit `widget-shown`
/// 让前端重播 drop-in；hide 走 `request_widget_hide` 淡出。
pub fn toggle_widget_window(app: &AppHandle) -> tauri::Result<bool> {
    if let Some(window) = app.get_webview_window(WIDGET_LABEL) {
        let visible = window.is_visible().unwrap_or(false);
        if visible {
            persist_widget_enabled(app, false);
            request_widget_hide(app);
        } else {
            normalize_existing_widget_size(&window)?;
            window.show()?;
            window.set_focus()?;
            let _ = app.emit_to(WIDGET_LABEL, "widget-shown", ());
            persist_widget_enabled(app, true);
        }
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
