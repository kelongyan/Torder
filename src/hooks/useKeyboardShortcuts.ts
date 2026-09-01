import { useEffect } from "react";
import { isTypingTarget } from "../utils/taskHelpers";
import { isMobile } from "../utils/platform";
import { toggleSidebarCollapsed } from "./useSidebarCollapsed";

interface KeyboardShortcutsHandlers {
  onOpenCreateDialog: () => void;
  onOpenShortcuts: () => void;
  onToggleBatchMode: () => void;
  onEscape: () => void;
}

/** R3：Ctrl F 聚焦侧栏搜索框（设计稿快捷键表，视觉迁移先行，行为为本体真实聚焦）。 */
function focusSidebarSearch(): void {
  document.getElementById("sidebar-search-input")?.focus();
}

export function useKeyboardShortcuts({
  onOpenCreateDialog,
  onOpenShortcuts,
  onToggleBatchMode,
  onEscape,
}: KeyboardShortcutsHandlers) {
  useEffect(() => {
    // 移动端无物理键盘，整组快捷键禁用
    if (isMobile()) return;

    function handleKeydown(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      const typing = isTypingTarget(event.target);

      if (event.ctrlKey && !event.altKey && !event.shiftKey && key === "n") {
        event.preventDefault();
        onOpenCreateDialog();
        return;
      }

      // R2：Ctrl B 折叠/展开侧栏（输入中不响应，避免拦截输入法/加粗）
      if (
        event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        key === "b" &&
        !typing
      ) {
        event.preventDefault();
        toggleSidebarCollapsed();
        return;
      }

      // R2：Ctrl F 聚焦搜索（含输入中，与浏览器查找一致的习惯）
      if (event.ctrlKey && !event.altKey && !event.shiftKey && key === "f") {
        event.preventDefault();
        focusSidebarSearch();
        return;
      }

      if (typing) return;

      if (event.key === "?") {
        event.preventDefault();
        onOpenShortcuts();
        return;
      }

      // 无修饰的 B 才是批量模式（Ctrl B 已被侧栏折叠占用）
      if (key === "b" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        onToggleBatchMode();
        return;
      }

      if (event.key === "Escape") {
        onEscape();
      }
    }

    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, [onOpenCreateDialog, onOpenShortcuts, onToggleBatchMode, onEscape]);
}
