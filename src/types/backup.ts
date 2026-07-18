import type { Setting, Tag, Task, TaskList } from "./database";

export interface TaskTagLink {
  taskId: string;
  tagId: string;
}

export interface BackupData {
  tasks: Task[];
  lists: TaskList[];
  tags: Tag[];
  taskTags: TaskTagLink[];
  settings: Setting[];
}

export interface BackupFile {
  app: "Torder";
  version: string;
  formatVersion: 1;
  exportedAt: string;
  data: BackupData;
}

export interface BackupPreview {
  appVersion: string;
  formatVersion: number;
  exportedAt: string;
  taskCount: number;
  listCount: number;
  tagCount: number;
  settingCount: number;
}

export interface BackupOperationResult {
  path: string;
  preview: BackupPreview;
}

export type BackupImportSource =
  | { kind: "path"; path: string; name: string }
  | { kind: "browser"; name: string; content: string };

export interface PendingBackupImport {
  source: BackupImportSource;
  preview: BackupPreview;
}
