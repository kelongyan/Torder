import { Calendar } from "lucide-react";
import { formatTaskDate, isOverdue } from "../../app/taskDates";
import { DEFAULT_LIST_COLOR } from "../../constants/listConfig";
import { priorityCopy } from "../../constants/taskConfig";
import type { Task, TaskList } from "../../types/database";

export function TaskMeta({
  task,
  list,
}: {
  task: Task;
  list: TaskList | null;
}) {
  const dueLabel = formatTaskDate(task.dueAt);
  const overdue = isOverdue(task.dueAt, task.status);
  const listColor = list?.color ?? DEFAULT_LIST_COLOR;

  return (
    <div className="task-meta">
      <span
        className="list-badge"
        style={{
          color: listColor,
          backgroundColor: `${listColor}24`,
        }}
      >
        {list?.name ?? "未分类"}
      </span>
      <span
        className={`priority-pill ${priorityCopy[task.priority].className}`}
      >
        {priorityCopy[task.priority].label}
      </span>
      {dueLabel && (
        <span className={`due-label ${overdue ? "overdue" : ""}`}>
          <Calendar aria-hidden="true" className="icon-xs" />
          {dueLabel}
        </span>
      )}
    </div>
  );
}
