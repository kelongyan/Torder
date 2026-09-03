import type { Task, TaskList } from "../../types/database";
import { filterAndSortTasks } from "../../services/taskQuery";
import type { TaskFilter } from "../../types/database";

/**
 * 搜索结果中按清单分组的结构。
 */
export interface TaskListGroup {
  listId: string;
  listName: string;
  color: string;
  tasks: Task[];
  activeCount: number;
  completedCount: number;
}

/**
 * 将匹配出的任务列表按所属清单分组。
 * 分组顺序保持与 lists 一致，未在 lists 中的孤立清单或未归类任务排在最后。
 * 没有任何匹配任务的清单不会包含在返回结果中。
 */
export function groupTasksByList(
  tasks: Task[],
  lists: TaskList[],
): TaskListGroup[] {
  const listMap = new Map<string, TaskList>();
  for (const list of lists) {
    listMap.set(list.id, list);
  }

  // 按照 listId 归类任务
  const grouped = new Map<string, Task[]>();
  for (const task of tasks) {
    const key = task.listId || "inbox";
    const existing = grouped.get(key);
    if (existing) {
      existing.push(task);
    } else {
      grouped.set(key, [task]);
    }
  }

  const result: TaskListGroup[] = [];

  // 首先按 lists 的定义顺序添加分组
  for (const list of lists) {
    const matched = grouped.get(list.id);
    if (matched && matched.length > 0) {
      const activeCount = matched.filter((t) => t.status !== "done").length;
      result.push({
        listId: list.id,
        listName: list.name,
        color: list.color ?? "var(--accent)",
        tasks: matched,
        activeCount,
        completedCount: matched.length - activeCount,
      });
      grouped.delete(list.id);
    }
  }

  // 剩余未在 lists 中注册的 listId（或 inbox / 脏数据）
  for (const [key, matched] of grouped.entries()) {
    if (matched.length === 0) continue;
    const activeCount = matched.filter((t) => t.status !== "done").length;
    result.push({
      listId: key,
      listName: key === "inbox" ? "默认清单" : key,
      color: "var(--accent)",
      tasks: matched,
      activeCount,
      completedCount: matched.length - activeCount,
    });
  }

  return result;
}

/**
 * 全库搜索：复用 queryTasks 唯一口径（scope 为 all），
 * 自动支持普通文本、l:清单、tag:标签、p:优先级、due:日期等高级指令。
 */
export function searchAllTasks(
  allTasks: Task[],
  query: string,
  filter?: TaskFilter,
  showCompleted: boolean = true,
): Task[] {
  const trimmed = query.trim();
  if (!trimmed && (!filter || countActiveFilter(filter) === 0)) {
    return [];
  }
  return filterAndSortTasks(allTasks, {
    scope: { kind: "view", view: "all" },
    query: trimmed,
    filter,
    sortBy: "priority",
    sortAsc: true,
    showCompleted,
  });
}

function countActiveFilter(filter: TaskFilter): number {
  return (
    filter.listIds.length +
    filter.tags.length +
    filter.priorities.length +
    (filter.includeCompleted ? 1 : 0)
  );
}

/**
 * 当任务的 note 匹配了搜索词时，提取围绕关键词的前后上下文片段。
 */
export function getMatchingSnippet(
  text: string | null | undefined,
  query: string,
  maxLength: number = 60,
): string | null {
  if (!text || !query.trim()) return null;
  const needle = query.trim().toLocaleLowerCase("zh-CN");
  const haystack = text.toLocaleLowerCase("zh-CN");
  const index = haystack.indexOf(needle);
  if (index < 0) return null;

  // 前方取 15 字符，后方取剩余空间
  const start = Math.max(0, index - 15);
  const end = Math.min(text.length, start + maxLength);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";

  return `${prefix}${text.slice(start, end)}${suffix}`;
}
