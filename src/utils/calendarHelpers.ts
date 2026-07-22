import type { Task } from "../types/database";
import { formatCalendarDate } from "../app/taskDates";

export function groupCalendarTasks(tasks: Task[]) {
  const map = new Map<
    string,
    {
      key: string;
      title: string;
      weekday: string;
      isToday: boolean;
      tasks: Task[];
    }
  >();

  for (const task of tasks) {
    const date = formatCalendarDate(task.dueAt);
    const current =
      map.get(date.key) ??
      {
        ...date,
        tasks: [],
      };
    current.tasks.push(task);
    map.set(date.key, current);
  }

  return [...map.values()].sort((left, right) => {
    if (left.key === "unscheduled") return 1;
    if (right.key === "unscheduled") return -1;
    return left.key.localeCompare(right.key);
  });
}
