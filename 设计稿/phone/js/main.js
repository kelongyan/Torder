/**
 * main.js — 启动入口（唯一顶层副作用）
 */
import { bootstrap } from "./app.js";

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap);
} else {
  bootstrap();
}
