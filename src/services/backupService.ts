import { invoke, isTauri } from "@tauri-apps/api/core";

export type ExportFormat = "json" | "markdown" | "csv";

export interface BackupImportPreview {
  path: string;
  name: string;
  listCount: number;
  taskCount: number;
  recurringRuleCount: number;
  /** 包内设置项数量（迁移场景下用户最关心「偏好还在不在」）。 */
  settingCount: number;
  /** 包内日历事件数量；包来自没有该表的旧版本时为 0。 */
  calendarEventCount: number;
}

export interface BackupImportResult {
  importedLists: number;
  importedTasks: number;
  importedRecurringRules: number;
  skippedLists: number;
  importedSettings: number;
  importedCalendarEvents: number;
}

/** 迁移包恢复语义：merge 保留现有数据并补齐；replace 整库替换。 */
export type ImportMode = "merge" | "replace";

let browserBackupPaths: string[] = [];

export function backupDatabase(): Promise<string> {
  if (!isTauri()) {
    const name = `torder-backup-${browserStamp()}.zip`;
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
      settingCount: 0,
      calendarEventCount: 0,
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
    return Promise.resolve(emptyImportResult());
  }
  return invoke<BackupImportResult>("import_backup_selection", {
    path,
    ...selection,
  });
}

/**
 * 导出完整迁移包到用户选定路径（`.torder`）。
 *
 * 与 `backupDatabase` 的分工：那个是应用内的自动/手动备份（落在 app data，
 * 参与份数清理，卸载即丢）；这个是用户拿在手里的迁移包，可存网盘/U 盘，
 * 用于「换机器」和「卸载重装后恢复」。
 */
export function exportBackupPackage(destination: string): Promise<string> {
  if (!isTauri()) {
    return Promise.resolve(destination);
  }
  return invoke<string>("export_backup_package", { destination });
}

/** 预览用户选定的迁移包（比内部备份预览多报设置与日历项计数）。 */
export function previewMigrationPackage(
  path: string,
): Promise<BackupImportPreview> {
  if (!isTauri()) {
    return Promise.resolve({
      path,
      name: path.split(/[\\/]/).pop() || path,
      listCount: 0,
      taskCount: 0,
      recurringRuleCount: 0,
      settingCount: 0,
      calendarEventCount: 0,
    });
  }
  return invoke<BackupImportPreview>("preview_migration_package", { path });
}

/**
 * 从迁移包恢复数据。
 *
 * `merge` 保留现有数据并补齐缺失（含设置与日历）；
 * `replace` 整库替换为包内快照（Rust 侧会先存一份后悔药快照）。
 */
export function importMigrationPackage(
  path: string,
  mode: ImportMode,
): Promise<BackupImportResult> {
  if (!isTauri()) {
    return Promise.resolve(emptyImportResult());
  }
  return invoke<BackupImportResult>("import_migration_package", { path, mode });
}

function emptyImportResult(): BackupImportResult {
  return {
    importedLists: 0,
    importedTasks: 0,
    importedRecurringRules: 0,
    skippedLists: 0,
    importedSettings: 0,
    importedCalendarEvents: 0,
  };
}

function browserStamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}
