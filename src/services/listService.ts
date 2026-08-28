import { invoke, isTauri } from "@tauri-apps/api/core";
import { DEFAULT_LIST_COLOR, defaultListColors } from "../constants/listConfig";
import type { TaskList } from "../types/database";

export interface CreateListInput {
  name: string;
  color?: string | null;
  sortOrder?: number;
}

export interface UpdateListInput {
  id: string;
  name: string;
  color: string | null;
  sortOrder: number;
}

// 双模式共用的清单快照：浏览器模式下是唯一数据源，
// Tauri 模式下由 IPC 结果同步，供本地派生查询解析 `l:<清单名>`。
// Tauri 模式初始置空：首次 listLists() 返回前，`l:` 解析宁可无结果，
// 也不能用一份可能与真实数据不符的预置清单集；浏览器 mock 模式保留三个预置清单。
let listsSnapshot: TaskList[] = isTauri()
  ? []
  : [
      defaultList("work", "工作", defaultListColors.work, 0),
      defaultList("personal", "个人", defaultListColors.personal, 1),
      defaultList("study", "学习", defaultListColors.study, 2),
    ];

export function listLists(): Promise<TaskList[]> {
  if (!isTauri()) {
    return Promise.resolve(listsSnapshot.map((list) => ({ ...list })));
  }
  return invoke<TaskList[]>("list_lists").then((lists) => {
    listsSnapshot = lists.map((list) => ({ ...list }));
    return lists;
  });
}

export async function createList(input: CreateListInput): Promise<TaskList> {
  if (!isTauri()) {
    const name = validateBrowserName(input.name);
    ensureBrowserNameAvailable(name);
    const timestamp = new Date().toISOString();
    const list: TaskList = {
      id: `list-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name,
      color: input.color ?? DEFAULT_LIST_COLOR,
      // 默认排到末尾（与 Rust 侧 create 的默认值一致），而不是依赖数组长度。
      sortOrder: input.sortOrder ?? nextListSortOrder(),
      isDefault: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    };
    listsSnapshot = [...listsSnapshot, list].sort(compareLists);
    return Promise.resolve({ ...list });
  }
  return invoke<TaskList>("create_list", { input }).then((list) => {
    upsertListsSnapshot(list);
    return list;
  });
}

export async function updateList(input: UpdateListInput): Promise<TaskList> {
  if (!isTauri()) {
    const index = listsSnapshot.findIndex((list) => list.id === input.id);
    if (index < 0) return Promise.reject(new Error("清单不存在"));
    const name = validateBrowserName(input.name);
    ensureBrowserNameAvailable(name, input.id);
    const next = {
      ...listsSnapshot[index],
      name,
      color: input.color,
      sortOrder: input.sortOrder,
      updatedAt: new Date().toISOString(),
    };
    listsSnapshot = listsSnapshot
      .map((list, listIndex) => (listIndex === index ? next : list))
      .sort(compareLists);
    return Promise.resolve({ ...next });
  }
  return invoke<TaskList>("update_list", { input }).then((list) => {
    upsertListsSnapshot(list);
    return list;
  });
}

export function deleteList(id: string): Promise<void> {
  if (!isTauri()) {
    const list = listsSnapshot.find((item) => item.id === id);
    if (!list) return Promise.reject(new Error("清单不存在"));
    if (list.isDefault) return Promise.reject(new Error("默认清单不能删除"));
    listsSnapshot = listsSnapshot.filter((item) => item.id !== id);
    return Promise.resolve();
  }
  return invoke<void>("delete_list", { id }).then(() => {
    listsSnapshot = listsSnapshot.filter((item) => item.id !== id);
  });
}

export function getListsSnapshot(): TaskList[] {
  return listsSnapshot.map((list) => ({ ...list }));
}

function upsertListsSnapshot(list: TaskList): void {
  const exists = listsSnapshot.some((item) => item.id === list.id);
  listsSnapshot = (
    exists
      ? listsSnapshot.map((item) => (item.id === list.id ? { ...list } : item))
      : [...listsSnapshot, { ...list }]
  ).sort(compareLists);
}

function defaultList(
  id: string,
  name: string,
  color: string,
  sortOrder: number,
): TaskList {
  const timestamp = new Date().toISOString();
  return {
    id,
    name,
    color,
    sortOrder,
    isDefault: true,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
}

function validateBrowserName(name: string): string {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("清单名称不能为空");
  return trimmedName;
}

function ensureBrowserNameAvailable(name: string, currentId?: string): void {
  const duplicate = listsSnapshot.some(
    (list) =>
      list.id !== currentId &&
      list.name.localeCompare(name, "zh-CN", { sensitivity: "accent" }) === 0,
  );
  if (duplicate) throw new Error("清单名称已存在");
}

function compareLists(left: TaskList, right: TaskList): number {
  if (left.sortOrder !== right.sortOrder)
    return left.sortOrder - right.sortOrder;
  return left.createdAt.localeCompare(right.createdAt);
}

/** 新建清单的默认位置：排在现有清单末尾（最大 sortOrder + 1）。 */
function nextListSortOrder(): number {
  return (
    listsSnapshot.reduce((max, list) => Math.max(max, list.sortOrder), -1) + 1
  );
}
