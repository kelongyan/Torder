import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import { WidgetApp } from "./app/WidgetApp";
import { MiniApp } from "./app/MiniApp";
import {
  applyWidgetAppearanceFromCache,
  readCachedAppTheme,
} from "./services/widgetAppearance";
import "./styles/globals.css";

// 桌面小窗是同一前端的独立入口（Tauri 以 #widget 建窗），不加载主应用
const isWidgetEntry = window.location.hash === "#widget";
// 迷你速记窗（阶段 B / T-03）：#mini 建窗（Rust mini.rs）
const isMiniEntry = window.location.hash === "#mini";

// 首帧前同步应用外观缓存：权威设置要等 IPC 异步返回，期间会闪一帧默认纸色；
// 缓存由 patchWidgetSettings 写通（两窗口共享 localStorage），只作启动提示不作数据源。
// 应用主题缓存先于外观应用：widget 窗口首帧即持有正确的 data-theme（壳层样式依赖）。
if (isWidgetEntry) {
  const cachedDark = readCachedAppTheme();
  if (cachedDark !== null) {
    document.documentElement.classList.toggle("dark", cachedDark);
    document.documentElement.dataset.theme = cachedDark ? "dark" : "light";
  }
  applyWidgetAppearanceFromCache();
}

// 禁用默认浏览器右键菜单（刷新/另存为/打印等），保持原生桌面应用质感
window.addEventListener("contextmenu", (event) => {
  const target = event.target as HTMLElement | null;
  const isEditable =
    target &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable);

  if (isWidgetEntry || !isEditable) {
    event.preventDefault();
  }
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isWidgetEntry ? <WidgetApp /> : isMiniEntry ? <MiniApp /> : <App />}
  </React.StrictMode>,
);
