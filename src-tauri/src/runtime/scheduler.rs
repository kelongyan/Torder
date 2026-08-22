use tauri::{AppHandle, Emitter};

use super::spawn_poller;
use crate::db::recurring_repository::RecurringRuleRepository;
use crate::db::Database;

pub fn start(app_handle: AppHandle, database: Database) {
    // 启动时立即补生成一次：移动端后台被冻结时不会轮询，
    // 打开应用时先补齐到期实例，避免循环任务漏生成。
    match RecurringRuleRepository::new(&database).generate_due() {
        Ok(result) if result.generated_count > 0 => {
            let _ = app_handle.emit("recurring-tasks-generated", result);
        }
        Ok(_) => {}
        Err(error) => eprintln!("recurring scheduler startup error: {error}"),
    }

    // 移动端不启动轮询线程（后台会被系统冻结），依赖启动补扫。
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    spawn_poller(false, move || {
        match RecurringRuleRepository::new(&database).generate_due() {
            Ok(result) if result.generated_count > 0 => {
                let _ = app_handle.emit("recurring-tasks-generated", result);
            }
            Ok(_) => {}
            Err(error) => eprintln!("recurring scheduler error: {error}"),
        }
    });
}
