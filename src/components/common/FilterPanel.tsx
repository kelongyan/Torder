import { Check, CircleCheck, Flag, Hash } from "lucide-react";
import { priorityOptions } from "../../constants/taskConfig";
import type { PresencePhase } from "../../hooks/usePresence";
import type { TaskFilter, TaskList, TaskPriority } from "../../types/database";
import { countTaskFilter } from "../../types/database";

/**
 * R04-B 筛选面板：项目（带色点）/ 标签 / 优先级 / 包含已完成 四组多选。
 * 组内取「或」、组间取「与」；选中项主色加勾，底栏回显条件数与「清除全部」。
 */
export function FilterPanel({
  lists,
  tags,
  filter,
  presence,
  onToggleList,
  onToggleTag,
  onTogglePriority,
  onToggleCompleted,
  onClear,
}: {
  lists: TaskList[];
  tags: string[];
  filter: TaskFilter;
  presence: PresencePhase;
  onToggleList: (listId: string) => void;
  onToggleTag: (tag: string) => void;
  onTogglePriority: (priority: TaskPriority) => void;
  onToggleCompleted: () => void;
  onClear: () => void;
}) {
  const count = countTaskFilter(filter);

  return (
    <div
      className={`view-menu filter-panel ${presence === "exit" ? "is-exiting" : "is-entering"}`}
      role="menu"
      aria-label="筛选条件"
    >
      {lists.length > 0 && (
        <>
          <div className="menu-label">项目</div>
          {lists.map((list) => (
            <Row
              key={list.id}
              label={list.name}
              dotColor={list.color}
              checked={filter.listIds.includes(list.id)}
              onClick={() => onToggleList(list.id)}
            />
          ))}
          <div className="menu-separator" />
        </>
      )}

      {tags.length > 0 && (
        <>
          <div className="menu-label">标签</div>
          {tags.map((tag) => (
            <Row
              key={tag}
              label={tag}
              icon={Hash}
              checked={filter.tags.includes(tag)}
              onClick={() => onToggleTag(tag)}
            />
          ))}
          <div className="menu-separator" />
        </>
      )}

      <div className="menu-label">优先级</div>
      {priorityOptions.map((option) => (
        <Row
          key={option.value}
          label={option.label}
          icon={Flag}
          iconColor={option.color}
          checked={filter.priorities.includes(option.value)}
          onClick={() => onTogglePriority(option.value)}
        />
      ))}
      <div className="menu-separator" />

      <Row
        label="包含已完成"
        icon={CircleCheck}
        checked={filter.includeCompleted}
        onClick={onToggleCompleted}
      />

      <div className="filter-foot">
        <span className="filter-count">
          {count > 0 ? `${count} 个条件` : "未设置条件"}
        </span>
        <button
          type="button"
          className="filter-clear"
          onClick={onClear}
          disabled={count === 0}
        >
          清除全部
        </button>
      </div>
    </div>
  );
}

function Row({
  label,
  checked,
  onClick,
  dotColor,
  icon: Icon,
  iconColor,
}: {
  label: string;
  checked: boolean;
  onClick: () => void;
  dotColor?: string | null;
  icon?: typeof Hash;
  iconColor?: string;
}) {
  return (
    <button
      type="button"
      className={`menu-item filter-row ${checked ? "active" : ""}`}
      onClick={onClick}
      aria-checked={checked}
      role="menuitemcheckbox"
    >
      {dotColor !== undefined && dotColor !== null ? (
        <span className="filter-dot" style={{ color: dotColor }} aria-hidden="true" />
      ) : Icon ? (
        <Icon
          aria-hidden="true"
          className="icon-sm"
          style={iconColor ? { color: iconColor } : undefined}
        />
      ) : (
        <span className="filter-dot filter-dot--none" aria-hidden="true" />
      )}
      <span>{label}</span>
      <Check aria-hidden="true" className="icon-sm filter-check" />
    </button>
  );
}
