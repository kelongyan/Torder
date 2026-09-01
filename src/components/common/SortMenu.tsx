import { ArrowDown, ArrowUp, Calendar, Check, Clock, Flag, GripVertical, type LucideIcon } from "lucide-react";
import type { PresencePhase } from "../../hooks/usePresence";
import type { TaskSortBy } from "../../types/database";

/**
 * R04-A 排序菜单：四种排序单选（当前项打勾）+ 升降序切换。
 * 外壳复用 .view-menu 视觉体系，与 ··· 主菜单保持一致。
 */
export function SortMenu({
  sortBy,
  sortAsc,
  presence,
  onSortChange,
  onDirectionToggle,
}: {
  sortBy: TaskSortBy;
  sortAsc: boolean;
  presence: PresencePhase;
  onSortChange: (sortBy: TaskSortBy) => void;
  onDirectionToggle: () => void;
}) {
  const DirectionIcon = sortAsc ? ArrowUp : ArrowDown;
  const directionLabel = sortAsc ? "升序（早的在前）" : "降序（晚的在前）";

  return (
    <div
      className={`view-menu sort-menu ${presence === "exit" ? "is-exiting" : "is-entering"}`}
      role="menu"
      aria-label="排序方式"
    >
      <div className="menu-label">排序方式</div>
      {SORT_ITEMS.map((item) => {
        const Icon = item.icon;
        const active = sortBy === item.value;
        return (
          <button
            key={item.value}
            type="button"
            className={`menu-item ${active ? "active" : ""}`}
            onClick={() => onSortChange(item.value)}
            aria-label={`按${item.label}排序`}
            aria-checked={active}
            role="menuitemradio"
          >
            <Icon aria-hidden="true" className="icon-sm" />
            <span>{item.label}</span>
            {active && <Check aria-hidden="true" className="icon-sm" />}
          </button>
        );
      })}
      <div className="menu-separator" />
      <button
        type="button"
        className="menu-item"
        onClick={onDirectionToggle}
        aria-label={`切换为${sortAsc ? "降序" : "升序"}`}
        title={`当前${directionLabel}`}
      >
        <DirectionIcon aria-hidden="true" className="icon-sm" />
        <span>{directionLabel}</span>
      </button>
    </div>
  );
}

const SORT_ITEMS: Array<{
  value: TaskSortBy;
  label: string;
  icon: LucideIcon;
}> = [
  { value: "priority", label: "优先级", icon: Flag },
  { value: "date", label: "截止日期", icon: Calendar },
  { value: "created", label: "创建时间", icon: Clock },
  { value: "manual", label: "手动排序", icon: GripVertical },
];
