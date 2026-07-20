import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Tag } from "../types/database";

export interface CreateTagInput {
  name: string;
  color?: string | null;
}

export interface UpdateTagInput {
  id: string;
  name: string;
  color: string | null;
}

let browserTags: Tag[] = [
  browserTag("tag-development", "开发", "#0d7a5f"),
  browserTag("tag-review", "复盘", "#b45309"),
];

const browserTaskTags = new Map<string, string[]>([
  ["preview-overdue", ["tag-development"]],
  ["preview-today", ["tag-review"]],
]);

export function listTags(): Promise<Tag[]> {
  if (!isTauri()) {
    return Promise.resolve(getBrowserTagsSnapshot());
  }
  return invoke<Tag[]>("list_tags");
}

export function createTag(input: CreateTagInput): Promise<Tag> {
  if (!isTauri()) {
    const name = validateBrowserName(input.name);
    ensureBrowserNameAvailable(name);
    const timestamp = new Date().toISOString();
    const tag: Tag = {
      id: `browser-tag-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name,
      color: input.color ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    browserTags = [...browserTags, tag].sort(compareTags);
    return Promise.resolve({ ...tag });
  }
  return invoke<Tag>("create_tag", { input });
}

export function updateTag(input: UpdateTagInput): Promise<Tag> {
  if (!isTauri()) {
    const index = browserTags.findIndex((tag) => tag.id === input.id);
    if (index < 0) {
      return Promise.reject(new Error("标签不存在"));
    }
    const name = validateBrowserName(input.name);
    ensureBrowserNameAvailable(name, input.id);
    const next: Tag = {
      ...browserTags[index],
      name,
      color: input.color,
      updatedAt: new Date().toISOString(),
    };
    browserTags = browserTags
      .map((tag, tagIndex) => (tagIndex === index ? next : tag))
      .sort(compareTags);
    return Promise.resolve({ ...next });
  }
  return invoke<Tag>("update_tag", { input });
}

export function deleteTag(id: string): Promise<void> {
  if (!isTauri()) {
    if (!browserTags.some((tag) => tag.id === id)) {
      return Promise.reject(new Error("标签不存在"));
    }
    browserTags = browserTags.filter((tag) => tag.id !== id);
    for (const [taskId, tagIds] of browserTaskTags) {
      const nextTagIds = tagIds.filter((tagId) => tagId !== id);
      if (nextTagIds.length === 0) {
        browserTaskTags.delete(taskId);
      } else {
        browserTaskTags.set(taskId, nextTagIds);
      }
    }
    return Promise.resolve();
  }
  return invoke<void>("delete_tag", { id });
}

export function getBrowserTagsSnapshot(): Tag[] {
  return browserTags.map((tag) => ({ ...tag }));
}

export function getBrowserTaskTagIds(taskId: string): string[] {
  return [...(browserTaskTags.get(taskId) ?? [])];
}

export function setBrowserTaskTagIds(taskId: string, tagIds: string[]): void {
  const availableIds = new Set(browserTags.map((tag) => tag.id));
  const nextTagIds = [...new Set(tagIds)].filter((id) => availableIds.has(id));
  if (nextTagIds.length === 0) {
    browserTaskTags.delete(taskId);
  } else {
    browserTaskTags.set(taskId, nextTagIds);
  }
}

export function deleteBrowserTaskTagLinks(taskId: string): void {
  browserTaskTags.delete(taskId);
}

export function getBrowserTaskTagLinks(): Array<{
  taskId: string;
  tagId: string;
}> {
  return [...browserTaskTags.entries()].flatMap(([taskId, tagIds]) =>
    tagIds.map((tagId) => ({ taskId, tagId })),
  );
}

export function replaceBrowserTagData(
  tags: Tag[],
  links: Array<{ taskId: string; tagId: string }>,
): void {
  browserTags = tags.map((tag) => ({ ...tag })).sort(compareTags);
  browserTaskTags.clear();
  for (const link of links) {
    const current = browserTaskTags.get(link.taskId) ?? [];
    browserTaskTags.set(link.taskId, [...current, link.tagId]);
  }
}

function browserTag(id: string, name: string, color: string): Tag {
  const timestamp = new Date().toISOString();
  return {
    id,
    name,
    color,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function validateBrowserName(name: string): string {
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error("标签名称不能为空");
  }
  return trimmedName;
}

function ensureBrowserNameAvailable(name: string, currentId?: string): void {
  const duplicate = browserTags.some(
    (tag) =>
      tag.id !== currentId &&
      tag.name.localeCompare(name, "zh-CN", { sensitivity: "accent" }) === 0,
  );
  if (duplicate) {
    throw new Error("标签名称已存在");
  }
}

function compareTags(left: Tag, right: Tag): number {
  return left.name.localeCompare(right.name, "zh-CN");
}
