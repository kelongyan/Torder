use std::fs;
use std::io::Read;
use std::path::PathBuf;

use tauri::{ipc::Response, AppHandle, Manager};
use tauri_plugin_autostart::ManagerExt;

use crate::db::settings_repository::SettingsRepository;
use crate::db::Database;
use crate::models::UpsertSettingInput;
use crate::tray;
use crate::widget;

/* === 便签自定义字体（Phase 5） ===
固定槽位设计：应用数据目录 fonts/ 下最多一个 note-custom.* 文件，
重新导入即整体替换；字节经 read_note_font_bytes（ipc::Response 裸载荷，
避免 MB 级 Vec<u8> 走 JSON 数组序列化）交给前端 FontFace 动态注册，
家族名固定 "Torder Note Custom"（见 widgetAppearance.ts）。 */

const NOTE_FONT_MAX_BYTES: u64 = 20 * 1024 * 1024;
const NOTE_FONT_FILE_STEM: &str = "note-custom";

const NOTE_FONT_ALLOWED_EXT: [&str; 4] = ["ttf", "otf", "woff", "woff2"];

/// 字体文件魔数校验（ttf/otf/ttc/woff/woff2），拦下改扩展名的非字体文件。
fn is_font_magic(magic: &[u8; 4]) -> bool {
    matches!(
        magic,
        b"\x00\x01\x00\x00" | b"OTTO" | b"ttcf" | b"wOFF" | b"wOF2"
    )
}

fn note_font_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("fonts");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

/// 删除槽位里的旧 note-custom.*，返回被删的个数。
fn clear_note_font_slots(dir: &PathBuf) -> Result<usize, String> {
    let mut removed = 0;
    for entry in fs::read_dir(dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with(NOTE_FONT_FILE_STEM) {
            fs::remove_file(entry.path()).map_err(|error| error.to_string())?;
            removed += 1;
        }
    }
    Ok(removed)
}

/// 导入便签自定义字体：校验扩展名/大小/魔数 → 复制进应用数据目录固定槽位。
/// 返回展示名（源文件去扩展名），前端持久化到 `widget` 键的 noteCustomFontName。
#[tauri::command]
pub fn import_note_font(app: AppHandle, source_path: String) -> Result<String, String> {
    let source = PathBuf::from(&source_path);
    let ext = source
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .ok_or_else(|| "字体文件缺少扩展名".to_string())?;
    if !NOTE_FONT_ALLOWED_EXT.contains(&ext.as_str()) {
        return Err(format!(
            "不支持的字体格式 .{ext}（仅支持 ttf / otf / woff / woff2）"
        ));
    }
    let size = fs::metadata(&source)
        .map_err(|error| format!("无法读取字体文件: {error}"))?
        .len();
    if size == 0 {
        return Err("字体文件是空的".to_string());
    }
    if size > NOTE_FONT_MAX_BYTES {
        return Err("字体文件超过 20MB 上限".to_string());
    }
    let mut file = fs::File::open(&source).map_err(|error| format!("无法打开字体文件: {error}"))?;
    let mut magic = [0u8; 4];
    file.read_exact(&mut magic)
        .map_err(|error| format!("无法读取字体文件: {error}"))?;
    if !is_font_magic(&magic) {
        return Err("文件内容不是有效的字体格式".to_string());
    }

    let dir = note_font_dir(&app)?;
    clear_note_font_slots(&dir)?;
    let display_name = source
        .file_stem()
        .and_then(|value| value.to_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "自定义字体".to_string());
    let dest = dir.join(format!("{NOTE_FONT_FILE_STEM}.{ext}"));
    fs::copy(&source, &dest).map_err(|error| format!("字体文件保存失败: {error}"))?;
    Ok(display_name)
}

/// 读取槽位字体的原始字节（无自定义字体时返回空响应）。
/// 走 ipc::Response 裸字节载荷，前端拿到的直接是 ArrayBuffer。
#[tauri::command]
pub fn read_note_font_bytes(app: AppHandle) -> Result<Response, String> {
    let dir = note_font_dir(&app)?;
    let mut slot: Option<PathBuf> = None;
    for entry in fs::read_dir(&dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let name = entry.file_name();
        if name.to_string_lossy().starts_with(NOTE_FONT_FILE_STEM) {
            slot = Some(entry.path());
            break;
        }
    }
    let Some(path) = slot else {
        return Ok(Response::new(Vec::new()));
    };
    let bytes = fs::read(&path).map_err(|error| format!("字体文件读取失败: {error}"))?;
    Ok(Response::new(bytes))
}

/// 移除自定义字体槽位（前端同时把 noteFont 拉回默认并清空 noteCustomFontName）。
#[tauri::command]
pub fn remove_note_font(app: AppHandle) -> Result<(), String> {
    let dir = note_font_dir(&app)?;
    clear_note_font_slots(&dir)?;
    Ok(())
}

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
