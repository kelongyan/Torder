import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { getBrowserTasksSnapshot, replaceBrowserTasks } from "./taskService";
import type { Task } from "../types/database";

export function listDueReminders(): Promise<Task[]> {
  if (!isTauri()) {
    const now = Date.now();
    return Promise.resolve(
      getBrowserTasksSnapshot()
        .filter(
          (task) =>
            task.status === "todo" &&
            !task.deletedAt &&
            task.remindAt !== null &&
            task.remindedAt === null &&
            new Date(task.remindAt).getTime() <= now,
        )
        .sort((left, right) =>
          (left.remindAt ?? "").localeCompare(right.remindAt ?? ""),
        ),
    );
  }
  return invoke<Task[]>("list_due_reminders");
}

export function markTaskReminded(id: string): Promise<Task> {
  if (!isTauri()) {
    return Promise.resolve(updateBrowserReminder(id, { markReminded: true }));
  }
  return invoke<Task>("mark_task_reminded", { id });
}

export function snoozeTaskReminder(id: string, minutes: number): Promise<Task> {
  if (!isTauri()) {
    return Promise.resolve(
      updateBrowserReminder(id, { snoozeMinutes: minutes }),
    );
  }
  return invoke<Task>("snooze_task_reminder", { id, minutes });
}

export async function sendTaskNotification(task: Task): Promise<boolean> {
  if (!isTauri()) return false;

  let granted = await isPermissionGranted();
  if (!granted) granted = (await requestPermission()) === "granted";
  if (!granted) return false;

  sendNotification({
    id: notificationId(task.id),
    title: "Torder 任务提醒",
    body: task.title,
    extra: { taskId: task.id },
    autoCancel: true,
  });
  return true;
}

export function listenForNotificationActions(
  onTaskOpen: (taskId: string) => void,
): Promise<() => void> {
  // Tauri notification actions are mobile-only; Windows uses the in-app action.
  void onTaskOpen;
  return Promise.resolve(() => undefined);
}

function notificationId(taskId: string): number {
  let hash = 0;
  for (const character of taskId) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  }
  return Math.abs(hash % 2_147_483_647) || 1;
}

function updateBrowserReminder(
  id: string,
  action: { markReminded?: boolean; snoozeMinutes?: number },
): Task {
  const tasks = getBrowserTasksSnapshot();
  const index = tasks.findIndex(
    (task) => task.id === id && task.status === "todo" && !task.deletedAt,
  );
  if (index < 0) throw new Error("任务不存在");

  const now = new Date();
  const next: Task = {
    ...tasks[index],
    remindedAt: action.markReminded ? now.toISOString() : null,
    remindAt:
      action.snoozeMinutes === undefined
        ? tasks[index].remindAt
        : new Date(now.getTime() + action.snoozeMinutes * 60_000).toISOString(),
    updatedAt: now.toISOString(),
  };
  tasks[index] = next;
  replaceBrowserTasks(tasks);
  return { ...next };
}
