import { Calendar, Kanban, List, Plus, Settings } from "lucide-react";
import type { TaskLayout } from "../../types/database";

/**
 * M3.1 移动端底部导航（Material 3 Bottom Navigation + 中央凸起 FAB）。
 * 槽位：列表 · 看板 · [＋FAB] · 日历 · 设置。活跃态随 effectiveLayout；
 * calendar/month/week 均点亮「日历」槽。仅 `.window-frame.mobile` 渲染。
 */
export function BottomNav({
  layout,
  onLayoutChange,
  onCreate,
  onOpenSettings,
}: {
  layout: TaskLayout;
  onLayoutChange: (layout: TaskLayout) => void;
  onCreate: () => void;
  onOpenSettings: () => void;
}) {
  const isActive = (value: TaskLayout | "calendar") =>
    value === "calendar"
      ? layout === "calendar" || layout === "month" || layout === "week"
      : layout === value;

  return (
    <nav className="bottom-nav" aria-label="主导航">
      <button
        type="button"
        className={`bottom-nav-item ${isActive("list") ? "active" : ""}`}
        onClick={() => onLayoutChange("list")}
        aria-label="列表视图"
      >
        <List aria-hidden="true" />
        <span>列表</span>
      </button>

      <button
        type="button"
        className={`bottom-nav-item ${isActive("board") ? "active" : ""}`}
        onClick={() => onLayoutChange("board")}
        aria-label="看板视图"
      >
        <Kanban aria-hidden="true" />
        <span>看板</span>
      </button>

      <div className="bottom-nav-fab-slot" aria-hidden="true">
        <button
          type="button"
          className="bottom-nav-fab"
          onClick={onCreate}
          aria-label="新建任务"
        >
          <Plus aria-hidden="true" />
        </button>
      </div>

      <button
        type="button"
        className={`bottom-nav-item ${isActive("calendar") ? "active" : ""}`}
        onClick={() => onLayoutChange("calendar")}
        aria-label="日历视图"
      >
        <Calendar aria-hidden="true" />
        <span>日历</span>
      </button>

      <button
        type="button"
        className="bottom-nav-item"
        onClick={onOpenSettings}
        aria-label="设置"
      >
        <Settings aria-hidden="true" />
        <span>设置</span>
      </button>
    </nav>
  );
}
