import { invoke, isTauri } from "@tauri-apps/api/core";

export type ExportFormat = "json" | "markdown" | "csv";

export interface BackupImportPreview {
  path: string;
  name: string;
  listCount: number;
  taskCount: number;
  recurringRuleCount: number;
}

export interface BackupImportResult {
  importedLists: number;
  importedTasks: number;
  importedRecurringRules: number;
  skippedLists: number;
}

let browserBackupPaths: string[] = [];

export function backupDatabase(): Promise<string> {
  if (!isTauri()) {
    const name = `torder-backup-${browserStamp()}.sqlite`;
    browserBackupPaths = [name, ...browserBackupPaths];
    return Promise.resolve(`mock://backups/${name}`);
  }
  return invoke<string>("backup_database");
}

export function exportTasks(format: ExportFormat): Promise<string> {
  if (!isTauri()) {
    return Promise.resolve(
      `mock://exports/torder-export-${browserStamp()}.${format}`,
    );
  }
  return invoke<string>("export_tasks", { format });
}

export function listBackups(): Promise<string[]> {
  if (!isTauri()) {
    return Promise.resolve([...browserBackupPaths]);
  }
  return invoke<string[]>("list_backups");
}

export function restoreBackup(path: string): Promise<void> {
  if (!isTauri()) {
    return Promise.resolve();
  }
  return invoke<void>("restore_backup", { path });
}

export function previewBackupImport(
  path: string,
): Promise<BackupImportPreview> {
  if (!isTauri()) {
    return Promise.resolve({
      path,
      name: path.split(/[\\/]/).pop() || path,
      listCount: 0,
      taskCount: 0,
      recurringRuleCount: 0,
    });
  }
  return invoke<BackupImportPreview>("preview_backup_import", { path });
}

export function importBackupSelection(
  path: string,
  selection: {
    includeLists: boolean;
    includeTasks: boolean;
    includeRecurringRules: boolean;
  },
): Promise<BackupImportResult> {
  if (!isTauri()) {
    return Promise.resolve({
      importedLists: 0,
      importedTasks: 0,
      importedRecurringRules: 0,
      skippedLists: 0,
    });
  }
  return invoke<BackupImportResult>("import_backup_selection", {
    path,
    ...selection,
  });
}

function browserStamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}
