import { Check, Eye } from "lucide-react";
import { sortOptions } from "../../constants/taskConfig";
import type { PresencePhase } from "../../hooks/usePresence";
import type { TaskSortBy } from "../../types/database";

export function ViewMenu({
  sortBy,
  showCompleted,
  presence,
  onSortChange,
  onShowCompletedChange,
}: {
  sortBy: TaskSortBy;
  showCompleted: boolean;
  presence: PresencePhase;
  onSortChange: (sortBy: TaskSortBy) => void;
  onShowCompletedChange: () => void;
}) {
  return (
    <div
      className={`view-menu ${presence === "exit" ? "is-exiting" : "is-entering"}`}
      role="menu"
    >
      <div className="menu-label">排序方式</div>
      {sortOptions.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.value}
            type="button"
            className="menu-item"
            onClick={() => onSortChange(item.value)}
          >
            <Icon aria-hidden="true" className="icon-sm" />
            <span>{item.label}</span>
            {sortBy === item.value && <Check aria-hidden="true" className="icon-sm" />}
          </button>
        );
      })}
      <div className="menu-separator" />
      <div className="menu-label">显示</div>
      <button type="button" className="menu-item" onClick={onShowCompletedChange}>
        <Eye aria-hidden="true" className="icon-sm" />
        <span>显示已完成</span>
        {showCompleted && <Check aria-hidden="true" className="icon-sm" />}
      </button>
    </div>
  );
}
