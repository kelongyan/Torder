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

let browserLists: TaskList[] = [
  defaultList("work", "工作", defaultListColors.work, 0),
  defaultList("personal", "个人", defaultListColors.personal, 1),
  defaultList("study", "学习", defaultListColors.study, 2),
];

export function listLists(): Promise<TaskList[]> {
  if (!isTauri()) {
    return Promise.resolve(browserLists.map((list) => ({ ...list })));
  }
  return invoke<TaskList[]>("list_lists");
}

export function createList(input: CreateListInput): Promise<TaskList> {
  if (!isTauri()) {
    const name = validateBrowserName(input.name);
    ensureBrowserNameAvailable(name);
    const timestamp = new Date().toISOString();
    const list: TaskList = {
      id: `list-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name,
      color: input.color ?? DEFAULT_LIST_COLOR,
      sortOrder: input.sortOrder ?? browserLists.length,
      isDefault: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    browserLists = [...browserLists, list].sort(compareLists);
    return Promise.resolve({ ...list });
  }
  return invoke<TaskList>("create_list", { input });
}

export function updateList(input: UpdateListInput): Promise<TaskList> {
  if (!isTauri()) {
    const index = browserLists.findIndex((list) => list.id === input.id);
    if (index < 0) return Promise.reject(new Error("清单不存在"));
    const name = validateBrowserName(input.name);
    ensureBrowserNameAvailable(name, input.id);
    const next = {
      ...browserLists[index],
      name,
      color: input.color,
      sortOrder: input.sortOrder,
      updatedAt: new Date().toISOString(),
    };
    browserLists = browserLists
      .map((list, listIndex) => (listIndex === index ? next : list))
      .sort(compareLists);
    return Promise.resolve({ ...next });
  }
  return invoke<TaskList>("update_list", { input });
}

export function deleteList(id: string): Promise<void> {
  if (!isTauri()) {
    const list = browserLists.find((item) => item.id === id);
    if (!list) return Promise.reject(new Error("清单不存在"));
    if (list.isDefault) return Promise.reject(new Error("默认清单不能删除"));
    browserLists = browserLists.filter((item) => item.id !== id);
    return Promise.resolve();
  }
  return invoke<void>("delete_list", { id });
}

export function getBrowserListsSnapshot(): TaskList[] {
  return browserLists.map((list) => ({ ...list }));
}

export function replaceBrowserLists(lists: TaskList[]): void {
  browserLists = lists.map((list) => ({ ...list }));
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
  };
}

function validateBrowserName(name: string): string {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("清单名称不能为空");
  return trimmedName;
}

function ensureBrowserNameAvailable(name: string, currentId?: string): void {
  const duplicate = browserLists.some(
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
