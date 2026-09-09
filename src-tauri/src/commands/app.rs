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

/// reqwest 的 `to_string()` 只含外层文案（如「error sending request for url」），
/// DNS 解析失败、连接超时等真实死因在 source 链里——更新失败的报错必须带全链，
/// 否则无法区分代理失效 / IPv6 悬挂 / 域名被污染。
fn error_chain(error: &reqwest::Error) -> String {
    let mut message = error.to_string();
    let mut source = std::error::Error::source(error);
    while let Some(cause) = source {
        message.push_str(&format!("：{}", cause));
        source = cause.source();
    }
    message
}

/// 解析 host 的首个 IPv4。直连回退时用它绑定 A 记录：本机 IPv6 路由半残时
/// （国内家庭网络常见），默认的地址选择会先试 IPv6 并悬挂到超时。
fn first_ipv4(host: &str) -> Option<std::net::SocketAddr> {
    use std::net::ToSocketAddrs;
    (host, 443)
        .to_socket_addrs()
        .ok()?
        .find(|addr| addr.is_ipv4())
}

/// 探测本机常见代理端口（Clash Verge 7897 / Clash 7890 / v2rayN 10809）。
/// 系统代理开关没开但代理进程在跑是国内常态，探测到就用它兜底 GitHub 等
/// 直连不通的域名。
fn detect_local_proxy() -> Option<String> {
    const CANDIDATE_PORTS: [u16; 3] = [7897, 7890, 10809];
    for port in CANDIDATE_PORTS {
        let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
        if std::net::TcpStream::connect_timeout(&addr, std::time::Duration::from_millis(300))
            .is_ok()
        {
            return Some(format!("http://127.0.0.1:{}", port));
        }
    }
    None
}

/// 更新器的网络路径序列，按序尝试：
/// 1. 系统代理（reqwest 默认；未启用时等同直连）
/// 2. 本机在跑的代理进程（系统代理开关没开但 Clash 等在监听的国内常态）
/// 3. 直连并绑定解析出的首个 IPv4（规避本机 IPv6 路由半残时的悬挂超时）
/// 返回 (路径描述, 客户端)，描述用于聚合报错。connect_timeout 让死路径快速失败，
/// total_timeout 仅用于小体积清单请求，大文件下载不限总时长。
fn update_clients(
    user_agent: &str,
    total_timeout: Option<u64>,
    url: &str,
) -> Result<Vec<(String, reqwest::Client)>, String> {
    let host = reqwest::Url::parse(url)
        .ok()
        .and_then(|parsed| parsed.host_str().map(str::to_string));
    let pinned = match (&host, first_ipv4(host.as_deref().unwrap_or(""))) {
        (Some(domain), Some(addr)) => Some((domain.clone(), addr)),
        _ => None,
    };

    let mut configs: Vec<(String, bool, Option<String>, Option<(String, std::net::SocketAddr)>)> =
        Vec::with_capacity(3);
    configs.push(("系统代理".to_string(), false, None, None));
    if let Some(proxy_url) = detect_local_proxy() {
        configs.push((
            format!("本机代理 {}", proxy_url),
            false,
            Some(proxy_url.clone()),
            None,
        ));
    }
    configs.push((
        pinned
            .as_ref()
            .map(|(_, addr)| format!("直连(IPv4 {})", addr.ip()))
            .unwrap_or_else(|| "直连".to_string()),
        true,
        None,
        pinned,
    ));

    let mut clients = Vec::with_capacity(configs.len());
    for (label, direct, proxy_url, pin) in configs {
        let mut builder = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(10))
            .user_agent(user_agent);
        if let Some(secs) = total_timeout {
            builder = builder.timeout(std::time::Duration::from_secs(secs));
        }
        if let Some(proxy_url) = proxy_url {
            builder = builder.proxy(
                reqwest::Proxy::all(&proxy_url)
                    .map_err(|error| format!("代理配置非法：{}", error))?,
            );
        } else if direct {
            builder = builder.no_proxy();
        }
        if let Some((domain, addr)) = pin {
            builder = builder.resolve(&domain, addr);
        }
        clients.push((
            label,
            builder
                .build()
                .map_err(|error| format!("初始化网络客户端失败：{}", error))?,
        ));
    }
    Ok(clients)
}

/// 按路径序列依次拉取文本，全部失败时聚合每条路径的原因（带路径标签），
/// 便于区分是代理、直连还是 DNS 的问题。
async fn fetch_text_via_clients(
    clients: &[(String, reqwest::Client)],
    url: &str,
) -> Result<String, String> {
    let mut failures: Vec<String> = Vec::new();
    for (label, client) in clients {
        let response = match client.get(url).send().await {
            Ok(response) => response,
            Err(error) => {
                failures.push(format!("[{}] {}", label, error_chain(&error)));
                continue;
            }
        };
        if !response.status().is_success() {
            // HTTP 层错误说明链路本身已通，换网络路径结果不会不同，直接带状态码返回。
            return Err(format!("请求失败（HTTP {}）", response.status()));
        }
        return response
            .text()
            .await
            .map_err(|error| format!("读取内容失败：{}", error_chain(&error)));
    }
    Err(format!(
        "网络请求失败（{} 条路径均失败）：{}",
        failures.len(),
        failures.join("；")
    ))
}

