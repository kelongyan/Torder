use tauri::State;

use crate::db::task_repository::{TagChange, TaskRepository};
use crate::db::Database;

/// 标签管理（T-07 二期）：全表批量改写 tasks.tags。
/// action: "rename" | "merge" | "remove"；返回实际受影响任务数。
/// 约束：from 非空且 ≠ to；目标标签按 sync validate 同口径（≤40 字节）在
/// 仓库层过滤，结果永不产生空标签或超长标签。
#[tauri::command]
pub fn manage_tag(
    action: String,
    from_tag: String,
    to_tag: Option<String>,
    database: State<'_, Database>,
) -> Result<u32, String> {
    let from = from_tag.trim().to_string();
    if from.is_empty() {
        return Err("标签不能为空".to_string());
    }
    let change = match action.as_str() {
        "remove" => TagChange::Remove { from },
        "rename" | "merge" => {
            let to = to_tag
                .map(|tag| tag.trim().to_string())
                .filter(|tag| !tag.is_empty())
                .ok_or_else(|| format!("{action} 需要目标标签"))?;
            if to == from {
                return Err("目标标签与源标签相同".to_string());
            }
            if action == "rename" {
                TagChange::Rename { from, to }
            } else {
                TagChange::Merge { from, to }
            }
        }
        _ => return Err(format!("未知操作: {action}")),
    };
    let affected = TaskRepository::new(&database)
        .apply_tag_change(&change)
        .map_err(|error| error.to_string())?;
    Ok(affected as u32)
}
