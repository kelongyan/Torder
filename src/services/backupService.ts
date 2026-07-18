import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { getBrowserListsSnapshot, replaceBrowserLists } from "./listService";
import {
  getBrowserSettingsSnapshot,
  replaceBrowserSettings,
} from "./settingsService";
import {
  getBrowserTagsSnapshot,
  getBrowserTaskTagLinks,
  replaceBrowserTagData,
} from "./tagService";
import { getBrowserTasksSnapshot, replaceBrowserTasks } from "./taskService";
import type {
  BackupFile,
  BackupImportSource,
  BackupOperationResult,
  BackupPreview,
  PendingBackupImport,
} from "../types/backup";
import type { Setting, Tag, Task, TaskList } from "../types/database";

export async function exportBackup(): Promise<BackupOperationResult | null> {
  const filename = createBackupFilename();
  if (isTauri()) {
    const path = await save({
      title: "导出 Torder 备份",
      defaultPath: filename,
      filters: [{ name: "Torder JSON 备份", extensions: ["json"] }],
    });
    if (!path) return null;
    return invoke<BackupOperationResult>("export_backup", { path });
  }

  const backup = createBrowserBackup();
  const content = JSON.stringify(backup, null, 2);
  const url = URL.createObjectURL(
    new Blob([content], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
  return { path: filename, preview: createPreview(backup) };
}

export async function chooseBackupForImport(): Promise<PendingBackupImport | null> {
  if (!isTauri()) return null;
  const path = await open({
    title: "选择 Torder 备份",
    multiple: false,
    directory: false,
    filters: [{ name: "Torder JSON 备份", extensions: ["json"] }],
  });
  if (!path) return null;
  const result = await invoke<BackupOperationResult>("inspect_backup", {
    path,
  });
  return {
    source: { kind: "path", path, name: fileNameFromPath(path) },
    preview: result.preview,
  };
}

export async function inspectBrowserBackup(
  file: File,
): Promise<PendingBackupImport> {
  const content = await file.text();
  const backup = parseAndValidateBackup(content);
  return {
    source: { kind: "browser", name: file.name, content },
    preview: createPreview(backup),
  };
}

export async function restoreBackup(
  source: BackupImportSource,
): Promise<BackupOperationResult> {
  if (source.kind === "path") {
    return invoke<BackupOperationResult>("restore_backup", {
      path: source.path,
    });
  }

  const backup = parseAndValidateBackup(source.content);
  replaceBrowserLists(backup.data.lists);
  replaceBrowserTagData(backup.data.tags, backup.data.taskTags);
  replaceBrowserTasks(backup.data.tasks);
  replaceBrowserSettings(backup.data.settings);
  return { path: source.name, preview: createPreview(backup) };
}

function createBrowserBackup(): BackupFile {
  return {
    app: "Torder",
    version: "0.1.0",
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    data: {
      tasks: getBrowserTasksSnapshot(),
      lists: getBrowserListsSnapshot(),
      tags: getBrowserTagsSnapshot(),
      taskTags: getBrowserTaskTagLinks(),
      settings: getBrowserSettingsSnapshot(),
    },
  };
}

function parseAndValidateBackup(content: string): BackupFile {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error("JSON 文件无法解析");
  }
  if (!isRecord(value)) throw new Error("备份根结构无效");
  if (value.app !== "Torder") throw new Error("文件不是 Torder 备份");
  if (value.formatVersion !== 1) throw new Error("不支持的备份格式版本");
  if (typeof value.version !== "string" || !value.version.trim()) {
    throw new Error("备份缺少应用版本");
  }
  if (typeof value.exportedAt !== "string" || !value.exportedAt.trim()) {
    throw new Error("备份缺少导出时间");
  }
  if (!isRecord(value.data)) throw new Error("备份数据结构无效");

  const tasks = validateTasks(value.data.tasks);
  const lists = validateLists(value.data.lists);
  const tags = validateTags(value.data.tags);
  const taskTags = validateTaskTags(value.data.taskTags);
  const settings = validateSettings(value.data.settings);
  const listIds = new Set(lists.map((list) => list.id));
  const tagIds = new Set(tags.map((tag) => tag.id));
  const taskIds = new Set(tasks.map((task) => task.id));

  if (!listIds.has("inbox")) throw new Error("备份缺少收件箱清单");
  for (const task of tasks) {
    if (!listIds.has(task.listId)) {
      throw new Error("任务引用了不存在的清单");
    }
  }
  const links = new Set<string>();
  for (const link of taskTags) {
    if (!taskIds.has(link.taskId) || !tagIds.has(link.tagId)) {
      throw new Error("任务标签关联引用不完整");
    }
    const key = `${link.taskId}\u0000${link.tagId}`;
    if (links.has(key)) throw new Error("任务标签关联重复");
    links.add(key);
  }

  return {
    app: "Torder",
    version: value.version,
    formatVersion: 1,
    exportedAt: value.exportedAt,
    data: { tasks, lists, tags, taskTags, settings },
  };
}

function validateLists(value: unknown): TaskList[] {
  if (!Array.isArray(value)) throw new Error("清单数据无效");
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const item of value) {
    if (
      !isRecord(item) ||
      !isNonEmptyString(item.id) ||
      !isNonEmptyString(item.name) ||
      !isNullableString(item.color) ||
      typeof item.sortOrder !== "number" ||
      typeof item.isDefault !== "boolean" ||
      !isNonEmptyString(item.createdAt) ||
      !isNonEmptyString(item.updatedAt)
    ) {
      throw new Error("清单记录结构无效");
    }
    if (ids.has(item.id)) throw new Error("清单 ID 重复");
    const normalizedName = item.name.toLocaleLowerCase("zh-CN");
    if (names.has(normalizedName)) throw new Error("清单名称重复");
    ids.add(item.id);
    names.add(normalizedName);
  }
  return value as TaskList[];
}

