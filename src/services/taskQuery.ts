import { getListsSnapshot } from "./listService";
import type {
  SystemView,
  Task,
  TaskFilter,
  TaskPriority,
  TaskScope,
  TaskSortBy,
} from "../types/database";

export interface QueryTasksInput {
  scope: TaskScope;
  query: string;
  sortBy: TaskSortBy;
  /** R04 排序方向：true 升序（早的/小的在前），false 降序。缺省 true。 */
  sortAsc?: boolean;
  showCompleted: boolean;
  /** R04 筛选面板多选条件；空条件（或 null）表示不过滤。 */
  filter?: TaskFilter | null;
}

/**
 * 任务作用域过滤 + 排序的客户端实现，双模式共用：
 * 浏览器模式下是查询的完整实现，Tauri 模式下用于乐观更新的本地派生。
 * 语义必须与 task_repository.rs 的 push_view_scope / sort_clause /
 * parse_search_query 保持一致。
 */
export function filterAndSortTasks(
  tasks: Task[],
  input: QueryTasksInput,
): Task[] {
  const sortAsc = input.sortAsc ?? true;
  const direction = sortAsc ? 1 : -1;
  return tasks
    .filter((task) => matchesQuery(task, input))
    .sort(
      (left, right) => compareTasks(left, right, input.sortBy) * direction,
    )
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
  const showCompleted = input.showCompleted || Boolean(input.filter?.includeCompleted);
  if (!matchesScope(task, input.scope, showCompleted)) return false;
  if (!matchesFilter(task, input.filter)) return false;

  const parsed = parseSearchQuery(input.query);
  if (parsed.text) {
    // Rust：title LIKE %text% OR COALESCE(note,'') LIKE %text%（分字段，不允许跨字段命中）。
    const query = foldAsciiCase(parsed.text);
    if (
      !foldAsciiCase(task.title).includes(query) &&
      !foldAsciiCase(task.note ?? "").includes(query)
    ) {
      return false;
    }
  }
  if (parsed.priority !== null && task.priority !== parsed.priority)
    return false;
  if (
    parsed.tagName !== null &&
    !task.tags.some((tag) => foldAsciiCase(tag) === foldAsciiCase(parsed.tagName!))
  ) {
    return false;
  }
  // l: 匹配清单名称（与 Rust 侧 name 子查询语义一致），解析为 ID 比较。
  if (parsed.listName !== null) {
    const wantedName = foldAsciiCase(parsed.listName);
    const list = getListsSnapshot().find(
      (item) => foldAsciiCase(item.name) === wantedName,
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

/**
 * R04 筛选面板：组内取「或」、组间取「与」。
 * 三组条件各自为空时视为不限，这样未设置条件时行为与改动前完全一致。
 */
function matchesFilter(task: Task, filter: TaskFilter | null | undefined): boolean {
  if (!filter) return true;
  if (filter.listIds.length > 0 && !filter.listIds.includes(task.listId))
    return false;
  if (filter.priorities.length > 0) {
    if (!filter.priorities.includes(task.priority as TaskPriority)) return false;
  }
  if (filter.tags.length > 0) {
    const wanted = filter.tags.map((tag) => foldAsciiCase(tag));
    const owned = task.tags.map((tag) => foldAsciiCase(tag));
    if (!owned.some((tag) => wanted.includes(tag))) return false;
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
function parseSearchQuery(rawQuery: string): ParsedSearchQuery {
  const textParts: string[] = [];
  let priority: number | null = null;
  let listName: string | null = null;
  let tagName: string | null = null;
  let due: "today" | "overdue" | "none" | null = null;

  // Rust 侧先 trim 再 split_whitespace；空 token 一律跳过。
  for (const token of rawQuery.trim().split(/\s+/)) {
    if (!token) continue;
    if (token.startsWith("p:")) {
      const value = token.slice(2);
      // 与 Rust value.parse::<i64>() 一致：允许 +/- 号与前导零，再检查 0..=2。
      if (/^[+-]?\d+$/.test(value)) {
        const number = Number(value);
        if (number >= 0 && number <= 2) {
          priority = number;
          continue;
        }
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
      // 与 Rust trim_start_matches('#') 一致：剥掉所有前导 #。
      const name = token.slice(4).trim().replace(/^#+/, "");
      if (name) {
        tagName = name;
        continue;
      }
    }
    if (token.startsWith("due:")) {
      const value = token.slice(4);
      let next: ParsedSearchQuery["due"] = null;
      if (value === "今天" || value === "today") next = "today";
      else if (value === "过期" || value === "overdue") next = "overdue";
      else if (value === "无" || value === "none") next = "none";
      if (next !== null) {
        due = next;
        continue;
      }
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

/**
 * SQLite COLLATE NOCASE / LIKE 只折叠 ASCII A-Z，这里保持一致，
 * 不使用 locale 折叠（否则两种模式的大小写匹配行为会漂移）。
 */
function foldAsciiCase(value: string): string {
  return value.replace(/[A-Z]/g, (char) => char.toLowerCase());
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

export function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function shiftDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

export function taskPlanDateKey(task: Task): string | null {
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
