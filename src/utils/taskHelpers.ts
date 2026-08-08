import {
  Calendar,
  CheckCircle2,
  ListTodo,
  Star,
  type LucideIcon,
} from "lucide-react";
import { getDefaultDueAtLocal, toDateTimeLocal } from "../app/taskDates";
import { taskViewCopy } from "../app/taskViews";
import { defaultTaskScope } from "../stores/taskStore";
import type {
  RecurrenceFrequency,
  RecurringRule,
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
  remindBefore: number | null;
  recurrenceFrequency: RecurrenceFrequency | null;
  recurrenceInterval: number;
  recurrenceWeekdays: number[];
  recurrenceMonthDay: number;
  generateAheadMinutes: number;
  generateAheadUnit: "hours" | "days";
  recurrenceEndAt: string;
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

export function buildCounts(
  tasks: Task[],
  lists: TaskList[],
  showCompleted: boolean,
) {
  // 「全部任务」和清单角标必须和后端同名视图的过滤口径一致：始终排除归档，
  // 已完成只在用户打开「显示已完成」时计入。否则角标会比列表里的条数虚高。
  const inScope = (task: Task) =>
    task.status !== "archived" && (showCompleted || task.status !== "done");

  const views: Record<SystemView, number> = {
    all: tasks.filter(inScope).length,
    today: tasks.filter((task) => matchesViewCount(task, "today")).length,
    planned: tasks.filter((task) => matchesViewCount(task, "planned")).length,
    overdue: tasks.filter((task) => matchesViewCount(task, "overdue")).length,
    "no-date": tasks.filter((task) => matchesViewCount(task, "no-date"))
      .length,
    important: tasks.filter((task) => matchesViewCount(task, "important"))
      .length,
    completed: tasks.filter((task) => task.status === "done").length,
  };
  const listCounts: Record<string, number> = {};
  for (const list of lists) {
    listCounts[list.id] = tasks.filter(
      (task) => task.listId === list.id && inScope(task),
    ).length;
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
  if (view === "overdue") {
    if (!task.dueAt) return false;
    const due = new Date(task.dueAt);
    const now = new Date();
    return (
      due.getFullYear() < now.getFullYear() ||
      due.getMonth() < now.getMonth() ||
      (due.getFullYear() === now.getFullYear() &&
        due.getMonth() === now.getMonth() &&
        due.getDate() < now.getDate())
    );
  }
  if (view === "no-date") return task.dueAt === null;
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
    dueAt: getDefaultDueAtLocal(),
    remindBefore: 1440, // default 1 day before due
    recurrenceFrequency: null,
    recurrenceInterval: 1,
    recurrenceWeekdays: [new Date().getDay()],
    recurrenceMonthDay: new Date().getDate(),
    generateAheadMinutes: 1440,
    generateAheadUnit: "days",
    recurrenceEndAt: "",
  };
}

export function createTaskDraft(
  task: Task | null,
  lists: TaskList[],
): TaskDraft {
  if (!task) return emptyDraft(pickDefaultListId(defaultTaskScope, lists));
  return {
    title: task.title,
    note: task.note ?? "",
    priority: task.priority,
    listId: task.listId,
    dueAt: toDateTimeLocal(task.dueAt),
    remindBefore: task.remindBefore,
    recurrenceFrequency: null,
    recurrenceInterval: 1,
    recurrenceWeekdays: [new Date(task.dueAt ?? Date.now()).getDay()],
    recurrenceMonthDay: new Date(task.dueAt ?? Date.now()).getDate(),
    generateAheadMinutes: 1440,
    generateAheadUnit: "days",
    recurrenceEndAt: "",
  };
}

export function recurringRuleDraft(rule: RecurringRule): TaskDraft {
  return {
    title: rule.title,
    note: rule.note ?? "",
    priority: rule.priority,
    listId: rule.listId,
    dueAt: toDateTimeLocal(rule.firstDueAt),
    remindBefore: rule.remindBefore,
    recurrenceFrequency: rule.frequency,
    recurrenceInterval: rule.intervalCount,
    recurrenceWeekdays: rule.weekdays,
    recurrenceMonthDay: rule.monthDay ?? new Date(rule.firstDueAt).getDate(),
    generateAheadMinutes: rule.generateAheadMinutes,
    generateAheadUnit:
      rule.generateAheadMinutes % 1440 === 0 ? "days" : "hours",
    recurrenceEndAt: toDateTimeLocal(rule.endAt),
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
