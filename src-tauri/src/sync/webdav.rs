use std::time::Duration;

use quick_xml::events::Event;
use reqwest::{Client, Method, StatusCode, Url};

const MAX_JSON_BYTES: usize = 1024 * 1024;
const MAX_SNAPSHOT_BYTES: usize = 16 * 1024 * 1024;
const MAX_BLOB_BYTES: usize = 100 * 1024 * 1024 + 1024;
const MAX_ATTEMPTS: usize = 3;
const MAX_ERROR_BYTES: usize = 4096;

#[derive(Debug)]
pub enum WebDavError {
    InvalidUrl,
    InsecureUrl,
    Request(reqwest::Error),
    Http(StatusCode),
    BodyTooLarge,
    /// 带上下文的 HTTP 错误（方法与 URL），用于定位 403 这类“看不出是哪个请求”的失败。
    Context(&'static str, String),
    /// 服务端配额耗尽（坚果云 `TrafficRateExhausted`）。
    ///
    /// 坚果云免费账号每月有下载流量上限，耗尽后连 manifest 都拒绝读取，但
    /// PROPFIND（元数据）仍正常——所以它**不是**鉴权失败，重输密码也没用。
    /// 单独建一个变体，避免被 `sync_error_state` 误判成 `needsAuth`。
    QuotaExhausted(String),
}

impl std::fmt::Display for WebDavError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidUrl => write!(formatter, "invalid WebDAV URL"),
            Self::InsecureUrl => write!(formatter, "WebDAV URL must use HTTPS"),
            Self::Request(error) => write!(formatter, "WebDAV request failed: {error}"),
            Self::Http(status) => write!(formatter, "WebDAV server returned HTTP {status}"),
            Self::BodyTooLarge => write!(formatter, "WebDAV response is too large"),
            Self::Context(label, detail) => write!(formatter, "{label}: {detail}"),
            Self::QuotaExhausted(detail) => write!(
                formatter,
                "WebDAV 流量配额已耗尽（TrafficRateExhausted）：{detail}；请等待配额重置或升级账户后再同步。"
            ),
        }
    }
}

impl std::error::Error for WebDavError {}

#[derive(Clone)]
pub struct WebDavClient {
    client: Client,
    base_url: Url,
    username: Option<String>,
    password: Option<String>,
}

impl WebDavClient {
    pub fn new(
        server_url: &str,
        username: Option<String>,
        password: Option<String>,
    ) -> Result<Self, WebDavError> {
        let mut base_url = Url::parse(server_url).map_err(|_| WebDavError::InvalidUrl)?;
        if base_url.scheme() != "https" {
            return Err(WebDavError::InsecureUrl);
        }
        if !base_url.username().is_empty() || base_url.password().is_some() {
            return Err(WebDavError::InvalidUrl);
        }
        if !base_url.path().ends_with('/') {
            let path = format!("{}/", base_url.path());
            base_url.set_path(&path);
        }
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(WebDavError::Request)?;
        Ok(Self {
            client,
            base_url,
            username,
            password,
        })
    }

    #[cfg(test)]
    pub(crate) fn new_for_test(address: std::net::SocketAddr) -> Self {
        Self {
            client: Client::builder()
                .timeout(Duration::from_secs(2))
                .build()
                .expect("test HTTP client"),
            base_url: Url::parse(&format!("http://{address}/")).expect("test server URL"),
            username: None,
            password: None,
        }
    }

    pub async fn options(&self) -> Result<(), WebDavError> {
        self.request(Method::OPTIONS, self.base_url.clone(), None)
            .await
            .map(|_| ())
    }

    pub async fn mkcol(&self, path: &str) -> Result<(), WebDavError> {
        let url = self.url(path)?;
        self.request(
            Method::from_bytes(b"MKCOL").expect("MKCOL is valid"),
            url,
            None,
        )
        .await
        .map(|_| ())
    }

