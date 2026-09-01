import { Calendar, CalendarDays } from "lucide-react";
import {
  formatTaskDate,
  formatTaskScheduleDate,
  isOverdue,
  toLocalDateKey,
} from "../../utils/taskDates";
import { DEFAULT_LIST_COLOR } from "../../constants/listConfig";
import type { Task, TaskList } from "../../types/database";

export function TaskMeta({
  task,
  list,
  hideDue = false,
}: {
  task: Task;
  list: TaskList | null;
  /** 今天视图时间轴：时间已在行首槽位展示，隐藏右侧日期标签避免重复。 */
  hideDue?: boolean;
}) {
  const dueLabel = formatTaskDate(task.dueAt);
  const scheduleLabel = formatTaskScheduleDate(task.scheduledDate);
  const dueDateKey = toLocalDateKey(task.dueAt);
  const showSchedule =
    scheduleLabel && (!task.dueAt || task.scheduledDate !== dueDateKey);
  const overdue = isOverdue(task.dueAt, task.status);
  // 日期紧急度着色（提案 §3-A/C）：今天 accent、明天次级、逾期红、其余灰
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const urgencyClass = overdue
    ? "overdue"
    : dueDateKey && dueDateKey === toLocalDateKey(new Date().toISOString())
      ? "today"
      : task.dueAt && dueDateKey === toLocalDateKey(tomorrow.toISOString())
        ? "tomorrow"
        : "";
  const listColor = list?.color ?? DEFAULT_LIST_COLOR;
  const completedSubtasks = task.subtasks.filter(
    (subtask) => subtask.completed,
  ).length;

  return (
    <div className="task-meta">
      <span
        className="list-inline"
        style={{ color: listColor }}
        title={list?.name ?? "未分类"}
      >
        <span className="list-dot" aria-hidden="true" />
        <span className="list-inline-name">{list?.name ?? "未分类"}</span>
      </span>
      {!hideDue && dueLabel && (
        <span className={`due-label ${urgencyClass}`}>
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
          <span>
            {completedSubtasks}/{task.subtasks.length}
          </span>
          <i
            aria-hidden="true"
            style={{
              width: `${(completedSubtasks / task.subtasks.length) * 100}%`,
            }}
          />
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
