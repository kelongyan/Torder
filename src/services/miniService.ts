import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * 迷你速记窗开关（阶段 B / T-03）。
 * 窗口生命周期全在 Rust（mini.rs）：不存在则创建，存在则切换可见性，
 * 失焦自动隐藏。浏览器模式（无 Tauri 窗口）直接 no-op。
 */
export async function toggleMini(): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke("toggle_mini");
  } catch {
    // 窗口切换失败静默：不打断主界面操作。
  }
}
