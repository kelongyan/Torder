import { invoke, isTauri } from "@tauri-apps/api/core";
import type { CreateTaskLinkInput, Task, TaskLink } from "../types/database";
import {
  createBrowserTaskLink,
  deleteBrowserTaskLink,
  listBrowserTaskLinks,
  searchBrowserLinkableTasks,
} from "./browserTaskLinkMock";

export function listTaskLinks(taskId: string): Promise<TaskLink[]> {
  if (!isTauri()) {
    return Promise.resolve(listBrowserTaskLinks(taskId));
  }
  return invoke<TaskLink[]>("list_task_links", { taskId });
}

export async function createTaskLink(
  input: CreateTaskLinkInput,
): Promise<TaskLink> {
  if (!isTauri()) {
    return Promise.resolve(createBrowserTaskLink(input));
  }
  return invoke<TaskLink>("create_task_link", { input });
}

export async function deleteTaskLink(id: string): Promise<void> {
  if (!isTauri()) {
    deleteBrowserTaskLink(id);
    return Promise.resolve();
  }
  return invoke<void>("delete_task_link", { id });
}

export function searchLinkableTasks(
  sourceTaskId: string,
  query: string,
  limit = 10,
): Promise<Task[]> {
  if (!isTauri()) {
    return Promise.resolve(
      searchBrowserLinkableTasks(sourceTaskId, query, limit),
    );
  }
  return invoke<Task[]>("search_linkable_tasks", {
    sourceTaskId,
    query: query.trim() || null,
    limit,
  });
}
