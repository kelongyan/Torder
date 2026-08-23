import type { CSSProperties } from "react";
import { Check } from "lucide-react";
import { formatTaskDateTime } from "../../utils/taskDates";
import { DEFAULT_LIST_COLOR } from "../../constants/listConfig";
import { priorityCopy } from "../../constants/taskConfig";
import type { Task, TaskList } from "../../types/database";
import { HighlightedText } from "../common/HighlightedText";

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
      className={`board-card ${selected ? "selected" : ""} ${task.status === "done" ? "completed" : ""}`}
      style={{ "--item-index": motionIndex } as CSSProperties}
      draggable={draggable}
      onDragStart={() => onDragStart?.(task)}
      onClick={() => onOpen(task)}
    >
      <div className="board-card-top">
        <span
          className="list-badge"
          style={{
            color: listColor,
            backgroundColor: `${listColor}24`,
          }}
        >
          {list?.name ?? "未分类"}
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
      </div>
      <h3>
        <HighlightedText text={task.title} query={searchQuery} />
      </h3>
      {task.note && (
        <p>
          <HighlightedText text={task.note} query={searchQuery} />
        </p>
      )}
      <div className="board-card-footer">
        <span
          className={`priority-pill ${priorityCopy[task.priority].className}`}
        >
          {priorityCopy[task.priority].label}
        </span>
        {task.subtasks.length > 0 && (
          <span className="subtask-pill">
            {completedSubtasks}/{task.subtasks.length}
          </span>
        )}
        {task.tags.slice(0, 2).map((tag) => (
          <span key={tag} className="tag-pill">
            #{tag}
          </span>
        ))}
        <span>{formatTaskDateTime(task.dueAt)}</span>
      </div>
    </article>
  );
}