    pub async fn delete(&self, path: &str) -> Result<(), WebDavError> {
        self.request(Method::DELETE, self.url(path)?, None)
            .await
            .map(|_| ())
    }

    pub async fn propfind_hrefs(&self, path: &str) -> Result<Vec<String>, WebDavError> {
        let mut response = self
            .request_with_conditions(
                Method::from_bytes(b"PROPFIND").expect("PROPFIND is valid"),
                self.url(path)?,
                None,
                None,
                None,
                Some("1"),
            )
            .await?;
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(WebDavError::Request)? {
            if bytes.len() + chunk.len() > MAX_JSON_BYTES {
                return Err(WebDavError::BodyTooLarge);
            }
            bytes.extend_from_slice(&chunk);
        }
        let mut reader = quick_xml::Reader::from_reader(bytes.as_slice());
        reader.config_mut().trim_text(true);
        let mut hrefs = Vec::new();
        loop {
            match reader.read_event() {
                Ok(Event::Start(element)) if element.local_name().as_ref() == b"href" => {
                    let value = reader
                        .read_text(element.name())
                        .map_err(|_| WebDavError::Http(StatusCode::UNPROCESSABLE_ENTITY))?;
                    hrefs.push(value.into_owned());
                }
                Ok(Event::Eof) => break,
                Ok(_) => {}
                Err(_) => return Err(WebDavError::Http(StatusCode::UNPROCESSABLE_ENTITY)),
            }
        }
        Ok(hrefs)
    }

    /// 存在性探测（PROPFIND Depth: 0），404/409 视为不存在。
    ///
    /// 「仅创建」写入不能只靠 `If-None-Match: *`：坚果云等服务端会直接忽略该前置条件
    /// 并覆盖已有文件（实测返回 204），于是另一台设备刚占位的变更批次会被静默摧毁。
    /// 所有 create-only 写入都先用这个方法探一次。
    pub async fn exists(&self, path: &str) -> Result<bool, WebDavError> {
        match self
            .request_with_conditions(
                Method::from_bytes(b"PROPFIND").expect("PROPFIND is valid"),
                self.url(path)?,
                None,
                None,
                None,
                Some("0"),
            )
            .await
        {
            Ok(_) => Ok(true),
            Err(WebDavError::Http(status))
                if status == StatusCode::NOT_FOUND || status == StatusCode::CONFLICT =>
            {
                Ok(false)
            }
            Err(error) => Err(error),
        }
    }

    pub async fn get_json(&self, path: &str) -> Result<serde_json::Value, WebDavError> {
        Ok(self.get_json_with_etag(path).await?.0)
    }

    pub async fn get_snapshot(&self, path: &str) -> Result<Vec<u8>, WebDavError> {
        self.get_bytes(path, MAX_SNAPSHOT_BYTES).await
    }

    pub async fn get_blob(&self, path: &str) -> Result<Vec<u8>, WebDavError> {
        self.get_bytes(path, MAX_BLOB_BYTES).await
    }

    pub async fn put_snapshot_if_none_match(
        &self,
        path: &str,
        payload: Vec<u8>,
    ) -> Result<(), WebDavError> {
        if payload.len() > MAX_SNAPSHOT_BYTES {
            return Err(WebDavError::BodyTooLarge);
        }
        self.request_with_headers(
            Method::PUT,
            self.url(path)?,
            Some(payload),
            None,
            Some("*"),
            None,
            Some("application/json"),
            Some("gzip"),
        )
        .await
        .map(|_| ())
    }

    pub async fn put_blob_if_none_match(
        &self,
        path: &str,
        payload: Vec<u8>,
    ) -> Result<(), WebDavError> {
        if payload.len() > MAX_BLOB_BYTES {
            return Err(WebDavError::BodyTooLarge);
        }
        self.request_with_headers(
            Method::PUT,
            self.url(path)?,
            Some(payload),
            None,
            Some("*"),
            None,
            Some("application/octet-stream"),
            None,
        )
        .await
        .map(|_| ())
    }

