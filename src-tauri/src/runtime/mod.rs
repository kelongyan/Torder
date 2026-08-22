pub mod notifier;
pub mod scheduler;

use std::thread;
use std::time::Duration;

/// 启动一个 60s 轮询的后台线程。`on_poll` 在每次轮询间隔执行；
/// `sleep_first` 为 true 时先休眠再执行（用于启动补扫已覆盖首轮的场景）。
pub fn spawn_poller(
    sleep_first: bool,
    on_poll: impl FnMut() + Send + 'static,
) {
    thread::spawn(move || {
        let mut on_poll = on_poll;
        loop {
            if sleep_first {
                thread::sleep(Duration::from_secs(60));
                on_poll();
            } else {
                on_poll();
                thread::sleep(Duration::from_secs(60));
            }
        }
    });
}
