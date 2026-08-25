import { Calendar, CalendarDays } from "lucide-react";
import {
  formatTaskDate,
  formatTaskScheduleDate,
  isOverdue,
  toLocalDateKey,
} from "../../utils/taskDates";
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
  const scheduleLabel = formatTaskScheduleDate(task.scheduledDate);
  const dueDateKey = toLocalDateKey(task.dueAt);
  const showSchedule =
    scheduleLabel && (!task.dueAt || task.scheduledDate !== dueDateKey);
  const overdue = isOverdue(task.dueAt, task.status);
  const listColor = list?.color ?? DEFAULT_LIST_COLOR;
  const completedSubtasks = task.subtasks.filter(
    (subtask) => subtask.completed,
  ).length;

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
      {showSchedule && (
        <span className="due-label">
          <CalendarDays aria-hidden="true" className="icon-xs" />
          计划 {scheduleLabel}
        </span>
      )}
      {task.subtasks.length > 0 && (
        <span className="subtask-pill">
          {completedSubtasks}/{task.subtasks.length}
        </span>
      )}
      {task.tags.slice(0, 3).map((tag) => (
        <span key={tag} className="tag-pill">
          #{tag}
        </span>
      ))}
    </div>
  );
}
