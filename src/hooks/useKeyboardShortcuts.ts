import { useEffect } from "react";
import { isTypingTarget } from "../utils/taskHelpers";

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