    pub async fn get_json_with_etag(
        &self,
        path: &str,
    ) -> Result<(serde_json::Value, Option<String>), WebDavError> {
        let mut response = self.request(Method::GET, self.url(path)?, None).await?;
        let etag = response
            .headers()
            .get(reqwest::header::ETAG)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        if response
            .content_length()
            .is_some_and(|length| length > MAX_JSON_BYTES as u64)
        {
            return Err(WebDavError::BodyTooLarge);
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(WebDavError::Request)? {
            if bytes.len() + chunk.len() > MAX_JSON_BYTES {
                return Err(WebDavError::BodyTooLarge);
            }
            bytes.extend_from_slice(&chunk);
        }
        let value = serde_json::from_slice(&bytes)
            .map_err(|_| WebDavError::Http(StatusCode::UNPROCESSABLE_ENTITY))?;
        Ok((value, etag))
    }

    pub async fn put_json(
        &self,
        path: &str,
        payload: &serde_json::Value,
    ) -> Result<(), WebDavError> {
        self.put_json_condition(path, payload, None, None).await
    }

    pub async fn put_json_if_match(
        &self,
        path: &str,
        payload: &serde_json::Value,
        etag: &str,
    ) -> Result<(), WebDavError> {
        self.put_json_condition(path, payload, Some(etag), None)
            .await
    }

    pub async fn put_json_if_none_match(
        &self,
        path: &str,
        payload: &serde_json::Value,
    ) -> Result<(), WebDavError> {
        self.put_json_condition(path, payload, None, Some("*"))
            .await
    }

    async fn put_json_condition(
        &self,
        path: &str,
        payload: &serde_json::Value,
        if_match: Option<&str>,
        if_none_match: Option<&str>,
    ) -> Result<(), WebDavError> {
        let body = serde_json::to_vec(payload)
            .map_err(|_| WebDavError::Http(StatusCode::UNPROCESSABLE_ENTITY))?;
        if body.len() > MAX_JSON_BYTES {
            return Err(WebDavError::BodyTooLarge);
        }
        self.request_with_conditions(
            Method::PUT,
            self.url(path)?,
            Some(body),
            if_match,
            if_none_match,
            None,
        )
        .await
        .map(|_| ())
    }

    async fn get_bytes(&self, path: &str, max_bytes: usize) -> Result<Vec<u8>, WebDavError> {
        let mut response = self.request(Method::GET, self.url(path)?, None).await?;
        if response
            .content_length()
            .is_some_and(|length| length > max_bytes as u64)
        {
            return Err(WebDavError::BodyTooLarge);
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(WebDavError::Request)? {
            if bytes.len() + chunk.len() > max_bytes {
                return Err(WebDavError::BodyTooLarge);
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok(bytes)
    }

    fn url(&self, path: &str) -> Result<Url, WebDavError> {
        if path
            .split('/')
            .any(|segment| segment == "." || segment == "..")
            || path.contains('?')
            || path.contains('#')
            || path.chars().any(char::is_control)
        {
            return Err(WebDavError::InvalidUrl);
        }
        self.base_url
            .join(path.trim_start_matches('/'))
            .map_err(|_| WebDavError::InvalidUrl)
    }

    async fn request(
        &self,
        method: Method,
        url: Url,
        body: Option<Vec<u8>>,
    ) -> Result<reqwest::Response, WebDavError> {
        self.request_with_conditions(method, url, body, None, None, None)
            .await
    }

    async fn request_with_conditions(
        &self,
        method: Method,
        url: Url,
        body: Option<Vec<u8>>,
        if_match: Option<&str>,
        if_none_match: Option<&str>,
        depth: Option<&str>,
    ) -> Result<reqwest::Response, WebDavError> {
        self.request_with_headers(
            method,
            url,
            body,
            if_match,
            if_none_match,
            depth,
            Some("application/json"),
            None,
        )
        .await
    }

    #[allow(clippy::too_many_arguments)]
    async fn request_with_headers(
        &self,
        method: Method,
        url: Url,
        body: Option<Vec<u8>>,
        if_match: Option<&str>,
        if_none_match: Option<&str>,
        depth: Option<&str>,
        content_type: Option<&str>,
        content_encoding: Option<&str>,
    ) -> Result<reqwest::Response, WebDavError> {
        for attempt in 0..MAX_ATTEMPTS {
            let mut request = self.client.request(method.clone(), url.clone());
            if let (Some(username), Some(password)) = (&self.username, &self.password) {
                request = request.basic_auth(username, Some(password));
            }
            if let Some(body) = body.as_ref() {
                request = request.body(body.clone());
                if let Some(value) = content_type {
                    request = request.header("content-type", value);
                }
                if let Some(value) = content_encoding {
                    request = request.header("content-encoding", value);
                }
            }
            if let Some(value) = if_match {
                request = request.header(reqwest::header::IF_MATCH, value);
            }
            if let Some(value) = if_none_match {
                request = request.header(reqwest::header::IF_NONE_MATCH, value);
            }
            if let Some(value) = depth {
                request = request.header("depth", value);
            }
            match request.send().await {
                Ok(response) if response.status().is_success() => return Ok(response),
                Ok(response)
                    if attempt + 1 < MAX_ATTEMPTS && retryable_status(response.status()) =>
                {
                    tokio::time::sleep(retry_delay(attempt)).await;
                }
                Ok(response) => {
                    // 只报 “HTTP 403” 时完全不知道是哪个请求被拒（坚果云限流、
                    // 权限拒绝、路径越权都是 403），排查同步问题无从下手。
                    // 这里把方法与路径一并带进错误消息。
                    let status = response.status();
                    if status == reqwest::StatusCode::FORBIDDEN {
                        let (exception, message) = read_error_body(response).await;
                        if is_quota_exhausted(exception.as_deref(), message.as_deref()) {
                            let detail = message
                                .or(exception)
                                .unwrap_or_else(|| "traffic quota exhausted".to_owned());
                            return Err(WebDavError::QuotaExhausted(detail));
                        }
                        return Err(WebDavError::Context(
                            "WebDAV server returned HTTP 403",
                            format!("{method} {url}"),
                        ));
                    }
                    return Err(WebDavError::Http(status));
                }
                Err(error)
                    if attempt + 1 < MAX_ATTEMPTS && (error.is_timeout() || error.is_connect()) =>
                {
                    tokio::time::sleep(retry_delay(attempt)).await;
                }
                Err(error) => return Err(WebDavError::Request(error)),
            }
        }
        unreachable!("request retry loop always returns")
    }
}

fn retryable_status(status: StatusCode) -> bool {
    status == StatusCode::LOCKED
        || status == StatusCode::TOO_MANY_REQUESTS
        || status.is_server_error()
}

fn retry_delay(attempt: usize) -> Duration {
    Duration::from_millis(match attempt {
        0 => 150,
        _ => 500,
    })
}

/// 读取错误响应体（有上限），返回 WebDAV XML 里的 `exception` / `message`。
///
/// 坚果云把配额耗尽放在 403 的 XML 正文里：
/// `<s:exception>TrafficRateExhausted</s:exception>`。只凭状态码无法与
/// 权限拒绝区分，而两者的用户处置完全不同（等配额 vs 重新登录）。
async fn read_error_body(mut response: reqwest::Response) -> (Option<String>, Option<String>) {
    let mut bytes = Vec::new();
    while let Ok(Some(chunk)) = response.chunk().await {
        if bytes.len() + chunk.len() > MAX_ERROR_BYTES {
            break;
        }
        bytes.extend_from_slice(&chunk);
    }
    parse_error_body(&bytes)
}

fn parse_error_body(body: &[u8]) -> (Option<String>, Option<String>) {
    if body.is_empty() {
        return (None, None);
    }
    let mut reader = quick_xml::Reader::from_reader(body);
    reader.config_mut().trim_text(true);
    let mut exception = None;
    let mut message = None;
    loop {
        match reader.read_event() {
            Ok(Event::Start(element)) => match element.local_name().as_ref() {
                b"exception" => {
                    if let Ok(value) = reader.read_text(element.name()) {
                        exception = Some(value.into_owned());
                    }
                }
                b"message" => {
                    if let Ok(value) = reader.read_text(element.name()) {
                        message = Some(value.into_owned());
                    }
                }
                _ => {}
            },
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    (exception, message)
}

fn is_quota_exhausted(exception: Option<&str>, message: Option<&str>) -> bool {
    exception.is_some_and(|value| value.contains("TrafficRateExhausted"))
        || message.is_some_and(|value| {
            let lower = value.to_ascii_lowercase();
            lower.contains("traffic rate is exhausted") || lower.contains("quota")
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::{SocketAddr, TcpListener};
    use std::sync::mpsc::{self, Receiver};
    use std::thread::JoinHandle;

    #[test]
    fn rejects_insecure_urls() {
        assert!(matches!(
            WebDavClient::new("http://dav.example.test/", None, None),
            Err(WebDavError::InsecureUrl)
        ));
    }

    #[test]
    fn rejects_urls_with_embedded_credentials() {
        assert!(matches!(
            WebDavClient::new("https://alice:secret@dav.example.test/", None, None),
            Err(WebDavError::InvalidUrl)
        ));
    }

    #[test]
    fn normalizes_base_path() {
        let client = WebDavClient::new("https://dav.example.test/torder", None, None).unwrap();
        assert_eq!(client.base_url.path(), "/torder/");
    }

    #[test]
    fn rejects_paths_that_escape_the_configured_remote_directory() {
        let client = WebDavClient::new("https://dav.example.test/torder", None, None).unwrap();
        assert!(matches!(
            client.url("foo/../manifest.json"),
            Err(WebDavError::InvalidUrl)
        ));
        assert!(matches!(
            client.url("manifest.json?outside=1"),
            Err(WebDavError::InvalidUrl)
        ));
    }

    #[test]
    fn conditional_put_sends_precondition_headers() {
        let (address, requests, handle) = spawn_server(vec![response(201), response(201)], None);
        let client = test_client(address, Duration::from_secs(2));
        tauri::async_runtime::block_on(async {
            client
                .put_json_if_match("manifest.json", &serde_json::json!({}), "\"v1\"")
                .await
                .unwrap();
            client
                .put_json_if_none_match("changes/1.json", &serde_json::json!({}))
                .await
                .unwrap();
        });
        let first = requests.recv().unwrap().to_ascii_lowercase();
        let second = requests.recv().unwrap().to_ascii_lowercase();
        assert!(first.contains("if-match: \"v1\""));
        assert!(second.contains("if-none-match: *"));
        handle.join().unwrap();
    }

    #[test]
    fn options_sends_basic_auth_without_logging_credentials() {
        let (address, requests, handle) = spawn_server(vec![response(204)], None);
        let mut client = test_client(address, Duration::from_secs(2));
        client.username = Some("dav-user".to_owned());
        client.password = Some("app-password".to_owned());
        tauri::async_runtime::block_on(client.options()).unwrap();
        let request = requests.recv().unwrap().to_ascii_lowercase();
        assert!(request.contains("authorization: basic"));
        assert!(!request.contains("app-password"));
        handle.join().unwrap();
    }

    #[test]
    fn compressed_snapshot_put_declares_encoding_and_create_only_semantics() {
        let (address, requests, handle) = spawn_server(vec![response(201)], None);
        let client = test_client(address, Duration::from_secs(2));
        tauri::async_runtime::block_on(
            client.put_snapshot_if_none_match("snapshots/1.json.gz", vec![1, 2, 3]),
        )
        .unwrap();
        let request = requests.recv().unwrap().to_ascii_lowercase();
        assert!(request.contains("content-encoding: gzip"));
        assert!(request.contains("content-type: application/json"));
        assert!(request.contains("if-none-match: *"));
        handle.join().unwrap();
    }

    #[test]
    fn propfind_parses_namespaced_hrefs_and_sends_depth() {
        let body = r#"<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/.torder/</d:href></d:response><d:response><d:href>/dav/.torder/manifest.json</d:href></d:response></d:multistatus>"#;
        let response = format!(
            "HTTP/1.1 207 Multi-Status\r\nContent-Type: application/xml\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let (address, requests, handle) = spawn_server(vec![response], None);
        let client = test_client(address, Duration::from_secs(2));
        let hrefs = tauri::async_runtime::block_on(client.propfind_hrefs(".torder")).unwrap();
        assert_eq!(hrefs, vec!["/dav/.torder/", "/dav/.torder/manifest.json"]);
        assert!(requests
            .recv()
            .unwrap()
            .to_ascii_lowercase()
            .contains("depth: 1"));
        handle.join().unwrap();
    }

    #[test]
    fn maps_non_retryable_http_statuses() {
        for status in [401, 404, 409] {
            let (address, _requests, handle) = spawn_server(vec![response(status)], None);
            let client = test_client(address, Duration::from_secs(2));
            let result = tauri::async_runtime::block_on(client.get_json("manifest.json"));
            assert!(matches!(result, Err(WebDavError::Http(value)) if value.as_u16() == status));
            handle.join().unwrap();
        }
    }

    #[test]
    fn detects_webdav_quota_exhaustion_in_403_body() {
        let body = r#"<?xml version="1.0" encoding="UTF-8" standalone="no"?><d:error xmlns:d="DAV:" xmlns:s="http://ns.jianguoyun.com"><s:exception>TrafficRateExhausted</s:exception><s:message>The downstream traffic rate is exhausted. The free rate is 333 while you want to consume 505</s:message></d:error>"#;
        let (address, _requests, handle) = spawn_server(vec![xml_response(403, body)], None);
        let client = test_client(address, Duration::from_secs(2));
        let result = tauri::async_runtime::block_on(client.get_json("manifest.json"));
        match result {
            Err(WebDavError::QuotaExhausted(message)) => {
                assert!(message.contains("downstream traffic rate"));
                assert!(WebDavError::QuotaExhausted(message)
                    .to_string()
                    .contains("TrafficRateExhausted"));
            }
            other => panic!("expected quota exhaustion, got {other:?}"),
        }
        handle.join().unwrap();
    }

    #[test]
    fn keeps_unclassified_403_as_a_context_error() {
        let (address, _requests, handle) =
            spawn_server(vec![xml_response(403, "<d:error/>")], None);
        let client = test_client(address, Duration::from_secs(2));
        let result = tauri::async_runtime::block_on(client.get_json("manifest.json"));
        assert!(matches!(
            result,
            Err(WebDavError::Context(_, detail)) if detail.contains("GET ")
        ));
        handle.join().unwrap();
    }

    #[test]
    fn retries_locked_rate_limited_and_server_errors() {
        for status in [423, 429, 500] {
            let (address, requests, handle) = spawn_server(
                vec![response(status), response(status), json_response("{}")],
                None,
            );
            let client = test_client(address, Duration::from_secs(2));
            let value = tauri::async_runtime::block_on(client.get_json("manifest.json")).unwrap();
            assert_eq!(value, serde_json::json!({}));
            assert_eq!(requests.iter().count(), 3);
            handle.join().unwrap();
        }
    }

    #[test]
    fn rejects_oversized_response_before_reading_body() {
        let oversized = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            MAX_JSON_BYTES + 1
        );
        let (address, _requests, handle) = spawn_server(vec![oversized], None);
        let client = test_client(address, Duration::from_secs(2));
        let result = tauri::async_runtime::block_on(client.get_json("manifest.json"));
        assert!(matches!(result, Err(WebDavError::BodyTooLarge)));
        handle.join().unwrap();
    }

    #[test]
    fn retries_timeout_then_returns_request_error() {
        let (address, requests, handle) = spawn_server(
            vec![
                json_response("{}"),
                json_response("{}"),
                json_response("{}"),
            ],
            Some(Duration::from_millis(80)),
        );
        let client = test_client(address, Duration::from_millis(30));
        let result = tauri::async_runtime::block_on(client.get_json("manifest.json"));
        assert!(matches!(result, Err(WebDavError::Request(error)) if error.is_timeout()));
        assert_eq!(requests.iter().count(), 3);
        handle.join().unwrap();
    }

    fn test_client(address: SocketAddr, timeout: Duration) -> WebDavClient {
        WebDavClient {
            client: Client::builder().timeout(timeout).build().unwrap(),
            base_url: Url::parse(&format!("http://{address}/")).unwrap(),
            username: None,
            password: None,
        }
    }

    fn response(status: u16) -> String {
        let reason = match status {
            201 => "Created",
            401 => "Unauthorized",
            403 => "Forbidden",
            404 => "Not Found",
            409 => "Conflict",
            423 => "Locked",
            429 => "Too Many Requests",
            500 => "Internal Server Error",
            _ => "Error",
        };
        format!("HTTP/1.1 {status} {reason}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
    }

    fn xml_response(status: u16, body: &str) -> String {
        let reason = match status {
            403 => "Forbidden",
            500 => "Internal Server Error",
            _ => "Error",
        };
        format!(
            "HTTP/1.1 {status} {reason}\r\nContent-Type: text/xml; charset=UTF-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
    }

    fn json_response(body: &str) -> String {
        format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
    }

    fn spawn_server(
        responses: Vec<String>,
        delay: Option<Duration>,
    ) -> (SocketAddr, Receiver<String>, JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let (sender, receiver) = mpsc::channel();
        let handle = std::thread::spawn(move || {
            for response in responses {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let request = read_http_request(&mut stream);
                sender
                    .send(String::from_utf8_lossy(&request).into_owned())
                    .unwrap();
                if let Some(delay) = delay {
                    std::thread::sleep(delay);
                }
                let _ = stream.write_all(response.as_bytes());
            }
        });
        (address, receiver, handle)
    }

    /// 读取一个 HTTP 请求：请求头 + 按 `Content-Length` 消费完整请求体。
    ///
    /// 只读到 `\r\n\r\n` 就响应并关闭连接时，请求体仍在途的数据会在 Windows 上
    /// 触发 RST，客户端（hyper）读到不完整消息报 `IncompleteMessage`，导致依赖
    /// 本 mock 服务器的测试 flaky（基线即存在，非业务改动引入）。
    fn read_http_request(stream: &mut std::net::TcpStream) -> Vec<u8> {
        let mut request = Vec::new();
        let mut buffer = [0_u8; 4096];
        let header_end = loop {
            match stream.read(&mut buffer) {
                Ok(0) | Err(_) => return request,
                Ok(count) => {
                    request.extend_from_slice(&buffer[..count]);
                    if let Some(pos) = request.windows(4).position(|w| w == b"\r\n\r\n") {
                        break pos;
                    }
                }
            }
        };
        let head = String::from_utf8_lossy(&request[..header_end]).to_ascii_lowercase();
        let body_len = head
            .lines()
            .find_map(|line| {
                line.strip_prefix("content-length:")
                    .and_then(|value| value.trim().parse::<usize>().ok())
            })
            .unwrap_or(0);
        let total = header_end + 4 + body_len;
        while request.len() < total {
            match stream.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(count) => request.extend_from_slice(&buffer[..count]),
            }
        }
        request
    }
}
