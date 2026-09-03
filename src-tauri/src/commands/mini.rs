use tauri::AppHandle;

/// 切换迷你速记窗可见性（不存在则创建；失焦自动隐藏逻辑在 mini 窗口事件内）。
#[tauri::command]
pub fn toggle_mini(app: AppHandle) -> Result<(), String> {
    crate::mini::toggle_mini_window(&app).map_err(|error| error.to_string())
}
