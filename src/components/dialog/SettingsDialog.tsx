import { useCallback, useEffect, useState } from "react";
import {
  DatabaseBackup,
  Download,
  ExternalLink,
  HardDrive,
  Info,
  RefreshCw,
  Settings,
  Cloud,
} from "lucide-react";
import { DialogShell } from "./DialogShell";
import type { PresencePhase } from "../../hooks/usePresence";
import type { ToastKind } from "../../types/ui";
import {
  backupDatabase,
  exportTasks,
  listBackups,
  restoreBackup,
  type ExportFormat,
} from "../../services/backupService";
import { upsertSetting } from "../../services/settingsService";
import {
  checkForUpdate,
  getAppInfo,
  openDownloadPage,
} from "../../services/appService";
import type { AppInfo, UpdateInfo } from "../../types/settings";
import { isMobile } from "../../utils/platform";
import { isTauri } from "@tauri-apps/api/core";
import {
  getSyncStatus,
  cleanupSyncHistory,
  exportSyncDiagnostics,
  listSyncDevices,
  listSyncConflicts,
  removeSyncConfig,
  revokeSyncDevice,
  resolveSyncConflict,
  rotateSyncEncryption,
  runSync,
  saveSyncConfig,
  testSyncConnection,
} from "../../services/syncService";
import type {
  InitialSyncMode,
  SyncConflict,
  SyncDevice,
  SyncRemoteInspection,
  SyncStatus,
} from "../../types/sync";

