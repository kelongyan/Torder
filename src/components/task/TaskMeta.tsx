import { Calendar } from "lucide-react";
import { formatTaskDate, isOverdue } from "../../app/taskDates";
import { priorityCopy } from "../../constants/taskConfig";
import type { Task, TaskList } from "../../types/database";

export function TaskMeta({ task, list }: { task: Task; list: TaskList | null }) {
  const dueLabel = formatTaskDate(task.dueAt);
  const overdue = isOverdue(task.dueAt, task.status);

  return (
    <div className="task-meta">
      <span
        className="list-badge"
        style={{
          color: list?.color ?? "#6366f1",
          backgroundColor: `${list?.color ?? "#6366f1"}24`,
        }}
      >
        {list?.name ?? "未分类"}
      </span>
      <span className={`priority-pill ${priorityCopy[task.priority].className}`}>
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
