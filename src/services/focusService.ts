import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * 专注结束系统通知（阶段 A）。
 * 发送权威在 Rust notifier（P0-02 红线：前端禁接系统通知通道）：
 * 浏览器模式直接 no-op；Tauri 模式调命令，命令内部受「系统通知」开关门控。
 * 通知失败不抛给调用方（UI 以 toast 兜底）。
 */
export async function notifyFocusFinished(): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke("notify_focus_finished");
  } catch {
    // 系统通知不可用/被关时静默：专注本身不受影响。
  }
}
