import type { CalendarEvent, Task } from "../types/database";
import { getTaskCalendarKey, toDateKey } from "./taskDates";

export const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];
export { toDateKey };

export function buildTasksByDate(
  tasks: Task[],
  showCompleted: boolean,
): Map<string, Task[]> {
  const map = new Map<string, Task[]>();
  for (const task of tasks) {
    if (isCalendarHidden(task, showCompleted)) {
      continue;
    }
    const key = getTaskCalendarKey(task);
    if (!key) continue;
    const bucket = map.get(key) ?? [];
    bucket.push(task);
    map.set(key, bucket);
  }
  return map;
}

export function buildUnscheduledTasks(
  tasks: Task[],
  showCompleted: boolean,
): Task[] {
  return tasks.filter(
    (task) =>
      !isCalendarHidden(task, showCompleted) && !getTaskCalendarKey(task),
  );
}

export function buildEventsByDate(
  events: CalendarEvent[],
): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const start = new Date(`${event.startDate}T00:00:00`);
    const end = new Date(`${event.endDate}T00:00:00`);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const key = toDateKey(d);
      const bucket = map.get(key) ?? [];
      bucket.push(event);
      map.set(key, bucket);
    }
  }
  return map;
}

function isCalendarHidden(task: Task, showCompleted: boolean): boolean {
  return (
    task.status === "archived" || (!showCompleted && task.status === "done")
  );
}
