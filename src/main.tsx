import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import { WidgetApp } from "./app/WidgetApp";
import {
  applyWidgetAppearanceFromCache,
  readCachedAppTheme,
} from "./services/widgetAppearance";
import "./styles/globals.css";

// 桌面小窗是同一前端的独立入口（Tauri 以 #widget 建窗），不加载主应用
const isWidgetEntry = window.location.hash === "#widget";

// 首帧前同步应用外观缓存：权威设置要等 IPC 异步返回，期间会闪一帧默认纸色；
// 缓存由 patchWidgetSettings 写通（两窗口共享 localStorage），只作启动提示不作数据源。
// 应用主题缓存先于外观应用：noteTheme === "auto" 的暗/亮解析依赖 data-theme。
if (isWidgetEntry) {
  const cachedDark = readCachedAppTheme();
  if (cachedDark !== null) {
    document.documentElement.classList.toggle("dark", cachedDark);
    document.documentElement.dataset.theme = cachedDark ? "dark" : "light";
  }
  applyWidgetAppearanceFromCache();
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isWidgetEntry ? <WidgetApp /> : <App />}
  </React.StrictMode>,
);
