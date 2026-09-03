use tauri::{AppHandle, State};

use crate::db::Database;
use crate::runtime::notifier;

/// 通用桌面系统通知（阶段 D · T-10 乙组）：前端定时器到点后调用。
/// 发送权威在 Rust notifier（P0-02），受「系统通知」开关门控。
#[tauri::command]
pub fn send_notice(
    app: AppHandle,
    title: String,
    body: String,
    database: State<'_, Database>,
) -> Result<(), String> {
    let connection = database
        .connect()
        .map_err(|error| format!("db open: {error}"))?;
    notifier::send_text_notification(&app, &connection, &title, &body)
}
