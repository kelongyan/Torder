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
import { filterAndSortTasks, type QueryTasksInput } from "./taskQuery";
import {
  predictCreatedTask,
  predictUpdatedTask,
} from "../utils/taskPrediction";

export function createTask(input: CreateTaskInput): Promise<Task> {
  if (!isTauri()) {
    const task = predictCreatedTask(
      input,
      `browser-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    addBrowserTask(task);
    return Promise.resolve({ ...task });
  }

  return invoke<Task>("create_task", { input });
}

export function queryTasks(input: QueryTasksInput): Promise<Task[]> {
  if (!isTauri()) {
    return Promise.resolve(
      filterAndSortTasks(getBrowserTasksSnapshot(), input),
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

    const next = predictUpdatedTask(existing, input);
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
