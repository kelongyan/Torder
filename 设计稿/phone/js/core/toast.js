/**
 * toast.js — 轻提示（单例宿主，自动堆叠与消失）
 */
import { h } from "./dom.js";

let host = null;
function ensureHost() {
  if (!host) {
    host = h("div.toast-host");
    document.querySelector(".phone").append(host);
  }
  return host;
}

export function toast(message, duration = 1800) {
  const el = h("div.toast", { text: message });
  ensureHost().append(el);
  setTimeout(() => {
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 200);
  }, duration);
}
