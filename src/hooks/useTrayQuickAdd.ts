import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { normalizeError } from "../utils/taskHelpers";

export function useTrayQuickAdd(
  onQuickAdd: () => void,
  setAppError: (error: string | null) => void,
) {
  useEffect(() => {
    if (!isTauri()) return;

    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void listen("tray-quick-add", () => {
      onQuickAdd();
    })
      .then((nextUnlisten) => {
        if (cancelled) nextUnlisten();
        else unlisten = nextUnlisten;
      })
      .catch((nextError: unknown) => {
        if (!cancelled) setAppError(normalizeError(nextError));
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [onQuickAdd, setAppError]);
}
