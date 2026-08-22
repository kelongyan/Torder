import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { normalizeError } from "../utils/normalizeError";
import { isMobile } from "../utils/platform";

export function useTrayQuickAdd(
  onQuickAdd: () => void,
  setAppError: (error: string | null) => void,
) {
  useEffect(() => {
    // 托盘仅桌面存在，移动端无此事件
    if (!isTauri() || isMobile()) return;

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
