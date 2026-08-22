import { invoke, isTauri } from "@tauri-apps/api/core";
import type { CreateTaskInput, Task, UpdateTaskInput } from "../types/database";
import {
  addBrowserTask,
  findBrowserTask,
  findBrowserTaskIncludingDeleted,
  getBrowserTasksSnapshot,
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
      dueAt,
      completedAt: null,
      sortOrder: input.sortOrder ?? 0,
      remindBefore,
      remindAt,
      remindedAt: null,
      repeatRule: input.repeatRule ?? null,
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
      remindedAt: remindAt === existing.remindAt ? existing.remindedAt : null,
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
      remindBefore: task.remindBefore,
      repeatRule: task.repeatRule,
    });
  }

  return invoke<Task>("set_task_completed", { id, completed });
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
