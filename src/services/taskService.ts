import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  CreateTaskInput,
  Task,
  UpdateTaskInput,
} from "../types/database";
import {
  addBrowserTask,
  findBrowserTask,
  getBrowserTasksSnapshot,
  updateBrowserTask,
} from "./browserTaskMock";
import {
  filterAndSortBrowserTasks,
  type QueryTasksInput,
} from "./browserTaskQuery";

export function createTask(input: CreateTaskInput): Promise<Task> {
  if (!isTauri()) {
    const now = new Date().toISOString();
    const task: Task = {
      id: `browser-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title: input.title.trim(),
      note: input.note?.trim() || null,
      status: "todo",
      priority: input.priority ?? 1,
      listId: input.listId ?? "work",
      dueAt: input.dueAt ?? null,
      completedAt: null,
      sortOrder: input.sortOrder ?? 0,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    addBrowserTask(task);
    return Promise.resolve({ ...task });
  }

  return invoke<Task>("create_task", { input });
}

export function getTask(id: string): Promise<Task> {
  if (!isTauri()) {
    const task = findBrowserTask(id);
    return task
      ? Promise.resolve({ ...task })
      : Promise.reject(new Error("任务不存在"));
  }

  return invoke<Task>("get_task", { id });
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

    const next: Task = {
      ...existing,
      ...input,
      title: input.title.trim(),
      note: input.note?.trim() || null,
      completedAt:
        input.status === "done"
          ? (existing.completedAt ?? new Date().toISOString())
          : null,
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
    updateBrowserTask(id, (existing) => ({ ...existing, deletedAt: timestamp }));
    return Promise.resolve();
  }

  return invoke<void>("delete_task", { id });
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
      dueAt: task.dueAt,
      sortOrder: task.sortOrder,
    });
  }

  return invoke<Task>("set_task_completed", { id, completed });
}

export { getBrowserTasksSnapshot };
