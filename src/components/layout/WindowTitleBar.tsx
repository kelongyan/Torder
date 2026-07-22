import { useEffect, useMemo, useState } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import logoUrl from "../../assets/torder-logo.png";

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function WindowTitleBar() {
  const appWindow = useMemo(
    () => (isTauriRuntime() ? getCurrentWindow() : null),
    [],
  );
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!appWindow) return;

    let disposed = false;
    let unlistenResized: (() => void) | undefined;
    const refreshMaximized = () => {
      void appWindow
        .isMaximized()
        .then((value) => {
          if (!disposed) setMaximized(value);
        })
        .catch(() => undefined);
    };

    refreshMaximized();
    void appWindow
      .onResized(refreshMaximized)
      .then((unlisten) => {
        unlistenResized = unlisten;
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unlistenResized?.();
    };
  }, [appWindow]);

  async function minimizeWindow() {
    if (!appWindow) return;
    await appWindow.minimize();
  }

  async function toggleMaximizeWindow() {
    if (!appWindow) return;
    await appWindow.toggleMaximize();
    setMaximized(await appWindow.isMaximized());
  }

  async function closeWindow() {
    if (!appWindow) return;
    await appWindow.close();
  }

  return (
    <header className="window-titlebar">
      <div className="window-titlebar-brand" data-tauri-drag-region>
        <img src={logoUrl} alt="" className="window-titlebar-logo" />
        <div data-tauri-drag-region>
          <strong data-tauri-drag-region>Torder</strong>
          <span data-tauri-drag-region>今序</span>
        </div>
      </div>

      <div className="window-titlebar-drag" data-tauri-drag-region />

      <div className="window-controls" aria-label="窗口控制">
        <button
          type="button"
          className="window-control"
          onClick={() => void minimizeWindow().catch(() => undefined)}
          aria-label="最小化"
          title="最小化"
        >
          <Minus aria-hidden="true" />
        </button>
        <button
          type="button"
          className="window-control"
          onClick={() => void toggleMaximizeWindow().catch(() => undefined)}
          aria-label={maximized ? "还原窗口" : "最大化"}
          title={maximized ? "还原窗口" : "最大化"}
        >
          {maximized ? (
            <Copy aria-hidden="true" />
          ) : (
            <Square aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          className="window-control close"
          onClick={() => void closeWindow().catch(() => undefined)}
          aria-label="关闭到托盘"
          title="关闭到托盘"
        >
          <X aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
