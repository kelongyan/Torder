import { isTauri } from "@tauri-apps/api/core";

/**
 * 是否为移动端 Tauri 运行时（Android / iOS）。
 * 浏览器 mock 模式（pnpm dev）下恒为 false。
 * Android WebView 的 userAgent 必然包含 "Android"，iOS WKWebView 同理。
 */
export function isMobile(): boolean {
  if (!isTauri()) return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}