#[tauri::command]
pub async fn fetch_update_manifest(source: Option<String>) -> Result<String, String> {
    // Gitee 国内直连稳定为主源；GitHub 兜底（已发布旧客户端只认 GitHub，
    // Gitee 故障时也是后备）。Android 在 GitHub 源仍走清单文件：Latest release
    // 可能没有 APK 资产，Releases API 路径对安卓会报「缺少当前平台的安装包」。
    let url = match source.as_deref() {
        // Gitee 必须用列表接口：/releases/latest 按 release 创建时间取"最新"，
        // 回填历史版本时旧版会排前面（v2.7.1 附件后补晚于 v2.7.5），由前端
        // pickLatestRelease 按 semver 挑最高的非预发布版本。
        Some("gitee") => "https://gitee.com/api/v5/repos/yankelong/Torder/releases?per_page=100",
        Some("github") | None => {
            if cfg!(target_os = "android") {
                "https://kelongyan.github.io/Torder/latest.json"
            } else {
                "https://api.github.com/repos/kelongyan/Torder/releases/latest"
            }
        }
        Some(other) => return Err(format!("未知的更新源：{}", other)),
    };
    let clients = update_clients("Torder-App", Some(10), url)?;
    fetch_text_via_clients(&clients, url).await
}

/// 拉取更新相关的小文本资源（如 .sha256 校验文件）：仅允许 https，
/// 复用更新器的多路径网络策略，内容上限 1MB（校验文件不该更大）。
#[tauri::command]
pub async fn fetch_text(url: String) -> Result<String, String> {
    if !url.starts_with("https://") {
        return Err("地址不合法（仅支持 HTTPS）".to_string());
    }
    let clients = update_clients("Torder-App", Some(10), &url)?;
    let text = fetch_text_via_clients(&clients, &url).await?;
    if text.len() > 1024 * 1024 {
        return Err("内容超过大小上限（1MB）".to_string());
    }
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

    let clients = update_clients("Torder-App-Updater", None, &url)?;
    let mut failures: Vec<String> = Vec::new();

    'attempts: for (label, client) in &clients {
        let mut response = match client.get(&url).send().await {
            Ok(response) => response,
            Err(error) => {
                failures.push(format!("[{}] {}", label, error_chain(&error)));
                continue 'attempts;
            }
        };

        if !response.status().is_success() {
            // 链路已通，HTTP 层错误换网络路径结果不会不同，直接带状态码返回。
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

        loop {
            let chunk = match response.chunk().await {
                Ok(Some(chunk)) => chunk,
                Ok(None) => break,
                Err(error) => {
                    // 传输中断视为本条路径失败：换下一条网络路径从头重试（文件与哈希按新尝试重开）。
                    failures.push(format!("[{}] {}", label, error_chain(&error)));
                    continue 'attempts;
                }
            };
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

        return target_path
            .to_str()
            .map(|s| s.to_string())
            .ok_or_else(|| "安装包路径转换失败".to_string());
    }

    Err(format!(
        "下载安装包失败（{} 条路径均失败）：{}",
        failures.len(),
        failures.join("；")
    ))
}

/// 启动安装包时，刚写完的文件常被 Defender/杀软实时扫描短暂锁定
/// （os error 32 共享冲突）。间隔重试等锁释放，约 5 秒窗口；
/// 其余错误（文件不存在、权限等）不重试，立即返回。
#[cfg(target_os = "windows")]
fn spawn_installer_with_retry(path: &std::path::Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    use std::time::Duration;

    let waits = [0u64, 500, 1_000, 1_500, 2_000];
    let mut last: Option<std::io::Error> = None;
    for wait in waits {
        if wait > 0 {
            std::thread::sleep(Duration::from_millis(wait));
        }
        match std::process::Command::new(path)
            .creation_flags(0x00000008) // DETACHED_PROCESS
            .spawn()
        {
            Ok(_) => return Ok(()),
            Err(error) if error.raw_os_error() == Some(32) => last = Some(error),
            Err(error) => return Err(format!("启动安装程序失败：{}", error)),
        }
    }
    Err(format!(
        "启动安装程序失败：{}（安装包可能被杀毒软件暂时锁定，请稍后重试）",
        last.map(|e| e.to_string()).unwrap_or_default()
    ))
}

#[tauri::command]
pub fn launch_installer_and_exit(app: tauri::AppHandle, installer_path: String) -> Result<(), String> {
    let path = std::path::Path::new(&installer_path);
    if !path.exists() {
        return Err("安装包文件不存在".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        spawn_installer_with_retry(path)?;
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
