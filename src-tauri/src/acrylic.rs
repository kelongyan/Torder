//! SWCA（SetWindowCompositionAttribute）Acrylic 自实现——便签磨砂专用。
//!
//! 不用 window-vibrancy 0.6 的 `apply_acrylic`：该实现在 Windows build ≥ 22523
//! （Win11 22H2+）改走 `DWMWA_SYSTEMBACKDROP_TYPE`（DWMSBT_TRANSIENTWINDOW）
//! 路线，完全忽略传入的 tint color——透明度旋钮失效，且系统背板对无边框
//! 透明窗大概率不渲染。SWCA 的 `ACCENT_ENABLE_ACRYLICBLURBEHIND`
//! （Win10 1809+，覆盖全部 Win11）真正尊重 GradientColor 的 alpha 通道，
//! 旋钮全程可调。已知代价：Win10 v1903+ / Win11 拖动窗口卡顿（未公开 API
//! 缺陷，window-vibrancy 文档同样注明），便签小窗场景可接受。
//!
//! 实现范式照搬 window-vibrancy 0.6 `windows.rs`：`SetWindowCompositionAttribute`
//! 是未公开 API（不在公开头文件/导入库中），从 user32.dll 动态解析。

use core::ffi::{c_char, c_void};

/// `WINDOWCOMPOSITIONATTRIBDATA.attrib`：WCA_ACCENT_POLICY。
const WCA_ACCENT_POLICY: u32 = 0x13;

/// AccentState：关闭窗口合成特效，恢复默认。
const ACCENT_DISABLED: u32 = 0;
/// AccentState：Acrylic 模糊 + tint 打底。
const ACCENT_ENABLE_ACRYLICBLURBEHIND: u32 = 4;

#[repr(C)]
struct AccentPolicy {
    accent_state: u32,
    /// blur 路线不用 AccentFlags 位（2 是 BLURBEHIND 用的），acrylic 恒 0。
    accent_flags: u32,
    /// AABBGGRR 内存序打包：R | G<<8 | B<<16 | A<<24。
    gradient_color: u32,
    animation_id: u32,
}

#[repr(C)]
struct WindowCompositionAttribData {
    attrib: u32,
    pv_data: *mut c_void,
    cb_data: usize,
}

type SetWindowCompositionAttributeFn =
    unsafe extern "system" fn(isize, *mut WindowCompositionAttribData) -> i32;

extern "system" {
    #[link_name = "LoadLibraryA"]
    fn load_library_a(name: *const c_char) -> isize;
    #[link_name = "GetProcAddress"]
    fn get_proc_address(module: isize, name: *const c_char) -> isize;
}

/// 对指定 HWND 启用 SWCA Acrylic 模糊。
///
/// `tint` 为 (r, g, b, a)，alpha 通道直接生效（透明度旋钮 0–1 折算 0–255）。
/// SWCA acrylic 不接受 alpha=0（系统会抬为 1），此处对齐该行为。
pub fn apply_acrylic(hwnd: isize, tint: (u8, u8, u8, u8)) -> Result<(), String> {
    let (r, g, b, alpha) = tint;
    let alpha = if alpha == 0 { 1 } else { alpha };
    let gradient_color =
        u32::from(r) | (u32::from(g) << 8) | (u32::from(b) << 16) | (u32::from(alpha) << 24);
    set_accent(
        hwnd,
        AccentPolicy {
            accent_state: ACCENT_ENABLE_ACRYLICBLURBEHIND,
            accent_flags: 0,
            gradient_color,
            animation_id: 0,
        },
    )
}

/// 关闭 SWCA 特效（ACCENT_DISABLED），恢复默认窗口合成。
pub fn clear_acrylic(hwnd: isize) -> Result<(), String> {
    set_accent(
        hwnd,
        AccentPolicy {
            accent_state: ACCENT_DISABLED,
            accent_flags: 0,
            gradient_color: 0,
            animation_id: 0,
        },
    )
}

fn set_accent(hwnd: isize, policy: AccentPolicy) -> Result<(), String> {
    // SAFETY：user32.dll 为常驻系统库；按名解析的 SetWindowCompositionAttribute
    // 自 Win10 1809 起稳定存在；调用仅传入本函数栈上结构体的指针，hwnd 由
    // 调用方（Tauri WebviewWindow）保证有效。
    unsafe {
        let user32 = load_library_a(c"user32.dll".as_ptr());
        if user32 == 0 {
            return Err("LoadLibraryA(user32.dll) failed".to_string());
        }
        let proc_address = get_proc_address(user32, c"SetWindowCompositionAttribute".as_ptr());
        if proc_address == 0 {
            return Err("SetWindowCompositionAttribute not resolvable".to_string());
        }
        let set_window_composition_attribute: SetWindowCompositionAttributeFn =
            core::mem::transmute(proc_address);
        let mut policy = policy;
        let mut attrib_data = WindowCompositionAttribData {
            attrib: WCA_ACCENT_POLICY,
            pv_data: (&mut policy as *mut AccentPolicy).cast::<c_void>(),
            cb_data: core::mem::size_of::<AccentPolicy>(),
        };
        if set_window_composition_attribute(hwnd, &mut attrib_data) == 0 {
            return Err("SetWindowCompositionAttribute call failed".to_string());
        }
        Ok(())
    }
}
