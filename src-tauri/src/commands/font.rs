use crate::system_fonts;

/// 枚举系统已安装字体家族名（便签字体下拉的数据源）。
///
/// 返回给前端的名字直接用作 CSS `font-family` 值——浏览器能解析系统字体，
/// 因此这条路径**不需要**读字体字节、也不需要 FontFace 注册。
#[tauri::command]
pub fn list_system_fonts() -> Result<Vec<String>, String> {
    system_fonts::list_system_fonts()
}
