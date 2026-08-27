import { Plus, X } from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** 关闭被 Rust 拦截为隐藏（小窗常驻，随时可从托盘/设置唤出）。 */
function closeWidget(): void {
  if (!isTauri()) return;
  void getCurrentWindow().close().catch(() => undefined);
}

export function WidgetTitleBar({
  onAdd,
  adding,
}: {
  /** 顶部 + 按钮：展开快速新增输入条 */
  onAdd: () => void;
  /** + 按钮处于激活态（输入条已展开）时视觉上高亮 */
  adding: boolean;
}) {
  return (
    <header className="widget-titlebar" data-tauri-drag-region>
      <span className="widget-brand" data-tauri-drag-region>
        Torder 小窗
      </span>
      <div className="widget-titlebar-actions">
        <button
          type="button"
          className={`widget-control widget-control-add ${adding ? "is-active" : ""}`.trim()}
          aria-label={adding ? "取消新增" : "新增任务"}
          aria-pressed={adding}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onAdd}
        >
          <Plus aria-hidden="true" />
        </button>
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
