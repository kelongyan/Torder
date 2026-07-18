import { invoke, isTauri } from "@tauri-apps/api/core";
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
  defaultList("inbox", "收件箱", 0),
  defaultList("work", "工作", 1),
  defaultList("life", "生活", 2),
];

export function listLists(): Promise<TaskList[]> {
  if (!isTauri()) {
    return Promise.resolve(browserLists.map((list) => ({ ...list })));
  }
  return invoke<TaskList[]>("list_lists");
}

export function createList(input: CreateListInput): Promise<TaskList> {
  return invoke<TaskList>("create_list", { input });
}

export function updateList(input: UpdateListInput): Promise<TaskList> {
  return invoke<TaskList>("update_list", { input });
}

export function deleteList(id: string): Promise<void> {
  return invoke<void>("delete_list", { id });
}

export function getBrowserListsSnapshot(): TaskList[] {
  return browserLists.map((list) => ({ ...list }));
}

export function replaceBrowserLists(lists: TaskList[]): void {
  browserLists = lists.map((list) => ({ ...list }));
}

function defaultList(id: string, name: string, sortOrder: number): TaskList {
  const timestamp = new Date().toISOString();
  return {
    id,
    name,
    color: null,
    sortOrder,
    isDefault: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
