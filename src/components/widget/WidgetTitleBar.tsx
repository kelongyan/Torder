import { X } from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** 关闭被 Rust 拦截为隐藏（小窗常驻，随时可从托盘/设置唤出）。 */
function closeWidget(): void {
  if (!isTauri()) return;
  void getCurrentWindow().close().catch(() => undefined);
}

export function WidgetTitleBar() {
  return (
    <header className="widget-titlebar" data-tauri-drag-region>
      <span className="widget-brand" data-tauri-drag-region>
        Torder 小窗
      </span>
      <div className="widget-titlebar-actions">
        <button
          type="button"
          className="widget-control"
          aria-label="隐藏小窗"
          onMouseDown={(event) => event.preventDefault()}
          onClick={closeWidget}
        >
          <X aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
