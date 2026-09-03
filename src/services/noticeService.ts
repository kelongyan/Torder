import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * 通用桌面系统通知（阶段 D · T-10 乙组）。
 * 发送权威在 Rust（P0-02）：受「系统通知」开关门控；浏览器模式 no-op。
 * 供前端定时触发（每日回顾提醒等非任务类提示）使用。
 */
export async function sendNotice(title: string, body: string): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke("send_notice", { title, body });
  } catch {
    // 通知不可用静默：不影响业务动作本身。
  }
}
