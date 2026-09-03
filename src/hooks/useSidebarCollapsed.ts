import { useEffect, useState } from "react";

/**
 * R2 侧栏折叠状态（设计稿 --sidebar-w-collapsed 68px / Ctrl B）。
 * 纯 UI 状态：不走 taskStore（避免改动 store 持久化语义），
 * 模块级单例 + localStorage 记忆，供 Sidebar 与快捷键共享。
 */
const STORAGE_KEY = "torder-sidebar-collapsed";

function readInitial(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

let collapsed = readInitial();
const listeners = new Set<() => void>();

export function toggleSidebarCollapsed(): void {
  collapsed = !collapsed;
  try {
    localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
  } catch {
    // localStorage 不可用时仅会话内生效
  }
  listeners.forEach((listener) => listener());
}

export function useSidebarCollapsed(): boolean {
  const [value, setValue] = useState(collapsed);
  useEffect(() => {
    const listener = () => setValue(collapsed);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return value;
}
