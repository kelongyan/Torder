import { BarChart3, Check, Eye, Settings } from "lucide-react";
import { layoutOptions, sortOptions } from "../../constants/taskConfig";
import type { PresencePhase } from "../../hooks/usePresence";
import type { TaskLayout, TaskSortBy } from "../../types/database";
import { isMobile } from "../../utils/platform";

export function ViewMenu({
  layout,
  sortBy,
  showCompleted,
  presence,
  onLayoutChange,
  onSortChange,
  onShowCompletedChange,
  onOpenSettings,
  onOpenStats,
}: {
  layout?: TaskLayout;
  sortBy: TaskSortBy;
  showCompleted: boolean;
  presence: PresencePhase;
  onLayoutChange?: (layout: TaskLayout) => void;
  onSortChange: (sortBy: TaskSortBy) => void;
  onShowCompletedChange: () => void;
  onOpenSettings: () => void;
  onOpenStats: () => void;
}) {
  const showLayoutMenu = layout !== undefined && onLayoutChange !== undefined;

  return (
    <div
      className={`view-menu ${presence === "exit" ? "is-exiting" : "is-entering"}`}
      role="menu"
    >
      {showLayoutMenu && (
        <div className="menu-layout-section">
          <div className="menu-label">视图</div>
          {layoutOptions.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.value}
                type="button"
                className={`menu-item ${layout === item.value ? "active" : ""}`}
                onClick={() => onLayoutChange(item.value)}
                aria-label={`切换到${item.label}`}
                title={item.label}
              >
                <Icon aria-hidden="true" className="icon-sm" />
                <span>{item.label}</span>
                {layout === item.value && (
                  <Check aria-hidden="true" className="icon-sm" />
                )}
              </button>
            );
          })}
          <div className="menu-separator" />
        </div>
      )}
      <div className="menu-label">排序方式</div>
      {sortOptions.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.value}
            type="button"
            className={`menu-item ${sortBy === item.value ? "active" : ""}`}
            onClick={() => onSortChange(item.value)}
          >
            <Icon aria-hidden="true" className="icon-sm" />
            <span>{item.label}</span>
            {sortBy === item.value && (
              <Check aria-hidden="true" className="icon-sm" />
            )}
          </button>
        );
      })}
      <div className="menu-separator" />
      <div className="menu-label">显示</div>
      <button
        type="button"
        className="menu-item"
        onClick={onShowCompletedChange}
      >
        <Eye aria-hidden="true" className="icon-sm" />
        <span>显示已完成</span>
        {showCompleted && <Check aria-hidden="true" className="icon-sm" />}
      </button>
      <div className="menu-separator" />
      <button type="button" className="menu-item" onClick={onOpenStats}>
        <BarChart3 aria-hidden="true" className="icon-sm" />
        <span>统计洞察</span>
      </button>
      <button type="button" className="menu-item" onClick={onOpenSettings}>
        <Settings aria-hidden="true" className="icon-sm" />
        <span>{isMobile() ? "设置" : "设置与备份"}</span>
      </button>
    </div>
  );
}
