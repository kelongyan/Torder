import {
  Calendar,
  CheckCircle2,
  ListTodo,
  Star,
  type LucideIcon,
} from "lucide-react";
import { taskViewCopy } from "../app/taskViews";
import { defaultTaskScope } from "../stores/taskStore";
import type {
  SystemView,
  Task,
  TaskList,
  TaskScope,
} from "../types/database";

export interface TaskDraft {
  title: string;
  note: string;
  priority: 0 | 1 | 2;
  listId: string;
  dueAt: string;
}

export function getScopeTitle(scope: TaskScope, lists: TaskList[]): string {
  if (scope.kind === "view") return taskViewCopy[scope.view].title;
  return findList(lists, scope.listId)?.name ?? "我的清单";
}

export function isScopeActive(current: TaskScope, target: TaskScope): boolean {
  if (current.kind !== target.kind) return false;
  return current.kind === "view"
    ? current.view === (target as { kind: "view"; view: SystemView }).view
    : current.listId === (target as { kind: "list"; listId: string }).listId;
}

export function buildCounts(tasks: Task[], lists: TaskList[]) {
  const views: Record<SystemView, number> = {
    all: tasks.length,
    today: tasks.filter((task) => matchesViewCount(task, "today")).length,
    planned: tasks.filter((task) => matchesViewCount(task, "planned")).length,
    important: tasks.filter((task) => matchesViewCount(task, "important")).length,
    completed: tasks.filter((task) => task.status === "done").length,
  };
  const listCounts: Record<string, number> = {};
  for (const list of lists) {
    listCounts[list.id] = tasks.filter((task) => task.listId === list.id).length;
  }
  return { views, lists: listCounts };
}

function matchesViewCount(task: Task, view: SystemView): boolean {
  if (task.status === "done" || task.status === "archived") return false;
  if (view === "today") {
    if (!task.dueAt) return false;
    const due = new Date(task.dueAt);
    const now = new Date();
    return (
      due.getFullYear() === now.getFullYear() &&
      due.getMonth() === now.getMonth() &&
      due.getDate() === now.getDate()
    );
  }
  if (view === "planned") return task.dueAt !== null;
  if (view === "important") return task.priority === 2;
  return true;
}

export function pickDefaultListId(scope: TaskScope, lists: TaskList[]): string {
  if (scope.kind === "list") return scope.listId;
  if (lists.some((list) => list.id === "work")) return "work";
  return lists[0]?.id ?? "work";
}

export function findList(lists: TaskList[], id: string): TaskList | null {
  return lists.find((list) => list.id === id) ?? null;
}

export function emptyDraft(defaultListId: string): TaskDraft {
  return {
    title: "",
    note: "",
    priority: 1,
    listId: defaultListId,
    dueAt: "",
  };
}

export function createTaskDraft(task: Task | null, lists: TaskList[]): TaskDraft {
  if (!task) return emptyDraft(pickDefaultListId(defaultTaskScope, lists));
  return {
    title: task.title,
    note: task.note ?? "",
    priority: task.priority,
    listId: task.listId,
    dueAt: toDateTimeLocal(task.dueAt),
  };
}

export function getEmptyCopy(scope: TaskScope): {
  icon: LucideIcon;
  title: string;
  body: string;
} {
  if (scope.kind === "view") {
    const copy = taskViewCopy[scope.view];
    const icon =
      scope.view === "today"
        ? Calendar
        : scope.view === "completed"
          ? CheckCircle2
          : scope.view === "important"
            ? Star
            : ListTodo;
    return { icon, title: copy.emptyTitle, body: copy.emptyBody };
  }
  return {
    icon: ListTodo,
    title: "这个清单还没有任务",
    body: "点击添加新任务，把它放进当前清单。",
  };
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest("input, textarea, select, [contenteditable='true']"),
  );
}

export function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toDateTimeLocal(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const localDate = new Date(
    date.getTime() - date.getTimezoneOffset() * 60_000,
  );
  return localDate.toISOString().slice(0, 16);
}
