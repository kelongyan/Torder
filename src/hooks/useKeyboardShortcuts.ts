import { useEffect } from "react";
import { isTypingTarget } from "../utils/taskHelpers";
import { isMobile } from "../utils/platform";

interface KeyboardShortcutsHandlers {
  onOpenCreateDialog: () => void;
  onOpenShortcuts: () => void;
  onToggleBatchMode: () => void;
  onEscape: () => void;
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

      if (typing) return;

      if (event.key === "?") {
        event.preventDefault();
        onOpenShortcuts();
        return;
      }

      if (key === "b") {
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
