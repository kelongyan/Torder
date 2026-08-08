use std::time::Duration;

use tauri::{AppHandle, Emitter};

use crate::db::recurring_repository::RecurringRuleRepository;
use crate::db::Database;

pub fn start(app_handle: AppHandle, database: Database) {
    std::thread::spawn(move || loop {
        match RecurringRuleRepository::new(&database).generate_due() {
            Ok(result) if result.generated_count > 0 => {
                let _ = app_handle.emit("recurring-tasks-generated", result);
            }
            Ok(_) => {}
            Err(error) => eprintln!("recurring scheduler error: {error}"),
        }
        std::thread::sleep(Duration::from_secs(60));
    });
}