function validateTags(value: unknown): Tag[] {
  if (!Array.isArray(value)) throw new Error("标签数据无效");
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const item of value) {
    if (
      !isRecord(item) ||
      !isNonEmptyString(item.id) ||
      !isNonEmptyString(item.name) ||
      !isNullableString(item.color) ||
      !isNonEmptyString(item.createdAt) ||
      !isNonEmptyString(item.updatedAt)
    ) {
      throw new Error("标签记录结构无效");
    }
    if (ids.has(item.id)) throw new Error("标签 ID 重复");
    const normalizedName = item.name.toLocaleLowerCase("zh-CN");
    if (names.has(normalizedName)) throw new Error("标签名称重复");
    ids.add(item.id);
    names.add(normalizedName);
  }
  return value as Tag[];
}

function validateTasks(value: unknown): Task[] {
  if (!Array.isArray(value)) throw new Error("任务数据无效");
  const ids = new Set<string>();
  for (const item of value) {
    if (
      !isRecord(item) ||
      !isNonEmptyString(item.id) ||
      !isNonEmptyString(item.title) ||
      !isNullableString(item.note) ||
      !isTaskStatus(item.status) ||
      !isPriority(item.priority) ||
      !isNonEmptyString(item.listId) ||
      !isNullableString(item.dueAt) ||
      !isNullableString(item.remindAt) ||
      !isNullableString(item.remindedAt) ||
      !isNullableString(item.completedAt) ||
      typeof item.sortOrder !== "number" ||
      !isNonEmptyString(item.createdAt) ||
      !isNonEmptyString(item.updatedAt) ||
      !isNullableString(item.deletedAt)
    ) {
      throw new Error("任务记录结构无效");
    }
    if (ids.has(item.id)) throw new Error("任务 ID 重复");
    ids.add(item.id);
  }
  return value as Task[];
}

function validateTaskTags(
  value: unknown,
): Array<{ taskId: string; tagId: string }> {
  if (!Array.isArray(value)) throw new Error("任务标签关联数据无效");
  for (const item of value) {
    if (
      !isRecord(item) ||
      !isNonEmptyString(item.taskId) ||
      !isNonEmptyString(item.tagId)
    ) {
      throw new Error("任务标签关联结构无效");
    }
  }
  return value as Array<{ taskId: string; tagId: string }>;
}

function validateSettings(value: unknown): Setting[] {
  if (!Array.isArray(value)) throw new Error("设置数据无效");
  const keys = new Set<string>();
  for (const item of value) {
    if (
      !isRecord(item) ||
      !isNonEmptyString(item.key) ||
      typeof item.value !== "string" ||
      !isNonEmptyString(item.updatedAt)
    ) {
      throw new Error("设置记录结构无效");
    }
    if (keys.has(item.key)) throw new Error("设置键重复");
    try {
      JSON.parse(item.value);
    } catch {
      throw new Error("设置值不是合法 JSON");
    }
    keys.add(item.key);
  }
  return value as Setting[];
}

function createPreview(backup: BackupFile): BackupPreview {
  return {
    appVersion: backup.version,
    formatVersion: backup.formatVersion,
    exportedAt: backup.exportedAt,
    taskCount: backup.data.tasks.length,
    listCount: backup.data.lists.length,
    tagCount: backup.data.tags.length,
    settingCount: backup.data.settings.length,
  };
}

function createBackupFilename(): string {
  const now = new Date();
  const date = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
  ].join("-");
  const time = [
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
  return `Torder-backup-${date}-${time}.json`;
}

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isTaskStatus(value: unknown): boolean {
  return value === "todo" || value === "done" || value === "archived";
}

function isPriority(value: unknown): boolean {
  return value === 0 || value === 1 || value === 2;
}
