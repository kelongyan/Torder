//! 系统字体枚举（`设置 → 外观 → 桌面便签字体` 的下拉数据源）。
//!
//! 走 PowerShell + .NET `InstalledFontCollection` 而不是读注册表：
//! 注册表 `...\Fonts` 的键名是**字体文件名**（`Arial Bold`、`Calibri Light Italic`），
//! 直接塞进 CSS `font-family` 会匹配不到任何字体；`InstalledFontCollection`
//! 给的是真正的**家族名**（`Arial`、`Calibri`，中文还带本地化名如「微软雅黑」），
//! 才是 `font-family` 期望的值。
//!
//! 不引入 `windows` crate 直接调 GDI+：该 crate 体量极大，项目现有 Windows
//! 专属能力（`acrylic.rs`）同样走裸 FFI/子进程而非完整绑定，这里保持一致，
//! 避免为一次列表查询把编译内存峰值拉高（本机 16GB，见 RULE §3）。

use std::process::Command;

/// 单次枚举的候选家族上限。
///
/// 正常机器 200–400 个家族；这里给足余量但不设无限——子进程返回异常大的
/// 输出通常意味着脚本被替换或环境异常，截断比把几 MB 塞进 IPC 更安全。
const MAX_FONT_FAMILIES: usize = 2000;

/// 枚举系统已安装字体家族名（按名称排序、去重）。
///
/// 非 Windows 平台返回空表：Android/iOS 没有「桌面便签」这个概念，
/// 该设置项本身也不会渲染，空表是正确语义而非错误。
pub fn list_system_fonts() -> Result<Vec<String>, String> {
    #[cfg(not(target_os = "windows"))]
    {
        Ok(Vec::new())
    }

    #[cfg(target_os = "windows")]
    {
        list_system_fonts_windows()
    }
}

#[cfg(target_os = "windows")]
fn list_system_fonts_windows() -> Result<Vec<String>, String> {
    // -NonInteractive / -NoProfile：不加载用户配置、不弹交互提示，
    // 避免用户在 profile 里输出额外内容污染解析结果。
    // 输出用 \n 一行一个家族名，前端拿到即用。
    const SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$collection = New-Object System.Drawing.Text.InstalledFontCollection
$collection.Families | ForEach-Object { $_.Name }
"#;

    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            SCRIPT,
        ])
        .output()
        .map_err(|error| format!("failed to run font enumeration: {error}"))?;

    if !output.status.success() {
        return Err("font enumeration failed".to_owned());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(parse_font_families(&stdout))
}

/// 解析枚举输出：逐行取非空项，去重后排序。
///
/// 单独拆出来是为了可单测——子进程不在测试里跑（慢且依赖宿主环境），
/// 但「输出怎么变成列表」这段固定逻辑必须能验证。
fn parse_font_families(stdout: &str) -> Vec<String> {
    let mut families: Vec<String> = stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_owned)
        .collect();
    // 大小写不敏感去重：同一家族可能同时以本地化名与英文名出现，
    // 但完全同名的重复项（不同 .NET 版本行为差异）要挡掉。
    families.sort_by_key(|name| name.to_lowercase());
    families.dedup_by_key(|name| name.to_lowercase());
    families.truncate(MAX_FONT_FAMILIES);
    families
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_trims_and_drops_blank_lines() {
        let parsed = parse_font_families("Arial\n\n  微软雅黑  \n\nCalibri\n");
        assert_eq!(parsed, vec!["Arial", "Calibri", "微软雅黑"]);
    }

    #[test]
    fn parse_dedupes_case_insensitively() {
        // 同一家族重复出现（不同来源）只保留一份，避免下拉列表出现重复项
        let parsed = parse_font_families("Arial\narial\nARIAL\nCalibri\n");
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed.iter().filter(|n| n.eq_ignore_ascii_case("arial")).count(), 1);
    }

    #[test]
    fn parse_sorts_case_insensitively() {
        // 排序要稳定且可预期：大写不在小写前扎堆（ASCII 序会把 'Z' 排在 'a' 前）
        let parsed = parse_font_families("Zebra\napple\nBanana\n");
        assert_eq!(parsed, vec!["apple", "Banana", "Zebra"]);
    }

    #[test]
    fn parse_handles_crlf_and_garbage_output() {
        // PowerShell 在 Windows 上给 CRLF；混入无关输出时不 panic
        let parsed = parse_font_families("Arial\r\nCalibri\r\n\r\n");
        assert_eq!(parsed, vec!["Arial", "Calibri"]);
    }

    #[test]
    fn parse_caps_absurdly_long_lists() {
        let huge = (0..MAX_FONT_FAMILIES + 500)
            .map(|index| format!("Font{index:05}"))
            .collect::<Vec<_>>()
            .join("\n");
        let parsed = parse_font_families(&huge);
        assert_eq!(parsed.len(), MAX_FONT_FAMILIES);
    }

    #[test]
    fn parse_empty_output_yields_empty_list() {
        assert!(parse_font_families("").is_empty());
        assert!(parse_font_families("\n\n  \n").is_empty());
    }
}
