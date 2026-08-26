import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import { WidgetApp } from "./app/WidgetApp";
import "./styles/globals.css";

// 桌面小窗是同一前端的独立入口（Tauri 以 #widget 建窗），不加载主应用
const isWidgetEntry = window.location.hash === "#widget";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isWidgetEntry ? <WidgetApp /> : <App />}
  </React.StrictMode>,
);