export function SettingsDialog({
  autoBackup,
  syncAutoEnabled,
  syncWifiOnly,
  externalSyncStatus,
  presence,
  onClose,
  onAutoBackupChange,
  onSyncAutoEnabledChange,
  onSyncWifiOnlyChange,
  onSyncStatusChange,
  onToast,
}: {
  autoBackup: boolean;
  syncAutoEnabled: boolean;
  syncWifiOnly: boolean;
  externalSyncStatus: SyncStatus | null;
  presence: PresencePhase;
  onClose: () => void;
  onAutoBackupChange: (enabled: boolean) => void;
  onSyncAutoEnabledChange: (enabled: boolean) => void;
  onSyncWifiOnlyChange: (enabled: boolean) => void;
  onSyncStatusChange: (status: SyncStatus) => void;
  onToast: (message: string, type: ToastKind) => void;
}) {
  const mobile = isMobile();
  const [busy, setBusy] = useState(false);
  const [backups, setBackups] = useState<string[]>([]);
  const [pendingRestore, setPendingRestore] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncConflicts, setSyncConflicts] = useState<SyncConflict[]>([]);
  const [mergeChoices, setMergeChoices] = useState<
    Record<string, Record<string, "local" | "remote">>
  >({});
  const [syncDevices, setSyncDevices] = useState<SyncDevice[]>([]);
  const [syncServerUrl, setSyncServerUrl] = useState("");
  const [syncRemotePath, setSyncRemotePath] = useState(".torder");
  const [syncUsername, setSyncUsername] = useState("");
  const [syncDeviceName, setSyncDeviceName] = useState("");
  const [syncPassword, setSyncPassword] = useState("");
  const [syncEncryptionEnabled, setSyncEncryptionEnabled] = useState(false);
  const [syncEncryptionPassword, setSyncEncryptionPassword] = useState("");
  const [syncEncryptionPasswordConfirm, setSyncEncryptionPasswordConfirm] =
    useState("");
  const [syncSetupStep, setSyncSetupStep] = useState<1 | 2 | 3>(1);
  const [syncInitialMode, setSyncInitialMode] =
    useState<InitialSyncMode>("merge");
  const [syncInspection, setSyncInspection] =
    useState<SyncRemoteInspection | null>(null);
  const [syncInspectionKey, setSyncInspectionKey] = useState("");
  const [syncRemoteConfirmed, setSyncRemoteConfirmed] = useState(false);
  const [pendingSyncRemoval, setPendingSyncRemoval] = useState(false);
  const [pendingDeviceRevoke, setPendingDeviceRevoke] =
    useState<SyncDevice | null>(null);
  const [pendingSyncCleanup, setPendingSyncCleanup] = useState(false);
  const [pendingSyncRotation, setPendingSyncRotation] = useState(false);
  const [syncRotationPassword, setSyncRotationPassword] = useState("");
  const [syncRotationPasswordConfirm, setSyncRotationPasswordConfirm] =
    useState("");
  const [syncBusy, setSyncBusy] = useState<
    "test" | "save" | "run" | "remove" | "rotate" | null
  >(null);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [updateState, setUpdateState] = useState<
    | { state: "idle" }
    | { state: "checking" }
    | { state: "none" }
    | { state: "found"; info: UpdateInfo }
    | { state: "error"; message: string }
  >({ state: "idle" });

  const applySyncStatus = useCallback(
    (status: SyncStatus, syncForm = false) => {
      setSyncStatus(status);
      onSyncStatusChange(status);
      if (!syncForm) return;

      setSyncServerUrl(status.serverUrl ?? "");
      setSyncRemotePath(status.remotePath ?? ".torder");
      setSyncUsername(status.username ?? "");
      setSyncDeviceName(status.deviceName ?? "");
      setSyncEncryptionEnabled(status.encryptionEnabled);
      if (!status.configured) {
        setSyncPassword("");
        setSyncEncryptionPassword("");
        setSyncEncryptionPasswordConfirm("");
        setSyncInspection(null);
        setSyncInspectionKey("");
        setSyncRemoteConfirmed(false);
        setSyncSetupStep(1);
        setSyncInitialMode("merge");
      }
    },
    [onSyncStatusChange],
  );

  useEffect(() => {
    void listBackups().then(setBackups);
    void getAppInfo()
      .then(setAppInfo)
      .catch(() => setAppInfo(null));
    void getSyncStatus()
      .then((status) => {
        applySyncStatus(status, true);
        if (status.conflictCount > 0) {
          void listSyncConflicts()
            .then(setSyncConflicts)
            .catch(() => setSyncConflicts([]));
        }
        void listSyncDevices()
          .then(setSyncDevices)
          .catch(() => setSyncDevices([]));
      })
      .catch(() => setSyncStatus(null));
  }, [applySyncStatus]);

  useEffect(() => {
    if (!externalSyncStatus) return;
    const timer = window.setTimeout(() => setSyncStatus(externalSyncStatus), 0);
    return () => window.clearTimeout(timer);
  }, [externalSyncStatus]);

  async function refreshSyncStatus(syncForm = false) {
    const status = await getSyncStatus();
    applySyncStatus(status, syncForm);
    const conflicts = await listSyncConflicts().catch(() => []);
    setSyncConflicts(conflicts);
    setMergeChoices((current) => {
      const active = new Set(conflicts.map((conflict) => conflict.id));
      return Object.fromEntries(
        Object.entries(current).filter(([id]) => active.has(id)),
      );
    });
    const devices = await listSyncDevices().catch(() => []);
    setSyncDevices(devices);
    return status;
  }

  function conflictLabel(conflict: SyncConflict): string {
    try {
      const payload = JSON.parse(conflict.localPayloadJson) as {
        title?: string;
        name?: string;
      };
      return (
        payload.title ??
        payload.name ??
        `${conflict.entity} · ${conflict.objectId}`
      );
    } catch {
      return `${conflict.entity} · ${conflict.objectId}`;
    }
  }

  function conflictDiffs(
    conflict: SyncConflict,
  ): Array<[string, string, string]> {
    try {
      return conflictFieldValues(conflict)
        .slice(0, 8)
        .map(([key, local, remote]) => [
          key,
          formatConflictValue(local),
          formatConflictValue(remote),
        ]);
    } catch {
      return [];
    }
  }

  function conflictFieldValues(
    conflict: SyncConflict,
  ): Array<[string, unknown, unknown]> {
    const local = JSON.parse(conflict.localPayloadJson) as Record<
      string,
      unknown
    >;
    const remote = JSON.parse(conflict.remotePayloadJson) as Record<
      string,
      unknown
    >;
    return [...new Set([...Object.keys(local), ...Object.keys(remote)])]
      .filter(
        (key) =>
          key !== "id" &&
          JSON.stringify(local[key]) !== JSON.stringify(remote[key]),
      )
      .map((key) => [key, local[key], remote[key]]);
  }

  function mergedConflictPayload(
    conflict: SyncConflict,
  ): Record<string, unknown> | undefined {
    try {
      const local = JSON.parse(conflict.localPayloadJson) as Record<
        string,
        unknown
      >;
      const merged = { ...local };
      for (const [field, , remoteValue] of conflictFieldValues(conflict)) {
        if (mergeChoices[conflict.id]?.[field] !== "local") {
          merged[field] = remoteValue;
        }
      }
      return merged;
    } catch {
      return undefined;
    }
  }

  function formatConflictValue(value: unknown): string {
    if (value === undefined) return "（未设置）";
    if (value === null) return "（空）";
    if (typeof value === "string") return value;
    return JSON.stringify(value);
  }

  function conflictFieldLabel(field: string): string {
    const labels: Record<string, string> = {
      title: "标题",
      name: "名称",
      note: "备注",
      status: "状态",
      priority: "优先级",
      listId: "清单",
      dueAt: "截止时间",
      completedAt: "完成时间",
      remindBefore: "提前提醒",
      repeatRule: "重复规则",
      frequency: "频率",
      intervalCount: "间隔",
      weekdays: "星期",
      monthDay: "日期",
      nextDueAt: "下次生成",
      enabled: "启用状态",
      eventType: "事件类型",
      startDate: "开始日期",
      endDate: "结束日期",
      deletedAt: "删除状态",
    };
    return labels[field] ?? field;
  }

  function updateMergeChoice(
    conflictId: string,
    field: string,
    choice: "local" | "remote",
  ) {
    setMergeChoices((current) => ({
      ...current,
      [conflictId]: { ...current[conflictId], [field]: choice },
    }));
  }

  async function handleResolveConflict(
    conflict: SyncConflict,
    resolution: "keepLocal" | "acceptRemote" | "merge" | "copy",
  ) {
    setSyncBusy("run");
    try {
      await resolveSyncConflict(
        conflict.id,
        resolution,
        resolution === "merge" ? mergedConflictPayload(conflict) : undefined,
      );
      await refreshSyncStatus();
      const message =
        resolution === "keepLocal"
          ? "已保留本地版本"
          : resolution === "acceptRemote"
            ? "已接受远端版本"
            : resolution === "merge"
              ? "已合并保存冲突版本"
              : "已复制为新副本";
      onToast(message, "success");
    } catch (error) {
      onToast(`处理冲突失败: ${String(error)}`, "error");
    } finally {
      setSyncBusy(null);
    }
  }

  function validateSyncForm(): boolean {
    if (!syncServerUrl.trim() || !syncRemotePath.trim()) {
      onToast("请填写 WebDAV 地址和远端目录", "error");
      return false;
    }
    if (!syncServerUrl.trim().startsWith("https://")) {
      onToast("WebDAV 地址必须使用 HTTPS", "error");
      return false;
    }
    return true;
  }

  function validateSyncEncryptionForm(): boolean {
    const enabled =
      syncEncryptionEnabled || syncInspection?.encryptionEnabled === true;
    if (!enabled) return true;
    const password = syncEncryptionPassword;
    const confirmation = syncEncryptionPasswordConfirm;
    const keyAvailable = syncStatus?.encryptionKeyAvailable === true;
    if (!keyAvailable && !password) {
      onToast("请输入同步加密密码", "error");
      return false;
    }
    if (password && password.length < 8) {
      onToast("同步加密密码至少需要 8 个字符", "error");
      return false;
    }
    if (password && password !== confirmation) {
      onToast("两次输入的同步加密密码不一致", "error");
      return false;
    }
    if (!password && confirmation) {
      onToast("请输入同步加密密码后再确认", "error");
      return false;
    }
    return true;
  }

  function handleSyncServerNext() {
    if (!syncServerUrl.trim() || !syncRemotePath.trim()) {
      onToast("请填写 WebDAV 地址和远端目录", "error");
      return;
    }
    if (!syncServerUrl.trim().startsWith("https://")) {
      onToast("WebDAV 地址必须使用 HTTPS", "error");
      return;
    }
    if (!syncDeviceName.trim()) {
      onToast("请填写当前设备名称", "error");
      return;
    }
    setSyncSetupStep(2);
  }

  async function handleTestSync() {
    if (!validateSyncForm()) return;
    setSyncBusy("test");
    try {
      const inspection = await testSyncConnection(
        syncServerUrl.trim(),
        syncUsername.trim(),
        syncRemotePath.trim(),
        syncPassword || undefined,
      );
      setSyncInspection(inspection);
      setSyncInspectionKey(currentSyncFormKey());
      setSyncRemoteConfirmed(false);
      if (inspection.encryptionEnabled) {
        setSyncEncryptionEnabled(true);
      }
      setSyncInitialMode(inspection.initialized ? "merge" : "upload");
      if (!syncStatus?.configured) setSyncSetupStep(3);
      onToast("WebDAV 连接与目录检查通过", "success");
    } catch (error) {
      onToast(`连接测试失败: ${String(error)}`, "error");
    } finally {
      setSyncBusy(null);
    }
  }

  async function handleSaveSync() {
    if (!validateSyncForm()) return;
    if (!validateSyncEncryptionForm()) return;
    const formChanged = syncInspectionKey !== currentSyncFormKey();
    if (formChanged || !syncInspection) {
      onToast("请先测试当前 WebDAV 地址和远端目录", "error");
      return;
    }
    if (syncInspection?.requiresConfirmation && !syncRemoteConfirmed) {
      onToast("请确认远端目录后再保存", "error");
      return;
    }
    setSyncBusy("save");
    const firstSetup = !syncStatus?.configured;
    const encryptionEnabled =
      syncEncryptionEnabled || syncInspection?.encryptionEnabled === true;
    try {
      const status = await saveSyncConfig(
        syncServerUrl.trim(),
        syncRemotePath.trim(),
        syncUsername.trim(),
        syncPassword || undefined,
        syncDeviceName.trim(),
        syncRemoteConfirmed,
        encryptionEnabled,
        syncEncryptionPassword || undefined,
      );
      setSyncPassword("");
      setSyncEncryptionPassword("");
      setSyncEncryptionPasswordConfirm("");
      setSyncEncryptionEnabled(status.encryptionEnabled);
      applySyncStatus(status);
    } catch (error) {
      onToast(`保存同步配置失败: ${String(error)}`, "error");
      setSyncBusy(null);
      return;
    }

    if (firstSetup) {
      setSyncBusy("run");
      try {
        await runSync(syncInitialMode);
        const synced = await refreshSyncStatus();
        const action =
          syncInitialMode === "upload"
            ? "本机数据已上传"
            : syncInitialMode === "download"
              ? "远端数据已下载"
              : "两端数据已合并";
        onToast(
          synced.conflictCount > 0
            ? `${action}，有 ${synced.conflictCount} 项冲突待处理`
            : `${action}，首次同步完成`,
          synced.conflictCount > 0 ? "info" : "success",
        );
      } catch (error) {
        await refreshSyncStatus().catch(() => undefined);
        onToast(`配置已保存，但首次同步失败: ${String(error)}`, "error");
      }
    } else {
      onToast("同步配置已安全保存", "success");
    }
    setSyncBusy(null);
  }

  function currentSyncFormKey(): string {
    return [
      syncServerUrl.trim(),
      syncRemotePath.trim(),
      syncUsername.trim(),
    ].join("|");
  }

  function invalidateSyncInspection() {
    setSyncInspection(null);
    setSyncInspectionKey("");
    setSyncRemoteConfirmed(false);
  }

  async function handleRunSync() {
    setSyncBusy("run");
    try {
      await runSync();
      const status = await refreshSyncStatus();
      onToast(
        status.conflictCount > 0 ? "同步完成，存在待处理冲突" : "同步完成",
        status.conflictCount > 0 ? "info" : "success",
      );
    } catch (error) {
      await refreshSyncStatus().catch(() => undefined);
      onToast(`同步失败: ${String(error)}`, "error");
    } finally {
      setSyncBusy(null);
    }
  }

  async function handleRemoveSync() {
    setSyncBusy("remove");
    try {
      await removeSyncConfig();
      setPendingSyncRemoval(false);
      setSyncPassword("");
      setSyncEncryptionPassword("");
      setSyncEncryptionPasswordConfirm("");
      setSyncEncryptionEnabled(false);
      await refreshSyncStatus(true);
      onToast("已移除同步配置和本机凭据", "info");
    } catch (error) {
      onToast(`移除同步配置失败: ${String(error)}`, "error");
    } finally {
      setSyncBusy(null);
    }
  }

  async function handleCheckUpdate() {
    setUpdateState({ state: "checking" });
    try {
      const info = await checkForUpdate();
      setUpdateState(
        info.hasUpdate ? { state: "found", info } : { state: "none" },
      );
      onToast(
        info.hasUpdate
          ? `发现新版本 v${info.latestVersion}`
          : "当前已是最新版本",
        info.hasUpdate ? "info" : "success",
      );
    } catch (error) {
      setUpdateState({ state: "error", message: String(error) });
      onToast(`检查更新失败: ${String(error)}`, "error");
    }
  }

  async function handleOpenDownload(info: UpdateInfo) {
    try {
      await openDownloadPage(info.downloadUrl);
    } catch (error) {
      onToast(`打开下载页失败: ${String(error)}`, "error");
    }
  }

  async function handleBackup() {
    setBusy(true);
    try {
      await backupDatabase();
      const backups = await listBackups();
      setBackups(backups);
      onToast("数据库备份完成", "success");
    } catch (error) {
      onToast(`备份失败: ${String(error)}`, "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleExport(format: ExportFormat) {
    setBusy(true);
    try {
      await exportTasks(format);
      onToast(
        format === "json"
          ? "已导出 JSON"
          : format === "markdown"
            ? "已导出 Markdown"
            : "已导出 CSV",
        "success",
      );
    } catch (error) {
      onToast(`导出失败: ${String(error)}`, "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleAutoBackupChange(enabled: boolean) {
    try {
      await upsertSetting("autoBackup", enabled);
      onAutoBackupChange(enabled);
      onToast(enabled ? "已开启启动自动备份" : "已关闭自动备份", "info");
    } catch (error) {
      onToast(`设置保存失败: ${String(error)}`, "error");
    }
  }

  async function handleSyncAutoEnabledChange(enabled: boolean) {
    try {
      await upsertSetting("syncAutoEnabled", enabled);
      onSyncAutoEnabledChange(enabled);
      onToast(enabled ? "已开启自动同步" : "已暂停自动同步", "info");
    } catch (error) {
      onToast(`设置保存失败: ${String(error)}`, "error");
    }
  }

  async function handleSyncWifiOnlyChange(enabled: boolean) {
    try {
      await upsertSetting("syncWifiOnly", enabled);
      onSyncWifiOnlyChange(enabled);
      onToast(
        enabled ? "仅 Wi-Fi 时自动同步" : "已允许蜂窝网络自动同步",
        "info",
      );
    } catch (error) {
      onToast(`设置保存失败: ${String(error)}`, "error");
    }
  }

  async function handleRevokeDevice() {
    if (!pendingDeviceRevoke) return;
    setSyncBusy("run");
    try {
      await revokeSyncDevice(pendingDeviceRevoke.id);
      setPendingDeviceRevoke(null);
      await refreshSyncStatus();
      onToast("已撤销设备，下次同步将拒绝该设备", "info");
    } catch (error) {
      onToast(`撤销设备失败: ${String(error)}`, "error");
    } finally {
      setSyncBusy(null);
    }
  }

  async function handleCleanupHistory() {
    setSyncBusy("run");
    try {
      const result = await cleanupSyncHistory();
      setPendingSyncCleanup(false);
      await refreshSyncStatus();
      onToast(
        `已清理 ${result.changesRemoved} 条历史变更和 ${result.tombstonesRemoved} 个墓碑`,
        "info",
      );
    } catch (error) {
      onToast(`清理同步历史失败: ${String(error)}`, "error");
    } finally {
      setSyncBusy(null);
    }
  }

  async function handleRotateSyncEncryption() {
    if (!syncStatus?.configured) return;
    if (syncStatus.pendingChanges > 0) {
      onToast("请先完成待上传变更，再轮换同步密钥", "error");
      return;
    }
    if (syncRotationPassword.length < 8) {
      onToast("新同步加密密码至少需要 8 个字符", "error");
      return;
    }
    if (syncRotationPassword !== syncRotationPasswordConfirm) {
      onToast("两次输入的新同步加密密码不一致", "error");
      return;
    }
    setSyncBusy("rotate");
    try {
      await rotateSyncEncryption(syncRotationPassword);
      setPendingSyncRotation(false);
      setSyncRotationPassword("");
      setSyncRotationPasswordConfirm("");
      await refreshSyncStatus();
      onToast("同步加密密钥已轮换", "success");
    } catch (error) {
      onToast("轮换同步加密密钥失败: " + String(error), "error");
    } finally {
      setSyncBusy(null);
    }
  }

  async function handleExportSyncDiagnostics() {
    setSyncBusy("run");
    try {
      const path = await exportSyncDiagnostics();
      onToast(`已导出脱敏诊断：${path}`, "success");
    } catch (error) {
      onToast(`导出诊断失败: ${String(error)}`, "error");
    } finally {
      setSyncBusy(null);
    }
  }

  function formatDeviceTime(value: string | null): string {
    if (!value) return "尚未同步";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN");
  }

  function syncPhaseLabel(phase: SyncStatus["phase"]): string {
    return phase === "download"
      ? "下载远端变更"
      : phase === "merge"
        ? "合并本地数据"
        : phase === "upload"
          ? "上传本地变更"
          : "准备同步";
  }

  async function handleRestore(path: string) {
    setBusy(true);
    try {
      await restoreBackup(path);
      onClose();
      // 重载让所有查询重新命中新库；此后组件已卸载，不再提示。
      window.location.reload();
    } catch (error) {
      setPendingRestore(null);
      onToast(`恢复失败: ${String(error)}`, "error");
    } finally {
      setBusy(false);
    }
  }

  function shortName(path: string): string {
    const parts = path.split(/[\\/]/);
    return parts[parts.length - 1] ?? path;
  }

  return (
    <DialogShell
      title="设置"
      subtitle={mobile ? "同步 · 关于与更新" : "备份 · 导出 · 更新"}
      icon={Settings}
      width="520px"
      presence={presence}
      overlayClassName="settings-dialog"
      onClose={onClose}
    >
      <div className="dialog-form">
        {!mobile && (
          <section className="settings-section">
            <h3 className="settings-section-title">
              <DatabaseBackup aria-hidden="true" className="icon-sm" />
              数据库备份
            </h3>
            <p className="settings-section-hint">
              生成完整数据快照，保存在应用数据目录的 backups 文件夹。
            </p>
            <div className="settings-row">
              <button
                type="button"
                className="btn-secondary"
                disabled={busy}
                onClick={() => void handleBackup()}
              >
                <HardDrive aria-hidden="true" className="icon-sm" />
                立即备份
              </button>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={autoBackup}
                  onChange={(event) =>
                    void handleAutoBackupChange(event.target.checked)
                  }
                />
                <span>启动时自动备份</span>
              </label>
            </div>
            {backups.length > 0 && (
              <div className="settings-backup-list">
                <div className="settings-list-label">已有备份</div>
                {backups.map((path) => (
                  <div key={path} className="settings-backup-item">
                    <span title={path}>{shortName(path)}</span>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      disabled={busy}
                      onClick={() => setPendingRestore(path)}
                    >
                      <RefreshCw aria-hidden="true" className="icon-xs" />
                      恢复
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        <section className="settings-section">
          <h3 className="settings-section-title">
            <Cloud aria-hidden="true" className="icon-sm" />
            跨设备同步
          </h3>
          <p className="settings-section-hint">
            {syncStatus?.configured
              ? `待上传 ${syncStatus.pendingChanges} 项，冲突 ${syncStatus.conflictCount} 项。`
              : "通过 WebDAV 合并多台设备的数据，不会上传本地 SQLite 文件。"}
          </p>
          {syncStatus?.state === "syncing" && (
            <div className="sync-progress" aria-label="同步阶段">
              <strong>{syncPhaseLabel(syncStatus.phase)}</strong>
              <div className="sync-progress-steps">
                {["download", "merge", "upload"].map((phase) => (
                  <span
                    key={phase}
                    className={syncStatus.phase === phase ? "is-current" : ""}
                  >
                    {phase === "download"
                      ? "下载"
                      : phase === "merge"
                        ? "合并"
                        : "上传"}
                  </span>
                ))}
              </div>
            </div>
          )}
          {!isTauri() ? (
            <p className="settings-section-hint">
              浏览器演示模式不支持 WebDAV 同步。
            </p>
          ) : (
            <div className="sync-config-grid">
              {!syncStatus?.configured && (
                <div
                  className="sync-setup-steps form-grid-full"
                  aria-label="同步设置进度"
                >
                  {["服务器", "认证", "范围与确认"].map((label, index) => (
                    <span
                      key={label}
                      className={
                        syncSetupStep === index + 1 ? "is-current" : ""
                      }
                    >
                      {index + 1}. {label}
                    </span>
                  ))}
                </div>
              )}
              {(syncStatus?.configured || syncSetupStep === 1) && (
                <>
                  <label className="form-field form-grid-full">
                    <span>WebDAV 地址</span>
                    <input
                      type="url"
                      inputMode="url"
                      autoComplete="url"
                      placeholder="https://dav.example.com/remote.php/dav/files/user/"
                      value={syncServerUrl}
                      onChange={(event) => {
                        setSyncServerUrl(event.target.value);
                        invalidateSyncInspection();
                      }}
                    />
                  </label>
                  <label className="form-field">
                    <span>远端目录</span>
                    <input
                      type="text"
                      placeholder=".torder"
                      value={syncRemotePath}
                      onChange={(event) => {
                        setSyncRemotePath(event.target.value);
                        invalidateSyncInspection();
                      }}
                    />
                  </label>
                  <label className="form-field">
                    <span>当前设备名称</span>
                    <input
                      type="text"
                      maxLength={128}
                      placeholder={mobile ? "我的手机" : "我的电脑"}
                      value={syncDeviceName}
                      onChange={(event) =>
                        setSyncDeviceName(event.target.value)
                      }
                    />
                  </label>
                </>
              )}
              {(syncStatus?.configured ||
                syncSetupStep === 2 ||
                syncSetupStep === 3) && (
                <>
                  {(syncStatus?.configured || syncSetupStep === 2) && (
                    <>
                      <label className="form-field form-grid-full">
                        <span>用户名</span>
                        <input
                          type="text"
                          autoComplete="username"
                          value={syncUsername}
                          onChange={(event) => {
                            setSyncUsername(event.target.value);
                            invalidateSyncInspection();
                          }}
                        />
                      </label>
                      <label className="form-field form-grid-full">
                        <span>
                          {syncStatus?.hasCredential
                            ? "更新应用专用密码（可选）"
                            : "应用专用密码"}
                        </span>
                        <input
                          type="password"
                          autoComplete="current-password"
                          value={syncPassword}
                          onChange={(event) =>
                            setSyncPassword(event.target.value)
                          }
                        />
                      </label>
                    </>
                  )}
                  <label className="settings-toggle form-grid-full">
                    <input
                      type="checkbox"
                      checked={
                        syncEncryptionEnabled ||
                        syncInspection?.encryptionEnabled === true
                      }
                      disabled={
                        syncStatus?.configured === true ||
                        syncInspection?.encryptionEnabled === true
                      }
                      onChange={(event) =>
                        setSyncEncryptionEnabled(event.target.checked)
                      }
                    />
                    <span>端到端加密</span>
                  </label>
                  {(syncEncryptionEnabled ||
                    syncInspection?.encryptionEnabled === true) && (
                    <>
                      <label className="form-field form-grid-full">
                        <span>
                          {syncStatus?.encryptionKeyAvailable
                            ? "更新同步加密密码（可选）"
                            : "同步加密密码"}
                        </span>
                        <input
                          type="password"
                          autoComplete="new-password"
                          minLength={8}
                          value={syncEncryptionPassword}
                          onChange={(event) =>
                            setSyncEncryptionPassword(event.target.value)
                          }
                        />
                      </label>
                      <label className="form-field form-grid-full">
                        <span>确认同步加密密码</span>
                        <input
                          type="password"
                          autoComplete="new-password"
                          minLength={8}
                          value={syncEncryptionPasswordConfirm}
                          onChange={(event) =>
                            setSyncEncryptionPasswordConfirm(event.target.value)
                          }
                        />
                      </label>
                      <p className="settings-section-hint form-grid-full">
                        加密只保护远端变更和快照内容，密码不会上传或写入本地数据库。
                      </p>
                    </>
                  )}
                </>
              )}
              {syncInspection &&
                (syncStatus?.configured || syncSetupStep === 3) && (
                  <div className="sync-inspection form-grid-full" role="status">
                    <strong>
                      {syncInspection.initialized
                        ? "已发现 Torder 同步集合"
                        : "将初始化新的同步集合"}
                    </strong>
                    {syncInspection.unknownEntries.length > 0 && (
                      <span>
                        未知项目：{syncInspection.unknownEntries.join("、")}
                      </span>
                    )}
                    {syncInspection.requiresConfirmation && (
                      <label className="settings-toggle">
                        <input
                          type="checkbox"
                          checked={syncRemoteConfirmed}
                          onChange={(event) =>
                            setSyncRemoteConfirmed(event.target.checked)
                          }
                        />
                        <span>我确认使用此服务器和远端目录</span>
                      </label>
                    )}
                  </div>
                )}
              {!syncStatus?.configured &&
                syncSetupStep === 3 &&
                syncInspection && (
                  <fieldset className="sync-initial-mode-list form-grid-full">
                    <legend>首次同步范围</legend>
                    <label className="sync-initial-mode">
                      <input
                        type="radio"
                        name="sync-initial-mode"
                        value="merge"
                        checked={syncInitialMode === "merge"}
                        onChange={() => setSyncInitialMode("merge")}
                      />
                      <span>
                        <strong>安全合并</strong>
                        <small>先拉取远端数据，再上传本机变更。</small>
                      </span>
                    </label>
                    <label
                      className={`sync-initial-mode ${syncInspection.initialized ? "is-disabled" : ""}`}
                    >
                      <input
                        type="radio"
                        name="sync-initial-mode"
                        value="upload"
                        checked={syncInitialMode === "upload"}
                        disabled={syncInspection.initialized}
                        onChange={() => setSyncInitialMode("upload")}
                      />
                      <span>
                        <strong>上传本机</strong>
                        <small>
                          {syncInspection.initialized
                            ? "远端已有同步集合，需使用安全合并。"
                            : "远端未初始化，将以本机数据建立同步集合。"}
                        </small>
                      </span>
                    </label>
                    <label
                      className={`sync-initial-mode ${(syncStatus?.pendingChanges ?? 0) > 0 ? "is-disabled" : ""}`}
                    >
                      <input
                        type="radio"
                        name="sync-initial-mode"
                        value="download"
                        checked={syncInitialMode === "download"}
                        disabled={(syncStatus?.pendingChanges ?? 0) > 0}
                        onChange={() => setSyncInitialMode("download")}
                      />
                      <span>
                        <strong>下载远端</strong>
                        <small>
                          {(syncStatus?.pendingChanges ?? 0) > 0
                            ? `本机有 ${syncStatus?.pendingChanges ?? 0} 项待上传变更，需使用安全合并。`
                            : "本机无待上传变更，将同步远端数据。"}
                        </small>
                      </span>
                    </label>
                  </fieldset>
                )}
              <div className="settings-row sync-actions form-grid-full">
                {syncStatus?.configured ? (
                  <>
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={syncBusy !== null}
                      onClick={() => void handleTestSync()}
                    >
                      <Cloud aria-hidden="true" className="icon-sm" />
                      {syncBusy === "test" ? "测试中…" : "测试连接"}
                    </button>
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={syncBusy !== null}
                      onClick={() => void handleSaveSync()}
                    >
                      {syncBusy === "save" ? "保存中…" : "保存配置"}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={syncBusy !== null}
                      onClick={() => void handleRunSync()}
                    >
                      <RefreshCw
                        aria-hidden="true"
                        className={`icon-sm ${syncBusy === "run" ? "is-spinning" : ""}`}
                      />
                      {syncBusy === "run" ? "同步中…" : "立即同步"}
                    </button>
                    <button
                      type="button"
                      className="btn-danger-solid"
                      disabled={syncBusy !== null}
                      onClick={() => setPendingSyncRemoval(true)}
                    >
                      {syncBusy === "remove" ? "移除中…" : "移除配置"}
                    </button>
                  </>
                ) : syncSetupStep === 1 ? (
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={syncBusy !== null}
                    onClick={handleSyncServerNext}
                  >
                    下一步
                  </button>
                ) : syncSetupStep === 2 ? (
                  <>
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={syncBusy !== null}
                      onClick={() => setSyncSetupStep(1)}
                    >
                      返回
                    </button>
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={syncBusy !== null}
                      onClick={() => void handleTestSync()}
                    >
                      <Cloud aria-hidden="true" className="icon-sm" />
                      {syncBusy === "test" ? "测试中…" : "测试连接"}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={syncBusy !== null}
                      onClick={() => setSyncSetupStep(2)}
                    >
                      返回
                    </button>
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={syncBusy !== null || !syncInspection}
                      onClick={() => void handleSaveSync()}
                    >
                      {syncBusy === "save"
                        ? "保存中…"
                        : syncBusy === "run"
                          ? "首次同步中…"
                          : "保存并同步"}
                    </button>
                  </>
                )}
              </div>
              {syncStatus?.configured && (
                <label className="settings-toggle form-grid-full">
                  <input
                    type="checkbox"
                    checked={syncAutoEnabled}
                    onChange={(event) =>
                      void handleSyncAutoEnabledChange(event.target.checked)
                    }
                  />
                  <span>自动同步</span>
                </label>
              )}
              {syncStatus?.configured && mobile && (
                <label className="settings-toggle form-grid-full">
                  <input
                    type="checkbox"
                    checked={syncWifiOnly}
                    onChange={(event) =>
                      void handleSyncWifiOnlyChange(event.target.checked)
                    }
                  />
                  <span>仅 Wi-Fi 自动同步</span>
                </label>
              )}
              {syncDevices.length > 0 && (
                <div className="sync-device-list form-grid-full">
                  <div className="settings-list-label">已连接设备</div>
                  {syncDevices.map((device) => (
                    <div key={device.id} className="sync-device-item">
                      <div className="sync-device-copy">
                        <strong>{device.name}</strong>
                        <span>
                          {device.current
                            ? "当前设备"
                            : device.enabled
                              ? "可同步"
                              : "已撤销"}{" "}
                          · {formatDeviceTime(device.lastSyncAt)}
                        </span>
                      </div>
                      {device.enabled && !device.current && (
                        <button
                          type="button"
                          className="btn-secondary btn-sm"
                          disabled={syncBusy !== null}
                          onClick={() => setPendingDeviceRevoke(device)}
                        >
                          撤销
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {syncStatus?.configured && (
                <button
                  type="button"
                  className="btn-secondary btn-sm form-grid-full"
                  disabled={syncBusy !== null}
                  onClick={() => setPendingSyncCleanup(true)}
                >
                  清理已确认的历史
                </button>
              )}
              {syncStatus?.configured && (
                <div className="sync-device-item form-grid-full">
                  <div className="sync-device-copy">
                    <strong>
                      {syncStatus.encryptionEnabled
                        ? "同步加密密钥"
                        : "启用端到端加密"}
                    </strong>
                    <span>
                      {syncStatus.encryptionEnabled
                        ? syncStatus.encryptionKeyAvailable
                          ? "当前密钥 " + (syncStatus.encryptionKeyId ?? "可用")
                          : "本机缺少当前密钥，需要输入密码重新加入"
                        : "远端仍是明文集合，使用新密码创建加密快照"}
                      {syncStatus.pendingChanges > 0
                        ? " · 还有 " + syncStatus.pendingChanges + " 项待上传"
                        : ""}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    disabled={
                      syncBusy !== null ||
                      syncStatus.pendingChanges > 0 ||
                      (syncStatus.encryptionEnabled &&
                        !syncStatus.encryptionKeyAvailable)
                    }
                    onClick={() => setPendingSyncRotation(true)}
                  >
                    {syncStatus.encryptionEnabled ? "轮换密钥" : "启用加密"}
                  </button>
                </div>
              )}
              <button
                type="button"
                className="btn-secondary btn-sm form-grid-full"
                disabled={syncBusy !== null}
                onClick={() => void handleExportSyncDiagnostics()}
              >
                导出脱敏诊断
              </button>
            </div>
          )}
          {syncStatus?.lastError && (
            <p className="settings-section-hint">
              上次同步失败：{syncStatus.lastError}
            </p>
          )}
          {syncConflicts.length > 0 && (
            <div className="sync-conflict-list">
              <div className="settings-list-label">待处理冲突</div>
              {syncConflicts.map((conflict) => (
                <div key={conflict.id} className="sync-conflict-item">
                  <div className="sync-conflict-copy">
                    <strong>{conflictLabel(conflict)}</strong>
                    <span>
                      本地 v{conflict.localRevision} · 远端 v
                      {conflict.remoteRevision}
                    </span>
                  </div>
                  {conflictDiffs(conflict).length > 0 && (
                    <div
                      className="sync-conflict-diff"
                      aria-label="冲突字段差异"
                    >
                      <div
                        className="sync-conflict-diff-head"
                        aria-hidden="true"
                      >
                        <span>字段</span>
                        <span>本地版本</span>
                        <span>远端版本</span>
                      </div>
                      {conflictDiffs(conflict).map(([field, local, remote]) => (
                        <div key={field} className="sync-conflict-diff-row">
                          <span title={field}>{conflictFieldLabel(field)}</span>
                          <button
                            type="button"
                            className={`sync-conflict-value ${
                              mergeChoices[conflict.id]?.[field] === "local"
                                ? "is-selected"
                                : ""
                            }`}
                            aria-label={`${conflictFieldLabel(field)}使用本地值：${local}`}
                            aria-pressed={
                              mergeChoices[conflict.id]?.[field] === "local"
                            }
                            disabled={syncBusy !== null}
                            onClick={() =>
                              updateMergeChoice(conflict.id, field, "local")
                            }
                          >
                            <code>{local}</code>
                          </button>
                          <button
                            type="button"
                            className={`sync-conflict-value ${
                              mergeChoices[conflict.id]?.[field] !== "local"
                                ? "is-selected"
                                : ""
                            }`}
                            aria-label={`${conflictFieldLabel(field)}使用远端值：${remote}`}
                            aria-pressed={
                              mergeChoices[conflict.id]?.[field] !== "local"
                            }
                            disabled={syncBusy !== null}
                            onClick={() =>
                              updateMergeChoice(conflict.id, field, "remote")
                            }
                          >
                            <code>{remote}</code>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="sync-conflict-actions">
                    {conflict.id.startsWith("list-name-conflict:") ? (
                      <span className="settings-section-hint">
                        两台设备的清单名称相同但 ID
                        不同，请先重命名本地清单，再点击“立即同步”。
                      </span>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="btn-secondary btn-sm"
                          disabled={syncBusy !== null}
                          onClick={() =>
                            void handleResolveConflict(conflict, "keepLocal")
                          }
                        >
                          保留本地
                        </button>
                        <button
                          type="button"
                          className="btn-secondary btn-sm"
                          disabled={syncBusy !== null}
                          onClick={() =>
                            void handleResolveConflict(conflict, "acceptRemote")
                          }
                        >
                          接受远端
                        </button>
                        <button
                          type="button"
                          className="btn-secondary btn-sm"
                          disabled={syncBusy !== null}
                          onClick={() =>
                            void handleResolveConflict(conflict, "merge")
                          }
                        >
                          合并保存
                        </button>
                        {(conflict.entity === "task" ||
                          conflict.entity === "calendarEvent") && (
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            disabled={syncBusy !== null}
                            onClick={() =>
                              void handleResolveConflict(conflict, "copy")
                            }
                          >
                            复制副本
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {!mobile && (
          <section className="settings-section">
            <h3 className="settings-section-title">
              <Download aria-hidden="true" className="icon-sm" />
              导出数据
            </h3>
            <p className="settings-section-hint">
              将任务数据导出为可读文件，方便迁移备份。
            </p>
            <div className="settings-row">
              <button
                type="button"
                className="btn-secondary settings-export-btn"
                disabled={busy}
                onClick={() => void handleExport("json")}
              >
                <Download aria-hidden="true" className="icon-sm" />
                导出 JSON
              </button>
              <button
                type="button"
                className="btn-secondary settings-export-btn"
                disabled={busy}
                onClick={() => void handleExport("markdown")}
              >
                <Download aria-hidden="true" className="icon-sm" />
                导出 Markdown
              </button>
              <button
                type="button"
                className="btn-secondary settings-export-btn"
                disabled={busy}
                onClick={() => void handleExport("csv")}
              >
                <Download aria-hidden="true" className="icon-sm" />
                导出 CSV
              </button>
            </div>
          </section>
        )}

        <section className="settings-section">
          <h3 className="settings-section-title">
            <Info aria-hidden="true" className="icon-sm" />
            关于与更新
          </h3>
          <p className="settings-section-hint">
            本地优先的桌面待办应用，数据仅保存在本机。
          </p>
          <div className="settings-row">
            <span className="settings-version">
              {appInfo ? `当前版本 v${appInfo.version}` : ""}
            </span>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy || updateState.state === "checking"}
              onClick={() => void handleCheckUpdate()}
            >
              <RefreshCw
                aria-hidden="true"
                className={`icon-sm ${
                  updateState.state === "checking" ? "is-spinning" : ""
                }`}
              />
              {updateState.state === "checking" ? "检查中…" : "检查更新"}
            </button>
          </div>
          {updateState.state === "none" && (
            <p className="settings-section-hint">当前已是最新版本。</p>
          )}
          {updateState.state === "found" && (
            <div className="settings-update-card">
              <div className="settings-list-label">
                发现新版本 v{updateState.info.latestVersion}
              </div>
              {updateState.info.notes && (
                <p className="settings-update-notes">
                  {updateState.info.notes}
                </p>
              )}
              <button
                type="button"
                className="btn-primary btn-sm"
                onClick={() => void handleOpenDownload(updateState.info)}
              >
                <ExternalLink aria-hidden="true" className="icon-xs" />
                打开下载页
              </button>
            </div>
          )}
          {updateState.state === "error" && (
            <p className="settings-section-hint">
              检查更新失败,请稍后重试（{updateState.message}）。
            </p>
          )}
        </section>
      </div>

      <footer className="dialog-footer">
        <button type="button" className="btn-secondary" onClick={onClose}>
          完成
        </button>
      </footer>

      {pendingRestore && (
        <div className="dialog-overlay restore-confirm-overlay">
          <div
            className="restore-confirm-card"
            role="alertdialog"
            aria-modal="true"
          >
            <h3>确认恢复备份?</h3>
            <p>
              将用 <strong>{shortName(pendingRestore)}</strong>{" "}
              覆盖当前全部任务数据,此操作不可撤销。
            </p>
            <div className="settings-row">
              <button
                type="button"
                className="btn-secondary"
                disabled={busy}
                onClick={() => setPendingRestore(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="btn-danger-solid"
                disabled={busy}
                onClick={() => void handleRestore(pendingRestore)}
              >
                确认恢复
              </button>
            </div>
          </div>
        </div>
      )}
      {pendingSyncRemoval && (
        <div className="dialog-overlay restore-confirm-overlay">
          <div
            className="restore-confirm-card"
            role="alertdialog"
            aria-modal="true"
          >
            <h3>确认移除同步配置?</h3>
            <p>
              将删除本机 WebDAV 凭据、服务器配置和同步游标，不会删除远端数据。
            </p>
            <div className="settings-row">
              <button
                type="button"
                className="btn-secondary"
                disabled={syncBusy !== null}
                onClick={() => setPendingSyncRemoval(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="btn-danger-solid"
                disabled={syncBusy !== null}
                onClick={() => void handleRemoveSync()}
              >
                确认移除
              </button>
            </div>
          </div>
        </div>
      )}
      {pendingDeviceRevoke && (
        <div className="dialog-overlay restore-confirm-overlay">
          <div
            className="restore-confirm-card"
            role="alertdialog"
            aria-modal="true"
          >
            <h3>确认撤销设备?</h3>
            <p>
              撤销 <strong>{pendingDeviceRevoke.name}</strong>{" "}
              后，该设备将不能继续参与同步。
            </p>
            <div className="settings-row">
              <button
                type="button"
                className="btn-secondary"
                disabled={syncBusy !== null}
                onClick={() => setPendingDeviceRevoke(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="btn-danger-solid"
                disabled={syncBusy !== null}
                onClick={() => void handleRevokeDevice()}
              >
                确认撤销
              </button>
            </div>
          </div>
        </div>
      )}
      {pendingSyncRotation && (
        <div className="dialog-overlay restore-confirm-overlay">
          <div
            className="restore-confirm-card"
            role="alertdialog"
            aria-modal="true"
          >
            <h3>
              {syncStatus?.encryptionEnabled
                ? "轮换同步加密密钥?"
                : "为同步集合启用端到端加密?"}
            </h3>
            <p>
              将创建新的加密密钥并上传新的加密快照。其他设备需要使用新密码重新同步，
              旧密钥会保留到历史清理完成。
            </p>
            <label className="form-field">
              <span>新同步加密密码</span>
              <input
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={syncRotationPassword}
                onChange={(event) =>
                  setSyncRotationPassword(event.target.value)
                }
              />
            </label>
            <label className="form-field">
              <span>确认新同步加密密码</span>
              <input
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={syncRotationPasswordConfirm}
                onChange={(event) =>
                  setSyncRotationPasswordConfirm(event.target.value)
                }
              />
            </label>
            <div className="settings-row">
              <button
                type="button"
                className="btn-secondary"
                disabled={syncBusy !== null}
                onClick={() => {
                  setPendingSyncRotation(false);
                  setSyncRotationPassword("");
                  setSyncRotationPasswordConfirm("");
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={syncBusy !== null}
                onClick={() => void handleRotateSyncEncryption()}
              >
                {syncBusy === "rotate" ? "轮换中…" : "确认轮换"}
              </button>
            </div>
          </div>
        </div>
      )}
      {pendingSyncCleanup && (
        <div className="dialog-overlay restore-confirm-overlay">
          <div
            className="restore-confirm-card"
            role="alertdialog"
            aria-modal="true"
          >
            <h3>确认清理同步历史?</h3>
            <p>
              只会删除超过 30
              天且所有启用设备都已确认的变更和墓碑，冲突审计记录会保留。
            </p>
            <div className="settings-row">
              <button
                type="button"
                className="btn-secondary"
                disabled={syncBusy !== null}
                onClick={() => setPendingSyncCleanup(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="btn-danger-solid"
                disabled={syncBusy !== null}
                onClick={() => void handleCleanupHistory()}
              >
                确认清理
              </button>
            </div>
          </div>
        </div>
      )}
    </DialogShell>
  );
}
