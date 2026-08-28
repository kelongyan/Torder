import type { CreateTaskLinkInput, Task, TaskLink } from "../types/database";
import { findBrowserTask, getBrowserTasksSnapshot } from "./browserTaskMock";

let browserTaskLinks: TaskLink[] = [];

export function listBrowserTaskLinks(taskId: string): TaskLink[] {
  return browserTaskLinks
    .filter((link) => link.sourceTaskId === taskId && !link.deletedAt)
    .filter((link) => Boolean(findBrowserTask(link.targetTaskId)))
    .sort(compareLinks)
    .map(hydrateLink);
}

export function createBrowserTaskLink(input: CreateTaskLinkInput): TaskLink {
  const source = findBrowserTask(input.sourceTaskId);
  const target = findBrowserTask(input.targetTaskId);
  if (!source) throw new Error("源任务不存在");
  if (!target) throw new Error("引用任务不存在");
  if (source.id === target.id) throw new Error("任务不能引用自己");
  const existing = browserTaskLinks.find(
    (link) =>
      link.sourceTaskId === source.id &&
      link.targetTaskId === target.id &&
      !link.deletedAt,
  );
  if (existing) return hydrateLink(existing);
  const now = new Date().toISOString();
  const link: TaskLink = {
    id: `browser-task-link-${crypto.randomUUID()}`,
    sourceTaskId: source.id,
    targetTaskId: target.id,
    relationType: "reference",
    sortOrder: nextSortOrder(source.id),
    targetTitle: target.title,
    targetStatus: target.status,
    targetListId: target.listId,
    targetScheduledDate: target.scheduledDate,
    targetDueAt: target.dueAt,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  browserTaskLinks = [...browserTaskLinks, link];
  return hydrateLink(link);
}

export function deleteBrowserTaskLink(id: string): void {
  const index = browserTaskLinks.findIndex(
    (link) => link.id === id && !link.deletedAt,
  );
  if (index < 0) throw new Error("任务引用不存在");
  const deletedAt = new Date().toISOString();
  browserTaskLinks = browserTaskLinks.map((link, linkIndex) =>
    linkIndex === index ? { ...link, updatedAt: deletedAt, deletedAt } : link,
  );
}

export function searchBrowserLinkableTasks(
  sourceTaskId: string,
  query: string,
  limit: number,
): Task[] {
  const normalized = query.trim().toLocaleLowerCase("zh-CN");
  const linkedIds = new Set(
    browserTaskLinks
      .filter((link) => link.sourceTaskId === sourceTaskId && !link.deletedAt)
      .map((link) => link.targetTaskId),
  );
  return getBrowserTasksSnapshot()
    .filter((task) => task.id !== sourceTaskId)
    .filter((task) => !task.deletedAt && task.status !== "archived")
    .filter((task) => !linkedIds.has(task.id))
    .filter((task) => {
      if (!normalized) return true;
      // 与 Rust 一致：title、note 分别匹配（LIKE title OR LIKE note），
      // 不允许跨字段命中。
      return (
        task.title.toLocaleLowerCase("zh-CN").includes(normalized) ||
        (task.note ?? "").toLocaleLowerCase("zh-CN").includes(normalized)
      );
    })
    // 与 Rust ORDER BY updated_at DESC, created_at DESC 对齐。
    .sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) ||
        right.createdAt.localeCompare(left.createdAt),
    )
    .slice(0, Math.max(1, Math.min(limit, 20)));
}

function hydrateLink(link: TaskLink): TaskLink {
  const target = findBrowserTask(link.targetTaskId);
  return {
    ...link,
    targetTitle: target?.title ?? link.targetTitle,
    targetStatus: target?.status ?? link.targetStatus,
    targetListId: target?.listId ?? link.targetListId,
    targetScheduledDate: target?.scheduledDate ?? link.targetScheduledDate,
    targetDueAt: target?.dueAt ?? link.targetDueAt,
  };
}

function nextSortOrder(sourceTaskId: string): number {
  const orders = browserTaskLinks
    .filter((link) => link.sourceTaskId === sourceTaskId && !link.deletedAt)
    .map((link) => link.sortOrder);
  return orders.length ? Math.max(...orders) + 1000 : 0;
}

function compareLinks(left: TaskLink, right: TaskLink): number {
  if (left.sortOrder !== right.sortOrder)
    return left.sortOrder - right.sortOrder;
  return left.createdAt.localeCompare(right.createdAt);
}
