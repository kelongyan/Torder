import { invoke, isTauri } from "@tauri-apps/api/core";

export type ExportFormat = "json" | "markdown" | "csv";

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

function browserStamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}
