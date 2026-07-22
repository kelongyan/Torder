import { Check } from "lucide-react";
import { formatTaskDateTime } from "../../app/taskDates";
import { DEFAULT_LIST_COLOR } from "../../constants/listConfig";
import { priorityCopy } from "../../constants/taskConfig";
import type { Task, TaskList } from "../../types/database";
import { HighlightedText } from "../common/HighlightedText";

export function TaskCard({
  task,
  list,
  searchQuery,
  selected,
  onOpen,
  onToggle,
}: {
  task: Task;
  list: TaskList | null;
  searchQuery: string;
  selected: boolean;
  onOpen: (task: Task) => void;
  onToggle: (task: Task) => void;
}) {
  const listColor = list?.color ?? DEFAULT_LIST_COLOR;

  return (
    <article
      className={`board-card ${selected ? "selected" : ""} ${task.status === "done" ? "completed" : ""}`}
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
        <span>{formatTaskDateTime(task.dueAt)}</span>
      </div>
    </article>
  );
}
