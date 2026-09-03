import type { CSSProperties } from "react";
import { Check } from "lucide-react";
import { formatTaskDateTime } from "../../utils/taskDates";
import { DEFAULT_LIST_COLOR } from "../../constants/listConfig";
import type { Task, TaskList } from "../../types/database";
import { HighlightedText } from "../common/HighlightedText";

/**
 * 看板任务卡（紧凑行内化 · 对齐设计稿 V-1）：
 *  - 顶部：行内色点 + 项目名（与 task-list 行内 .list-inline 同形态）
 *  - 标题：单行 truncate
 *  - 底栏：行内化 · 优先级色点 + 子任务进度 + 标签（无 chip 底色）
 *  - 右上：勾选
 */
export function TaskCard({
  task,
  list,
  searchQuery,
  selected,
  motionIndex = 0,
  onOpen,
  onToggle,
  draggable = false,
  onDragStart,
}: {
  task: Task;
  list: TaskList | null;
  searchQuery: string;
  selected: boolean;
  motionIndex?: number;
  onOpen: (task: Task) => void;
  onToggle: (task: Task) => void;
  draggable?: boolean;
  onDragStart?: (task: Task) => void;
}) {
  const listColor = list?.color ?? DEFAULT_LIST_COLOR;
  const completedSubtasks = task.subtasks.filter(
    (subtask) => subtask.completed,
  ).length;

  return (
    <article
      className={`board-card ${selected ? "selected" : ""} ${task.status === "done" ? "completed" : ""} ${priorityClass(task.priority)}`}
      style={{ "--item-index": motionIndex } as CSSProperties}
      draggable={draggable}
      onDragStart={() => onDragStart?.(task)}
      onClick={() => onOpen(task)}
    >
      <span
        className="list-inline board-card-list"
        style={{ color: listColor }}
      >
        <span className="list-dot" aria-hidden="true" />
        <span className="list-inline-name">{list?.name ?? "未分类"}</span>
      </span>
      <button
        type="button"
        className={`task-check compact ${task.status === "done" ? "checked" : ""}`}
        onClick={(event) => {
          event.stopPropagation();
          onToggle(task);
        }}
        aria-label={task.status === "done" ? "恢复任务" : "完成任务"}
      >
        {task.status === "done" && <Check aria-hidden="true" />}
      </button>
      <h3 className="board-card-title">
        <HighlightedText text={task.title} query={searchQuery} />
      </h3>
      <div className="board-card-meta">
        {task.dueAt && (
          <span className="board-card-due">
            {formatTaskDateTime(task.dueAt)}
          </span>
        )}
        {task.subtasks.length > 0 && (
          <span className="subtask-pill">
            {completedSubtasks}/{task.subtasks.length}
          </span>
        )}
      </div>
    </article>
  );
}

function priorityClass(priority: Task["priority"]): string {
  return priority === 2
    ? "priority-high"
    : priority === 1
      ? "priority-medium"
      : "priority-low";
}
