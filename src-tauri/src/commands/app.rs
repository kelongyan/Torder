use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    name: &'static str,
    version: &'static str,
    platform: &'static str,
}

fn app_version() -> &'static str {
    #[cfg(target_os = "android")]
    {
        option_env!("TORDER_ANDROID_VERSION").unwrap_or(env!("CARGO_PKG_VERSION"))
    }

    #[cfg(not(target_os = "android"))]
    {
        env!("CARGO_PKG_VERSION")
    }
}

#[tauri::command]
pub fn get_app_info() -> AppInfo {
    AppInfo {
        name: "Torder（今序）",
        version: app_version(),
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

#[tauri::command]
pub async fn fetch_update_manifest() -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent("Torder-App")
        .build()
        .map_err(|error| format!("初始化网络客户端失败：{}", error))?;

    let response = client
        .get("https://kelongyan.github.io/Torder/latest.json")
        .send()
        .await
        .map_err(|error| format!("网络请求失败：{}", error))?;

    if !response.status().is_success() {
        return Err(format!("清单请求失败（HTTP {}）", response.status()));
    }

    let text = response
        .text()
        .await
        .map_err(|error| format!("读取清单内容失败：{}", error))?;

    Ok(text)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub percentage: f64,
    pub speed_bps: u64,
}

#[tauri::command]
pub async fn download_update_file(
    url: String,
    expected_sha256: Option<String>,
    on_progress: tauri::ipc::Channel<DownloadProgress>,
) -> Result<String, String> {
    use std::io::Write;
    use sha2::{Digest, Sha256};

    if !url.starts_with("https://") {
        return Err("下载地址不合法（仅支持 HTTPS）".to_string());
    }

    let client = reqwest::Client::builder()
        .user_agent("Torder-App-Updater")
        .build()
        .map_err(|e| format!("初始化客户端失败：{}", e))?;

    let mut response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("请求安装包失败：{}", e))?;

    if !response.status().is_success() {
        return Err(format!("下载请求失败（HTTP {}）", response.status()));
    }

    let total_bytes = response.content_length().unwrap_or(0);

    let temp_dir = std::env::temp_dir().join("torder-updates");
    std::fs::create_dir_all(&temp_dir).map_err(|e| format!("创建临时目录失败：{}", e))?;

    let file_name = url
        .split('/')
        .last()
        .and_then(|name| name.split('?').next())
        .filter(|name| name.ends_with(".exe"))
        .unwrap_or("Torder_update_setup.exe");

    let target_path = temp_dir.join(file_name);
    let mut file = std::fs::File::create(&target_path)
        .map_err(|e| format!("创建更新文件失败：{}", e))?;

    let mut hasher = Sha256::new();
    let mut downloaded_bytes: u64 = 0;
    let start_time = std::time::Instant::now();
    let mut last_emit = std::time::Instant::now();

    while let Some(chunk) = response.chunk().await.map_err(|e| format!("下载中断：{}", e))? {
        file.write_all(&chunk).map_err(|e| format!("写入文件失败：{}", e))?;
        hasher.update(&chunk);
        downloaded_bytes += chunk.len() as u64;

        if last_emit.elapsed().as_millis() >= 80 || (total_bytes > 0 && downloaded_bytes >= total_bytes) {
            last_emit = std::time::Instant::now();
            let elapsed_secs = start_time.elapsed().as_secs_f64();
            let speed_bps = if elapsed_secs > 0.0 {
                (downloaded_bytes as f64 / elapsed_secs) as u64
            } else {
                0
            };
            let percentage = if total_bytes > 0 {
                ((downloaded_bytes as f64 / total_bytes as f64) * 100.0).min(100.0)
            } else {
                0.0
            };
            let _ = on_progress.send(DownloadProgress {
                downloaded_bytes,
                total_bytes,
                percentage,
                speed_bps,
            });
        }
    }

    file.flush().map_err(|e| format!("同步文件失败：{}", e))?;

    if let Some(expected) = expected_sha256 {
        let actual_hash = format!("{:x}", hasher.finalize());
        if !actual_hash.eq_ignore_ascii_case(expected.trim()) {
            let _ = std::fs::remove_file(&target_path);
            return Err(format!(
                "安装包完整性校验失败（SHA256 不匹配）：计算值 {}，预期值 {}",
                actual_hash, expected
            ));
        }
    }

    target_path
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "安装包路径转换失败".to_string())
}

#[tauri::command]
pub fn launch_installer_and_exit(app: tauri::AppHandle, installer_path: String) -> Result<(), String> {
    let path = std::path::Path::new(&installer_path);
    if !path.exists() {
        return Err("安装包文件不存在".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new(path)
            .creation_flags(0x00000008) // DETACHED_PROCESS
            .spawn()
            .map_err(|e| format!("启动安装程序失败：{}", e))?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new(path)
            .spawn()
            .map_err(|e| format!("启动安装程序失败：{}", e))?;
    }

    app.exit(0);
    Ok(())
}
