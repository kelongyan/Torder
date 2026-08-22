pub mod credentials;
pub mod crypto;
pub mod engine;
pub mod manifest;
pub mod webdav;

#[derive(Default)]
pub struct SyncRuntime {
    gate: tokio::sync::Mutex<()>,
}

impl SyncRuntime {
    pub fn try_lock(&self) -> Result<tokio::sync::MutexGuard<'_, ()>, &'static str> {
        self.gate.try_lock().map_err(|_| "sync is already running")
    }
}
