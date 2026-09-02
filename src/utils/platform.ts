import { isTauri } from "@tauri-apps/api/core";

const FORCE_MOBILE_KEY = "torder-force-mobile";

/**
 * 是否为移动端 Tauri 运行时（Android / iOS）。
 * Android WebView 的 userAgent 必然包含 "Android"，iOS WKWebView 同理。
 *
 * 浏览器 mock 模式（pnpm dev）下默认 false；如需在桌面浏览器预览移动端
 * 布局（UI 调试/截图），在 localStorage 写入 `torder-force-mobile = "1"`
 * 即可强制返回 true（不持久影响真机运行）。
 */
export function isMobile(): boolean {
  if (isTauri()) {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  }
  try {
    return localStorage.getItem(FORCE_MOBILE_KEY) === "1";
  } catch {
    return false;
  }
}
