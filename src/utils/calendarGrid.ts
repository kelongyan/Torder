import type { CalendarEvent, Task } from "../types/database";

export const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

export function toDateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function buildTasksByDate(
  tasks: Task[],
  showCompleted: boolean,
): Map<string, Task[]> {
  const map = new Map<string, Task[]>();
  for (const task of tasks) {
    if (
      !task.dueAt ||
      task.status === "archived" ||
      (!showCompleted && task.status === "done")
    ) {
      continue;
    }
    const key = toDateKey(new Date(task.dueAt));
    const bucket = map.get(key) ?? [];
    bucket.push(task);
    map.set(key, bucket);
  }
  return map;
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
