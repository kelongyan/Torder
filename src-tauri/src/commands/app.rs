use std::process::Command;

use serde::Serialize;

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_download_page_rejects_non_http_urls() {
        assert!(matches!(
            open_url_external("file:///C:/Windows/System32/calc.exe"),
            Err(RepositoryError::Validation(_))
        ));
    }
}