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
  filterAndSortTasks,
  type QueryTasksInput,
  taskPlanDateKey,
} from "./taskQuery";
import {
  predictCompletedTask,
  predictCreatedTask,
  predictDeletedTask,
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
    const next = predictDeletedTask(task, new Date().toISOString());
    updateBrowserTask(id, () => next);
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
    // 独立实现 set_completed 语义（完成时总是刷新 completedAt），
    // 不能走 updateTask：update 语义会保留旧的 completedAt。
    const task = findBrowserTask(id);
    if (!task) return Promise.reject(new Error("任务不存在"));
    const next = predictCompletedTask(task, completed);
    updateBrowserTask(id, () => next);
    return Promise.resolve({ ...next });
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

/**
 * 桌面小窗专用按日期查询。
 * 走 Rust `query_tasks_for_date`，按 `scheduled_date || date(due_at)` 精确匹配，
 * 远小于通用 `query_tasks` 的全表返回。
 * 排序语义两侧统一（见 Rust `query_for_widget` 的 ORDER BY）：
 * 有日期（scheduledDate 或 dueAt 的本地日期）的任务在前、按日期升序，
 * 无日期的在后；同组内 priority DESC，最后 created_at DESC。
 * 浏览器模式（`pnpm dev`）下用 `compareWidgetTasks` 实现同一排序。
 */
export function queryTasksForDate(
  dateKey: string,
  includeCompleted = true,
): Promise<Task[]> {
  if (!isTauri()) {
    return Promise.resolve(
      getBrowserTasksSnapshot()
        .filter(
          (task) =>
            !task.deletedAt &&
            task.status !== "archived" &&
            (includeCompleted || task.status !== "done") &&
            taskPlanDateKey(task) === dateKey,
        )
        .sort(compareWidgetTasks),
    );
  }

  return invoke<Task[]>("query_tasks_for_date", {
    dateKey,
    includeCompleted,
  });
}

/** 与 Rust `query_for_widget` 的 ORDER BY 保持同一语义（见上方注释）。 */
function compareWidgetTasks(left: Task, right: Task): number {
  const leftKey = taskPlanDateKey(left);
  const rightKey = taskPlanDateKey(right);
  const leftMissing = leftKey === null ? 1 : 0;
  const rightMissing = rightKey === null ? 1 : 0;
  if (leftMissing !== rightMissing) return leftMissing - rightMissing;
  if (leftKey !== null && rightKey !== null && leftKey !== rightKey) {
    return leftKey < rightKey ? -1 : 1;
  }
  if (left.priority !== right.priority) return right.priority - left.priority;
  if (left.createdAt !== right.createdAt) {
    return left.createdAt < right.createdAt ? 1 : -1;
  }
  return 0;
}
