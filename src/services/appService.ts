import { invoke, isTauri } from "@tauri-apps/api/core";
import { getBrowserListsSnapshot } from "./listService";
import { getBrowserTasksSnapshot } from "./taskService";
import type { DatabaseStatus } from "../types/database";
import type { AppInfo } from "../types/settings";

export function getAppInfo(): Promise<AppInfo> {
  if (!isTauri()) {
    return Promise.resolve({
      name: "Torder（今序）",
      version: "0.1.0",
      platform: "browser-preview",
    });
  }
  return invoke<AppInfo>("get_app_info");
}

export function getDatabaseStatus(): Promise<DatabaseStatus> {
  if (!isTauri()) {
    return Promise.resolve({
      databasePath: "浏览器内存预览（不会写入正式数据库）",
      schemaVersion: 2,
      listCount: getBrowserListsSnapshot().length,
      taskCount: getBrowserTasksSnapshot().filter((task) => !task.deletedAt)
        .length,
    });
  }
  return invoke<DatabaseStatus>("get_database_status");
}
