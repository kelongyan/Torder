/**
 * toast.js — 轻提示（桌面端宿主挂在 .desktop-root，右下角堆叠自动消失）
 */
import { h } from "./dom.js";

let host = null;
function ensureHost() {
  if (!host || !host.isConnected) {
    host = h("div.toast-host");
    document.body.append(host);
  }
  return host;
}

export function toast(message, duration = 2000) {
  const el = h("div.toast", { text: message });
  ensureHost().append(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 180);
  }, duration);
}
