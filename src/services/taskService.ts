import { invoke, isTauri } from "@tauri-apps/api/core";
import { listLists } from "./listService";
import {
  deleteBrowserTaskTagLinks,
  getBrowserTagsSnapshot,
  getBrowserTaskTagIds,
  setBrowserTaskTagIds,
} from "./tagService";
import type {
  CreateTaskInput,
  Task,
  TaskFilters,
  TaskView,
  UpdateTaskInput,
} from "../types/database";

let browserTasks = createBrowserTasks();

export function createTask(input: CreateTaskInput): Promise<Task> {
  if (!isTauri()) {
    const now = new Date().toISOString();
    const task: Task = {
      id: `browser-${Date.now()}`,
      title: input.title.trim(),
      note: input.note ?? null,
      status: "todo",
      priority: input.priority ?? 0,
      listId: input.listId ?? "inbox",
      dueAt: input.dueAt ?? null,
      remindAt: input.remindAt ?? null,
      remindedAt: null,
      completedAt: null,
      sortOrder: input.sortOrder ?? 0,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    browserTasks = [...browserTasks, task];
    return Promise.resolve(cloneTask(task));
  }

  return invoke<Task>("create_task", { input });
}

export function getTask(id: string): Promise<Task> {
  if (!isTauri()) {
    const task = browserTasks.find((item) => item.id === id && !item.deletedAt);
    return task
      ? Promise.resolve(cloneTask(task))
      : Promise.reject(new Error("任务不存在"));
  }

  return invoke<Task>("get_task", { id });
}

export function listTasks(view: TaskView): Promise<Task[]> {
  if (!isTauri()) {
    return Promise.resolve(
      browserTasks
        .filter((task) => matchesView(task, view))
        .sort(compareTasks)
        .map(cloneTask),
    );
  }

  const commands: Record<TaskView, string> = {
    today: "list_today_tasks",
    all: "list_tasks",
    completed: "list_completed_tasks",
    overdue: "list_overdue_tasks",
  };
  return invoke<Task[]>(commands[view]);
}

export async function queryTasks(
  view: TaskView,
  filters: TaskFilters,
): Promise<Task[]> {
  if (!isTauri()) {
    const lists = await listLists();
    const listNames = new Map(lists.map((list) => [list.id, list.name]));
    const tags = getBrowserTagsSnapshot();
    const tagNames = new Map(tags.map((tag) => [tag.id, tag.name]));

    return browserTasks
      .filter(
        (task) =>
          matchesView(task, view) &&
          matchesFilters(task, filters, listNames, tagNames),
      )
      .sort(compareTasks)
      .map(cloneTask);
  }

  return invoke<Task[]>("query_tasks", {
    input: {
      view,
      query: filters.query.trim() || null,
      dateFilter: filters.dateFilter,
      priorities: filters.priorities,
      listIds: filters.listIds,
      tagIds: filters.tagIds,
    },
  });
}

export function updateTask(input: UpdateTaskInput): Promise<Task> {
  if (!isTauri()) {
    const index = browserTasks.findIndex(
      (task) => task.id === input.id && !task.deletedAt,
    );
    if (index < 0) {
      return Promise.reject(new Error("任务不存在"));
    }
    const existing = browserTasks[index];
    const next: Task = {
      ...existing,
      ...input,
      title: input.title.trim(),
      completedAt:
        input.status === "done"
          ? (existing.completedAt ?? new Date().toISOString())
          : null,
      remindedAt:
        input.remindAt === existing.remindAt ? existing.remindedAt : null,
      updatedAt: new Date().toISOString(),
    };
    browserTasks = browserTasks.map((task, taskIndex) =>
      taskIndex === index ? next : task,
    );
    return Promise.resolve(cloneTask(next));
  }

  return invoke<Task>("update_task", { input });
}

export function deleteTask(id: string): Promise<void> {
  if (!isTauri()) {
    const index = browserTasks.findIndex(
      (task) => task.id === id && !task.deletedAt,
    );
    if (index < 0) {
      return Promise.reject(new Error("任务不存在"));
    }
    browserTasks = browserTasks.map((task, taskIndex) =>
      taskIndex === index
        ? { ...task, deletedAt: new Date().toISOString() }
        : task,
    );
    deleteBrowserTaskTagLinks(id);
    return Promise.resolve();
  }

  return invoke<void>("delete_task", { id });
}

export function setTaskCompleted(
  id: string,
  completed: boolean,
): Promise<Task> {
  if (!isTauri()) {
    const task = browserTasks.find((item) => item.id === id && !item.deletedAt);
    if (!task) {
      return Promise.reject(new Error("任务不存在"));
    }
    return updateTask({
      id: task.id,
      title: task.title,
      note: task.note,
      status: completed ? "done" : "todo",
      priority: task.priority,
      listId: task.listId,
      dueAt: task.dueAt,
      remindAt: task.remindAt,
      sortOrder: task.sortOrder,
    });
  }

  return invoke<Task>("set_task_completed", { id, completed });
}

export function setTaskTags(taskId: string, tagIds: string[]): Promise<void> {
  if (!isTauri()) {
    const task = browserTasks.find(
      (item) => item.id === taskId && !item.deletedAt,
    );
    if (!task) {
      return Promise.reject(new Error("任务不存在"));
    }
    setBrowserTaskTagIds(taskId, tagIds);
    return Promise.resolve();
  }
  return invoke<void>("set_task_tags", { taskId, tagIds });
}

export function listTaskTagIds(taskId: string): Promise<string[]> {
  if (!isTauri()) {
    return Promise.resolve(getBrowserTaskTagIds(taskId));
  }
  return invoke<string[]>("list_task_tag_ids", { taskId });
}

export function getBrowserTasksSnapshot(): Task[] {
  return browserTasks.map(cloneTask);
}

export function replaceBrowserTasks(tasks: Task[]): void {
  browserTasks = tasks.map(cloneTask);
}

function createBrowserTasks(): Task[] {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  yesterday.setHours(18, 0, 0, 0);
  const today = new Date(now);
  today.setHours(20, 0, 0, 0);
  const createdAt = new Date(now.getTime() - 60 * 60 * 1000).toISOString();

  return [
    browserTask("preview-overdue", "确认阶段 4 主界面交互", {
      priority: 2,
      listId: "work",
      dueAt: yesterday.toISOString(),
      createdAt,
    }),
    browserTask("preview-today", "整理今日任务列表", {
      priority: 1,
      listId: "work",
      dueAt: today.toISOString(),
      remindAt: new Date(today.getTime() - 30 * 60 * 1000).toISOString(),
      createdAt,
    }),
    browserTask("preview-inbox", "记录一个没有截止时间的想法", {
      listId: "inbox",
      createdAt,
    }),
    browserTask("preview-done", "完成任务数据层", {
      status: "done",
      listId: "work",
      dueAt: today.toISOString(),
      completedAt: now.toISOString(),
      createdAt,
    }),
  ];
}

function browserTask(
  id: string,
  title: string,
  overrides: Partial<Task>,
): Task {
  const timestamp = new Date().toISOString();
  return {
    id,
    title,
    note: null,
    status: "todo",
    priority: 0,
    listId: "inbox",
    dueAt: null,
    remindAt: null,
    remindedAt: null,
    completedAt: null,
    sortOrder: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    ...overrides,
  };
}

function matchesView(task: Task, view: TaskView): boolean {
  if (task.deletedAt) return false;
  const now = new Date();
  const due = task.dueAt ? new Date(task.dueAt) : null;
  if (view === "completed") return task.status === "done";
  if (task.status !== "todo") return false;
  if (view === "all") return true;
  if (view === "overdue") return Boolean(due && due < now);
  return Boolean(due && (due < now || isSameLocalDay(due, now)));
}

function matchesFilters(
  task: Task,
  filters: TaskFilters,
  listNames: Map<string, string>,
  tagNames: Map<string, string>,
): boolean {
  const query = filters.query.trim().toLocaleLowerCase("zh-CN");
  const taskTagIds = getBrowserTaskTagIds(task.id);

  if (query) {
    const searchableText = [
      task.title,
      task.note ?? "",
      listNames.get(task.listId) ?? "",
      ...taskTagIds.map((tagId) => tagNames.get(tagId) ?? ""),
    ]
      .join("\n")
      .toLocaleLowerCase("zh-CN");
    if (!searchableText.includes(query)) return false;
  }

  if (filters.dateFilter && !matchesDateFilter(task, filters.dateFilter)) {
    return false;
  }
  if (
    filters.priorities.length > 0 &&
    !filters.priorities.includes(task.priority)
  ) {
    return false;
  }
  if (filters.listIds.length > 0 && !filters.listIds.includes(task.listId)) {
    return false;
  }
  if (
    filters.tagIds.length > 0 &&
    !taskTagIds.some((tagId) => filters.tagIds.includes(tagId))
  ) {
    return false;
  }
  return true;
}

function matchesDateFilter(
  task: Task,
  dateFilter: NonNullable<TaskFilters["dateFilter"]>,
): boolean {
  if (dateFilter === "none") return task.dueAt === null;
  if (!task.dueAt) return false;

  const due = new Date(task.dueAt);
  const now = new Date();
  if (dateFilter === "overdue") return due < now;
  if (dateFilter === "today") return isSameLocalDay(due, now);

  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return due >= start && due < end;
}

function compareTasks(left: Task, right: Task): number {
  const rankDifference = taskRank(left) - taskRank(right);
  if (rankDifference !== 0) return rankDifference;
  if (left.priority !== right.priority) return right.priority - left.priority;
  if (left.sortOrder !== right.sortOrder)
    return left.sortOrder - right.sortOrder;
  return right.createdAt.localeCompare(left.createdAt);
}

function taskRank(task: Task): number {
  const now = new Date();
  const due = task.dueAt ? new Date(task.dueAt) : null;
  if (due && due < now) return 0;
  if (due && isSameLocalDay(due, now)) return 1;
  if (task.remindAt) return 2;
  if (task.priority === 2) return 3;
  return 4;
}

function isSameLocalDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function cloneTask(task: Task): Task {
  return { ...task };
}
