import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  SyncCleanupResult,
  SyncConflict,
  SyncDevice,
  SyncRemoteInspection,
  SyncStatus,
  InitialSyncMode,
} from "../types/sync";

const browserStatus: SyncStatus = {
  state: "disabled",
  configured: false,
  hasCredential: false,
  serverUrl: null,
  remotePath: null,
  username: null,
  deviceName: null,
  pendingChanges: 0,
  conflictCount: 0,
  phase: null,
  lastSyncAt: null,
  lastError: null,
  encryptionEnabled: false,
  encryptionKeyAvailable: false,
  encryptionKeyId: null,
};

export function getSyncStatus(): Promise<SyncStatus> {
  if (!isTauri()) return Promise.resolve({ ...browserStatus });
  return invoke<SyncStatus>("get_sync_status");
}

export function listSyncConflicts(limit = 100): Promise<SyncConflict[]> {
  if (!isTauri()) return Promise.resolve([]);
  return invoke<SyncConflict[]>("list_sync_conflicts", { limit });
}

export function listSyncDevices(): Promise<SyncDevice[]> {
  if (!isTauri()) return Promise.resolve([]);
  return invoke<SyncDevice[]>("list_sync_devices");
}

export function revokeSyncDevice(deviceId: string): Promise<void> {
  if (!isTauri())
    return Promise.reject(new Error("浏览器演示模式不支持设备管理"));
  return invoke("revoke_sync_device", { deviceId });
}

export function cleanupSyncHistory(): Promise<SyncCleanupResult> {
  if (!isTauri())
    return Promise.reject(new Error("浏览器演示模式不支持历史清理"));
  return invoke<SyncCleanupResult>("cleanup_sync_history");
}

export function exportSyncDiagnostics(): Promise<string> {
  if (!isTauri())
    return Promise.reject(new Error("浏览器演示模式不支持诊断导出"));
  return invoke<string>("export_sync_diagnostics");
}

export function resolveSyncConflict(
  conflictId: string,
  resolution: "keepLocal" | "acceptRemote" | "merge" | "copy",
  mergedPayload?: Record<string, unknown>,
): Promise<void> {
  if (!isTauri())
    return Promise.reject(new Error("浏览器演示模式不支持冲突处理"));
  return invoke("resolve_sync_conflict", {
    conflictId,
    resolution,
    mergedPayload,
  });
}

export function testSyncConnection(
  serverUrl: string,
  username: string,
  remotePath: string,
  password?: string,
): Promise<SyncRemoteInspection> {
  if (!isTauri())
    return Promise.reject(new Error("浏览器演示模式不支持 WebDAV"));
  return invoke<SyncRemoteInspection>("test_sync_connection", {
    serverUrl,
    username,
    remotePath,
    password,
  });
}

export function saveSyncConfig(
  serverUrl: string,
  remotePath: string,
  username: string,
  password?: string,
  deviceName?: string,
  confirmRemote = false,
  encryptionEnabled = false,
  encryptionPassword?: string,
): Promise<SyncStatus> {
  if (!isTauri())
    return Promise.reject(new Error("浏览器演示模式不支持 WebDAV"));
  return invoke<SyncStatus>("save_sync_config", {
    serverUrl,
    remotePath,
    username,
    password,
    deviceName,
    confirmRemote,
    encryptionEnabled,
    encryptionPassword,
  });
}

export function rotateSyncEncryption(newPassword: string): Promise<void> {
  if (!isTauri())
    return Promise.reject(new Error("浏览器演示模式不支持密钥轮换"));
  return invoke("rotate_sync_encryption", { newPassword });
}

export function removeSyncConfig(): Promise<void> {
  if (!isTauri())
    return Promise.reject(new Error("浏览器演示模式不支持 WebDAV"));
  return invoke("remove_sync_config");
}

export function runSync(initialMode?: InitialSyncMode): Promise<void> {
  if (!isTauri())
    return Promise.reject(new Error("浏览器演示模式不支持 WebDAV"));
  return initialMode ? invoke("run_sync", { initialMode }) : invoke("run_sync");
}
