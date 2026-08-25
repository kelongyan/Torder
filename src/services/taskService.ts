import { invoke, isTauri } from "@tauri-apps/api/core";
import type { CreateTaskInput, Task, UpdateTaskInput } from "../types/database";
import {
  addBrowserTask,
  findBrowserTask,
  findBrowserTaskIncludingDeleted,
  getBrowserTasksSnapshot,
  removeBrowserTaskIncludingDeleted,
  removeDeletedBrowserTasksBefore,
  updateBrowserTask,
  updateBrowserTaskIncludingDeleted,
} from "./browserTaskMock";
import {
  filterAndSortBrowserTasks,
  type QueryTasksInput,
} from "./browserTaskQuery";

export function createTask(input: CreateTaskInput): Promise<Task> {
  if (!isTauri()) {
    const now = new Date().toISOString();
    const scheduledDate = input.scheduledDate ?? null;
    const dueAt = input.dueAt ?? null;
    const remindBefore = input.remindBefore ?? null;
    const remindAt = computeRemindAt(dueAt, remindBefore);
    const task: Task = {
      id: `browser-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title: input.title.trim(),
      note: input.note?.trim() || null,
      status: "todo",
      priority: input.priority ?? 1,
      listId: input.listId ?? "work",
      scheduledDate,
      dueAt,
      completedAt: null,
      sortOrder: input.sortOrder ?? 0,
      remindBefore,
      remindAt,
      remindedAt: null,
      repeatRule: input.repeatRule ?? null,
      subtasks: cloneSubtasks(input.subtasks ?? []),
      tags: normalizeTags(input.tags ?? []),
      recurringRuleId: null,
      occurrenceAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    addBrowserTask(task);
    return Promise.resolve({ ...task });
  }

  return invoke<Task>("create_task", { input });
}

export function queryTasks(input: QueryTasksInput): Promise<Task[]> {
  if (!isTauri()) {
    return Promise.resolve(
      filterAndSortBrowserTasks(getBrowserTasksSnapshot(), input),
    );
  }

  return invoke<Task[]>("query_tasks", {
    input: {
      scopeKind: input.scope.kind,
      scopeValue:
        input.scope.kind === "view" ? input.scope.view : input.scope.listId,
      query: input.query.trim() || null,
      sortBy: input.sortBy,
      showCompleted: input.showCompleted,
    },
  });
}

export function updateTask(input: UpdateTaskInput): Promise<Task> {
  if (!isTauri()) {
    const existing = findBrowserTask(input.id);
    if (!existing) return Promise.reject(new Error("任务不存在"));

    const remindAt = computeRemindAt(input.dueAt, input.remindBefore);
    const reminderScheduleChanged =
      input.dueAt !== existing.dueAt ||
      input.remindBefore !== existing.remindBefore;
    const next: Task = {
      ...existing,
      ...input,
      title: input.title.trim(),
      note: input.note?.trim() || null,
      completedAt:
        input.status === "done"
          ? (existing.completedAt ?? new Date().toISOString())
          : null,
      remindAt,
      remindedAt: reminderScheduleChanged ? null : existing.remindedAt,
      subtasks: cloneSubtasks(input.subtasks),
      tags: normalizeTags(input.tags),
      updatedAt: new Date().toISOString(),
    };
    updateBrowserTask(input.id, () => next);
    return Promise.resolve({ ...next });
  }

  return invoke<Task>("update_task", { input });
}

export function deleteTask(id: string): Promise<void> {
  if (!isTauri()) {
    const task = findBrowserTask(id);
    if (!task) return Promise.reject(new Error("任务不存在"));
    const timestamp = new Date().toISOString();
    updateBrowserTask(id, (existing) => ({
      ...existing,
      deletedAt: timestamp,
    }));
    return Promise.resolve();
  }

  return invoke<void>("delete_task", { id });
}

export function restoreTask(id: string): Promise<Task> {
  if (!isTauri()) {
    const task = findBrowserTaskIncludingDeleted(id);
    if (!task) return Promise.reject(new Error("任务不存在"));
    const next: Task = {
      ...task,
      deletedAt: null,
      updatedAt: new Date().toISOString(),
    };
    updateBrowserTaskIncludingDeleted(id, () => next);
    return Promise.resolve({ ...next });
  }

  return invoke<Task>("restore_task", { id });
}

export function permanentDeleteTask(id: string): Promise<void> {
  if (!isTauri()) {
    const task = findBrowserTaskIncludingDeleted(id);
    if (!task || !task.deletedAt)
      return Promise.reject(new Error("任务不存在"));
    removeBrowserTaskIncludingDeleted(id);
    return Promise.resolve();
  }

  return invoke<void>("permanent_delete_task", { id });
}

export function emptyTrash(): Promise<number> {
  if (!isTauri()) {
    return Promise.resolve(removeDeletedBrowserTasksBefore());
  }

  return invoke<number>("empty_trash");
}

export function cleanupTrash(retentionDays: number): Promise<number> {
  if (retentionDays < 0) {
    return Promise.reject(new Error("回收站保留天数不能为负数"));
  }

  if (!isTauri()) {
    const threshold = new Date();
    threshold.setDate(threshold.getDate() - retentionDays);
    return Promise.resolve(
      removeDeletedBrowserTasksBefore(threshold.toISOString()),
    );
  }

  return invoke<number>("cleanup_trash", { retentionDays });
}

export function setTaskCompleted(
  id: string,
  completed: boolean,
): Promise<Task> {
  if (!isTauri()) {
    const task = findBrowserTask(id);
    if (!task) return Promise.reject(new Error("任务不存在"));
    return updateTask({
      id: task.id,
      title: task.title,
      note: task.note,
      status: completed ? "done" : "todo",
      priority: task.priority,
      listId: task.listId,
      scheduledDate: task.scheduledDate,
      dueAt: task.dueAt,
      sortOrder: task.sortOrder,
      remindBefore: task.remindBefore,
      repeatRule: task.repeatRule,
      subtasks: task.subtasks,
      tags: task.tags,
    });
  }

  return invoke<Task>("set_task_completed", { id, completed });
}

export function snoozeTaskReminder(
  id: string,
  remindAt: string,
): Promise<Task> {
  if (!isTauri()) {
    const task = findBrowserTask(id);
    if (!task) return Promise.reject(new Error("任务不存在"));
    const next: Task = {
      ...task,
      remindAt,
      remindedAt: null,
      updatedAt: new Date().toISOString(),
    };
    updateBrowserTask(id, () => next);
    return Promise.resolve({ ...next });
  }

  return invoke<Task>("snooze_task_reminder", { id, remindAt });
}

function computeRemindAt(
  dueAt: string | null | undefined,
  remindBefore: number | null | undefined,
): string | null {
  if (!dueAt || remindBefore === null || remindBefore === undefined) {
    return null;
  }
  if (remindBefore <= 0) return dueAt;

  const dueTime = new Date(dueAt).getTime();
  if (Number.isNaN(dueTime)) return null;

  const remindTime = dueTime - remindBefore * 60_000;
  if (remindTime <= Date.now()) return null;
  return toRfc3339Seconds(new Date(remindTime));
}

function toRfc3339Seconds(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function cloneSubtasks(tasks: Task["subtasks"]): Task["subtasks"] {
  return tasks.map((subtask, index) => ({
    ...subtask,
    id: subtask.id || `subtask-${Date.now()}-${index}`,
    title: subtask.title.trim(),
    sortOrder: index,
  }));
}

function normalizeTags(tags: string[]): string[] {
  const next: string[] = [];
  for (const tag of tags) {
    const value = tag.trim().replace(/^#/, "");
    if (!value || value.length > 40) continue;
    if (
      next.some(
        (item) =>
          item.toLocaleLowerCase("zh-CN") === value.toLocaleLowerCase("zh-CN"),
      )
    ) {
      continue;
    }
    next.push(value);
    if (next.length >= 30) break;
  }
  return next;
}
