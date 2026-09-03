use tauri::{AppHandle, State};

use crate::db::Database;
use crate::runtime::notifier;

/// 专注结束系统通知（阶段 A / T-02 一期）。
///
/// 前端计时到期后调用；发送权威在 Rust notifier（P0-02 红线），
/// 且受设置「系统通知」开关门控（关闭时静默成功）。
#[tauri::command]
pub fn notify_focus_finished(app: AppHandle, database: State<'_, Database>) -> Result<(), String> {
    let connection = database
        .connect()
        .map_err(|error| format!("db open: {error}"))?;
    notifier::send_focus_finished_notification(&app, &connection)
}
