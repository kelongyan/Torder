import { getBrowserListsSnapshot } from "./listService";
import type {
  SystemView,
  Task,
  TaskScope,
  TaskSortBy,
} from "../types/database";

export interface QueryTasksInput {
  scope: TaskScope;
  query: string;
  sortBy: TaskSortBy;
  showCompleted: boolean;
}

export function filterAndSortBrowserTasks(
  tasks: Task[],
  input: QueryTasksInput,
): Task[] {
  return tasks
    .filter((task) => matchesQuery(task, input))
    .sort((left, right) => compareTasks(left, right, input.sortBy))
    .map(cloneTask);
}

function matchesQuery(task: Task, input: QueryTasksInput): boolean {
  const deletedView =
    input.scope.kind === "view" && input.scope.view === "deleted";
  if (deletedView) {
    if (!task.deletedAt) return false;
  } else if (task.deletedAt || task.status === "archived") {
    return false;
  }
  if (!matchesScope(task, input.scope, input.showCompleted)) return false;

  const parsed = parseSearchQuery(input.query);
  if (parsed.text) {
    const query = parsed.text.toLocaleLowerCase("zh-CN");
    if (
      ![task.title, task.note ?? ""]
        .join("\n")
        .toLocaleLowerCase("zh-CN")
        .includes(query)
    ) {
      return false;
    }
  }
  if (parsed.priority !== null && task.priority !== parsed.priority)
    return false;
  if (
    parsed.tagName !== null &&
    !task.tags.some(
      (tag) =>
        tag.toLocaleLowerCase("zh-CN") ===
        parsed.tagName!.toLocaleLowerCase("zh-CN"),
    )
  ) {
    return false;
  }
  // l: 匹配清单名称（与 Rust 侧 name 子查询语义一致），解析为 ID 比较。
  if (parsed.listName !== null) {
    const list = getBrowserListsSnapshot().find(
      (item) =>
        item.name.toLocaleLowerCase("zh-CN") ===
        parsed.listName!.toLocaleLowerCase("zh-CN"),
    );
    if (!list || task.listId !== list.id) return false;
  }
  if (parsed.due !== null) {
    if (parsed.due === "none") {
      if (task.dueAt !== null) return false;
    } else if (parsed.due === "today") {
      if (task.status !== "todo") return false;
      if (taskPlanDateKey(task) !== localDateKey(new Date())) return false;
    } else if (!task.dueAt) {
      return false;
    } else if (task.status !== "todo") {
      return false;
    } else if (parsed.due === "overdue" && !isOverdue(task.dueAt)) {
      return false;
    }
  }
  return true;
}

interface ParsedSearchQuery {
  text: string | null;
  priority: number | null;
  listName: string | null;
  tagName: string | null;
  due: "today" | "overdue" | "none" | null;
}

/** 与 task_repository.rs::parse_search_query 保持同一语义。 */
function parseSearchQuery(query: string): ParsedSearchQuery {
  const textParts: string[] = [];
  let priority: number | null = null;
  let listName: string | null = null;
  let tagName: string | null = null;
  let due: "today" | "overdue" | "none" | null = null;

  for (const token of query.split(/\s+/)) {
    if (token.startsWith("p:")) {
      const value = token.slice(2);
      if (/^[0-2]$/.test(value)) {
        priority = Number(value);
        continue;
      }
    }
    if (token.startsWith("l:")) {
      const name = token.slice(2).trim();
      if (name) {
        listName = name;
        continue;
      }
    }
    if (token.startsWith("tag:")) {
      const name = token.slice(4).trim().replace(/^#/, "");
      if (name) {
        tagName = name;
        continue;
      }
    }
    if (token.startsWith("due:")) {
      const value = token.slice(4);
      if (value === "今天" || value === "today") due = "today";
      else if (value === "过期" || value === "overdue") due = "overdue";
      else if (value === "无" || value === "none") due = "none";
      if (due !== null) continue;
    }
    textParts.push(token);
  }

  return {
    text: textParts.length > 0 ? textParts.join(" ") : null,
    priority,
    listName,
    tagName,
    due,
  };
}

function matchesScope(
  task: Task,
  scope: TaskScope,
  showCompleted: boolean,
): boolean {
  if (scope.kind === "list") {
    if (task.listId !== scope.listId) return false;
    return showCompleted || task.status !== "done";
  }

  return matchesSystemView(task, scope.view, showCompleted);
}

function matchesSystemView(
  task: Task,
  view: SystemView,
  showCompleted: boolean,
): boolean {
  // 回收站视图的 deletedAt 过滤已在 matchesQuery() 中完成。
  if (view === "deleted") return true;
  if (view === "completed") return task.status === "done";
  if (!showCompleted && task.status === "done") return false;
  if (view === "all") return true;
  if (task.status !== "todo") return false;
  if (view === "important") return task.priority === 2;
  if (view === "planned") return task.scheduledDate !== null || task.dueAt !== null;
  if (view === "overdue") return Boolean(task.dueAt && isOverdue(task.dueAt));
  if (view === "no-date") return task.dueAt === null;
  return taskPlanDateKey(task) === localDateKey(new Date());
}

function isOverdue(dueAt: string): boolean {
  return localDateKey(new Date(dueAt)) < localDateKey(new Date());
}

function compareTasks(left: Task, right: Task, sortBy: TaskSortBy): number {
  if (sortBy === "priority") {
    if (left.priority !== right.priority) return right.priority - left.priority;
    return (
      compareDueDates(left, right) ||
      right.createdAt.localeCompare(left.createdAt)
    );
  }

  if (sortBy === "date") {
    return (
      compareDueDates(left, right) ||
      right.priority - left.priority ||
      right.createdAt.localeCompare(left.createdAt)
    );
  }

  if (sortBy === "manual") {
    if (left.sortOrder !== right.sortOrder)
      return left.sortOrder - right.sortOrder;
    return left.createdAt.localeCompare(right.createdAt);
  }

  return left.createdAt.localeCompare(right.createdAt);
}

function compareDueDates(left: Task, right: Task): number {
  const leftKey = taskPlanDateKey(left);
  const rightKey = taskPlanDateKey(right);
  if (!leftKey && !rightKey) return 0;
  if (!leftKey) return 1;
  if (!rightKey) return -1;
  return (
    leftKey.localeCompare(rightKey) ||
    compareNullableText(left.dueAt, right.dueAt)
  );
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function taskPlanDateKey(task: Task): string | null {
  if (task.scheduledDate) return task.scheduledDate;
  return task.dueAt ? localDateKey(new Date(task.dueAt)) : null;
}

function compareNullableText(left: string | null, right: string | null): number {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return left.localeCompare(right);
}

function cloneTask(task: Task): Task {
  return {
    ...task,
    subtasks: task.subtasks.map((subtask) => ({ ...subtask })),
    tags: [...task.tags],
  };
}
