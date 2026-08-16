use std::process::Command;

use serde::{Deserialize, Serialize};

use crate::error::{RepositoryError, RepositoryResult};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    name: &'static str,
    version: &'static str,
    platform: &'static str,
}

#[tauri::command]
pub fn get_app_info() -> AppInfo {
    AppInfo {
        name: "Torder（今序）",
        version: env!("CARGO_PKG_VERSION"),
        platform: std::env::consts::OS,
    }
}

#[tauri::command]
pub fn set_window_material_theme(window: tauri::WebviewWindow, dark: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        window_vibrancy::apply_mica(&window, Some(dark)).map_err(|error| error.to_string())?;
    }

    #[cfg(not(target_os = "windows"))]
    let _ = (window, dark);

    Ok(())
}

/// 更新清单地址。方案 B 的发布约定：GitHub Pages（gh-pages 分支）上放
/// `latest.json` 与对应安装包，发布新版本时更新清单里的 version / notes /
/// downloadUrl / sha256。
const UPDATE_MANIFEST_URL: &str = "https://kelongyan.github.io/torder/latest.json";
const UPDATE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateManifest {
    version: String,
    notes: Option<String>,
    download_url: String,
    sha256: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    has_update: bool,
    latest_version: String,
    notes: Option<String>,
    download_url: String,
    sha256: Option<String>,
}

#[tauri::command]
pub fn check_for_update() -> Result<UpdateInfo, String> {
    check_for_update_impl().map_err(|error| error.to_string())
}

fn check_for_update_impl() -> RepositoryResult<UpdateInfo> {
    let agent = ureq::Agent::new_with_config(
        ureq::Agent::config_builder()
            .timeout_global(Some(UPDATE_TIMEOUT))
            .build(),
    );
    let response = agent
        .get(UPDATE_MANIFEST_URL)
        .call()
        .map_err(|error| RepositoryError::Tauri(format!("network error: {error}")))?;
    let manifest: UpdateManifest = serde_json::from_str(
        &response
            .into_body()
            .read_to_string()
            .map_err(|error| RepositoryError::Tauri(format!("read manifest: {error}")))?,
    )
    .map_err(|error| RepositoryError::Tauri(format!("invalid manifest: {error}")))?;

    let current = env!("CARGO_PKG_VERSION");
    let has_update = compare_semver(&manifest.version, current).is_gt();
    Ok(UpdateInfo {
        has_update,
        latest_version: manifest.version,
        notes: manifest.notes,
        download_url: manifest.download_url,
        sha256: manifest.sha256,
    })
}

/// 用默认浏览器打开更新下载页。
#[tauri::command]
pub fn open_download_page(url: String) -> Result<(), String> {
    open_url_external(&url).map_err(|error| error.to_string())
}

pub fn open_url_external(url: &str) -> RepositoryResult<()> {
    if url.starts_with("https://") || url.starts_with("http://") {
        Command::new("cmd")
            .args(["/C", "start", "", url])
            .spawn()
            .map_err(|error| RepositoryError::Io(error))?;
        Ok(())
    } else {
        Err(RepositoryError::Validation("refusing to open non-http url"))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Ordering {
    Less,
    Equal,
    Greater,
}

impl Ordering {
    fn is_gt(self) -> bool {
        matches!(self, Self::Greater)
    }
}

/// 比较 "major.minor.patch" 三段数字；忽略预发布后缀（如 -beta.1）。
fn compare_semver(left: &str, right: &str) -> Ordering {
    fn parts(version: &str) -> Vec<u64> {
        version
            .split(['-', '+'])
            .next()
            .unwrap_or(version)
            .split('.')
            .map(|segment| segment.parse().unwrap_or(0))
            .collect()
    }

    let left_parts = parts(left);
    let right_parts = parts(right);
    for index in 0..left_parts.len().max(right_parts.len()) {
        let left_value = left_parts.get(index).copied().unwrap_or(0);
        let right_value = right_parts.get(index).copied().unwrap_or(0);
        match left_value.cmp(&right_value) {
            std::cmp::Ordering::Equal => continue,
            std::cmp::Ordering::Less => return Ordering::Less,
            std::cmp::Ordering::Greater => return Ordering::Greater,
        }
    }
    Ordering::Equal
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn semver_compares_major_minor_patch() {
        assert_eq!(compare_semver("2.2.0", "2.2.0"), Ordering::Equal);
        assert_eq!(compare_semver("2.3.0", "2.2.0"), Ordering::Greater);
        assert_eq!(compare_semver("2.2.0", "2.3.0"), Ordering::Less);
        assert_eq!(compare_semver("2.2.1", "2.2.0"), Ordering::Greater);
        assert_eq!(compare_semver("2.10.0", "2.9.9"), Ordering::Greater);
        assert_eq!(compare_semver("2.2.0", "2.2"), Ordering::Equal);
    }

    #[test]
    fn semver_ignores_prerelease_suffix() {
        assert_eq!(compare_semver("2.3.0-beta.1", "2.2.0"), Ordering::Greater);
        assert_eq!(compare_semver("2.3.0", "2.3.0-beta.1"), Ordering::Equal);
    }

    #[test]
    fn semver_falls_back_to_zero_on_garbage() {
        assert_eq!(compare_semver("not-a-version", "2.2.0"), Ordering::Less);
        assert_eq!(compare_semver("", ""), Ordering::Equal);
    }

    #[test]
    fn open_download_page_rejects_non_http_urls() {
        assert!(matches!(
            open_url_external("file:///C:/Windows/System32/calc.exe"),
            Err(RepositoryError::Validation(_))
        ));
    }
}