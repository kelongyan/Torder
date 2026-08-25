import { useCallback, useEffect, useState } from "react";
import { Cloud, RefreshCw, ShieldCheck } from "lucide-react";
import type { ToastKind } from "../../types/ui";
import {
  cleanupSyncHistory,
  exportSyncDiagnostics,
  getSyncStatus,
  listSyncConflicts,
  listSyncDevices,
  removeSyncConfig,
  revokeSyncDevice,
  resolveSyncConflict,
  rotateSyncEncryption,
  runSync,
  saveSyncConfig,
  testSyncConnection,
} from "../../services/syncService";
import { upsertSetting } from "../../services/settingsService";
import type {
  InitialSyncMode,
  SyncConflict,
  SyncDevice,
  SyncRemoteInspection,
  SyncStatus,
} from "../../types/sync";
import { isMobile } from "../../utils/platform";
import { isTauri } from "@tauri-apps/api/core";

export function SettingsSyncSection({
  syncAutoEnabled,
  syncWifiOnly,
  externalSyncStatus,
  onSyncAutoEnabledChange,
  onSyncWifiOnlyChange,
  onSyncStatusChange,
  onToast,
}: {
  syncAutoEnabled: boolean;
  syncWifiOnly: boolean;
  externalSyncStatus: SyncStatus | null;
  onSyncAutoEnabledChange: (enabled: boolean) => void;
  onSyncWifiOnlyChange: (enabled: boolean) => void;
  onSyncStatusChange: (status: SyncStatus) => void;
  onToast: (message: string, type: ToastKind) => void;
}) {
  const mobile = isMobile();
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
      scheduledDate: "计划日期",
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
      onToast("填写地址和目录", "error");
      return false;
    }
    if (!syncServerUrl.trim().startsWith("https://")) {
      onToast("WebDAV 需使用 HTTPS", "error");
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
      onToast("输入加密密码", "error");
      return false;
    }
    if (password && password.length < 8) {
      onToast("加密密码至少 8 位", "error");
      return false;
    }
    if (password && password !== confirmation) {
      onToast("两次密码不一致", "error");
      return false;
    }
    if (!password && confirmation) {
      onToast("先输入加密密码", "error");
      return false;
    }
    return true;
  }

  function handleSyncServerNext() {
    if (!syncServerUrl.trim() || !syncRemotePath.trim()) {
      onToast("填写地址和目录", "error");
      return;
    }
    if (!syncServerUrl.trim().startsWith("https://")) {
      onToast("WebDAV 需使用 HTTPS", "error");
      return;
    }
    if (!syncDeviceName.trim()) {
      onToast("填写设备名称", "error");
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
      onToast("连接检查通过", "success");
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
      onToast("先测试连接", "error");
      return;
    }
    if (syncInspection?.requiresConfirmation && !syncRemoteConfirmed) {
      onToast("先确认目录", "error");
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
      onToast(`保存同步失败: ${String(error)}`, "error");
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
        onToast(`配置已保存，同步失败: ${String(error)}`, "error");
      }
    } else {
      onToast("同步配置已保存", "success");
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
        status.conflictCount > 0 ? "同步完成，有冲突" : "同步完成",
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
      onToast("已移除同步配置", "info");
    } catch (error) {
      onToast(`移除同步配置失败: ${String(error)}`, "error");
    } finally {
      setSyncBusy(null);
    }
  }

  async function handleRevokeDevice() {
    if (!pendingDeviceRevoke) return;
    setSyncBusy("run");
    try {
      await revokeSyncDevice(pendingDeviceRevoke.id);
      setPendingDeviceRevoke(null);
      await refreshSyncStatus();
      onToast("设备已撤销", "info");
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
        `已清理 ${result.changesRemoved} 条历史 · ${result.tombstonesRemoved} 个墓碑`,
        "info",
      );
    } catch (error) {
      onToast(`清理历史失败: ${String(error)}`, "error");
    } finally {
      setSyncBusy(null);
    }
  }

  async function handleRotateSyncEncryption() {
    if (!syncStatus?.configured) return;
    if (syncStatus.pendingChanges > 0) {
      onToast("先完成待上传变更", "error");
      return;
    }
    if (syncRotationPassword.length < 8) {
      onToast("新密码至少 8 位", "error");
      return;
    }
    if (syncRotationPassword !== syncRotationPasswordConfirm) {
      onToast("两次密码不一致", "error");
      return;
    }
    setSyncBusy("rotate");
    try {
      await rotateSyncEncryption(syncRotationPassword);
      setPendingSyncRotation(false);
      setSyncRotationPassword("");
      setSyncRotationPasswordConfirm("");
      await refreshSyncStatus();
      onToast("密钥已轮换", "success");
    } catch (error) {
      onToast("密钥轮换失败: " + String(error), "error");
    } finally {
      setSyncBusy(null);
    }
  }

  async function handleExportSyncDiagnostics() {
    setSyncBusy("run");
    try {
      const path = await exportSyncDiagnostics();
      onToast(`诊断已导出：${path}`, "success");
    } catch (error) {
      onToast(`导出诊断失败: ${String(error)}`, "error");
    } finally {
      setSyncBusy(null);
    }
  }

  async function handleSyncAutoToggle(enabled: boolean) {
    try {
      await upsertSetting("syncAutoEnabled", enabled);
      onSyncAutoEnabledChange(enabled);
      onToast(enabled ? "已开启自动同步" : "已暂停自动同步", "info");
    } catch (error) {
      onToast(`设置保存失败: ${String(error)}`, "error");
    }
  }

  async function handleSyncWifiOnlyToggle(enabled: boolean) {
    try {
      await upsertSetting("syncWifiOnly", enabled);
      onSyncWifiOnlyChange(enabled);
      onToast(enabled ? "仅 Wi-Fi 自动同步" : "已允许蜂窝同步", "info");
    } catch (error) {
      onToast(`设置保存失败: ${String(error)}`, "error");
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

  return (
    <>
      <section className="settings-section">
        <h3 className="settings-section-title">
          <Cloud aria-hidden="true" className="icon-sm" />
          同步
        </h3>
        {syncStatus?.configured && (
          <p className="settings-section-hint">
            待上传 {syncStatus.pendingChanges} · 冲突 {syncStatus.conflictCount}
          </p>
        )}
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
          <div className="settings-status-note">浏览器模式不可用。</div>
        ) : (
          <div className="sync-config-grid">
            {!syncStatus?.configured && (
              <div
                className="sync-setup-steps form-grid-full"
                aria-label="同步设置进度"
              >
                {["服务器", "认证", "确认"].map((label, index) => (
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
                    placeholder="WebDAV 地址"
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
                    placeholder="远端目录"
                    value={syncRemotePath}
                    onChange={(event) => {
                      setSyncRemotePath(event.target.value);
                      invalidateSyncInspection();
                    }}
                  />
                </label>
                <label className="form-field">
                  <span>设备名称</span>
                  <input
                    type="text"
                    maxLength={128}
                    placeholder="设备名称"
                    value={syncDeviceName}
                    onChange={(event) => setSyncDeviceName(event.target.value)}
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
                          ? "更新应用密码（可选）"
                          : "应用密码"}
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
                <div className="sync-encryption-card form-grid-full">
                  <div className="sync-encryption-head">
                    <span className="sync-encryption-icon">
                      <ShieldCheck aria-hidden="true" className="icon-sm" />
                    </span>
                    <span className="sync-encryption-copy">
                      <strong>端到端加密</strong>
                      <span>
                        {syncInspection?.encryptionEnabled === true
                          ? "远端已启用，需使用加密密码"
                          : "开启后同步数据会加密保存"}
                      </span>
                    </span>
                    <label className="settings-toggle sync-encryption-toggle">
                      <input
                        type="checkbox"
                        aria-label="端到端加密"
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
                    </label>
                  </div>
                  {(syncEncryptionEnabled ||
                    syncInspection?.encryptionEnabled === true) && (
                    <div className="sync-encryption-fields">
                      <label className="form-field">
                        <span>
                          {syncStatus?.encryptionKeyAvailable
                            ? "更新加密密码（可选）"
                            : "加密密码"}
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
                      <label className="form-field">
                        <span>确认密码</span>
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
                      <p>密码只保存在本机，不会上传。</p>
                    </div>
                  )}
                </div>
              </>
            )}
            {syncInspection &&
              (syncStatus?.configured || syncSetupStep === 3) && (
                <div className="sync-inspection form-grid-full" role="status">
                  <span className="sync-inspection-copy">
                    <strong>
                      {syncInspection.initialized
                        ? "已发现同步集合"
                        : "将新建同步集合"}
                    </strong>
                    {syncInspection.unknownEntries.length > 0 && (
                      <span>
                        未知项目：{syncInspection.unknownEntries.join("、")}
                      </span>
                    )}
                  </span>
                  {syncInspection.requiresConfirmation && (
                    <label className="sync-confirm-row">
                      <input
                        type="checkbox"
                        checked={syncRemoteConfirmed}
                        onChange={(event) =>
                          setSyncRemoteConfirmed(event.target.checked)
                        }
                      />
                      <span>
                        <strong>确认服务器和目录</strong>
                        <small>将使用当前目录作为同步集合。</small>
                      </span>
                    </label>
                  )}
                </div>
              )}
            {!syncStatus?.configured &&
              syncSetupStep === 3 &&
              syncInspection && (
                <fieldset className="sync-initial-mode-list form-grid-full">
                  <legend>首次同步</legend>
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
                      <small>推荐</small>
                    </span>
                  </label>
                  <label
                    className={`sync-initial-mode ${
                      syncInspection.initialized ? "is-disabled" : ""
                    }`}
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
                          ? "远端已有数据"
                          : "以本机建立远端"}
                      </small>
                    </span>
                  </label>
                  <label
                    className={`sync-initial-mode ${
                      (syncStatus?.pendingChanges ?? 0) > 0 ? "is-disabled" : ""
                    }`}
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
                          ? `待上传 ${syncStatus?.pendingChanges ?? 0} 项`
                          : "以远端为准"}
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
                    {syncBusy === "save" ? "保存中…" : "保存"}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={syncBusy !== null}
                    onClick={() => void handleRunSync()}
                  >
                    <RefreshCw
                      aria-hidden="true"
                      className={`icon-sm ${
                        syncBusy === "run" ? "is-spinning" : ""
                      }`}
                    />
                    {syncBusy === "run" ? "同步中…" : "立即同步"}
                  </button>
                  <button
                    type="button"
                    className="btn-danger-solid"
                    disabled={syncBusy !== null}
                    onClick={() => setPendingSyncRemoval(true)}
                  >
                    {syncBusy === "remove" ? "移除中…" : "移除"}
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
                    void handleSyncAutoToggle(event.target.checked)
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
                    void handleSyncWifiOnlyToggle(event.target.checked)
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
                清理历史
              </button>
            )}
            {syncStatus?.configured && (
              <div className="sync-device-item form-grid-full">
                <div className="sync-device-copy">
                  <strong>
                    {syncStatus.encryptionEnabled ? "加密密钥" : "端到端加密"}
                  </strong>
                  <span>
                    {syncStatus.encryptionEnabled
                      ? syncStatus.encryptionKeyAvailable
                        ? "密钥 " + (syncStatus.encryptionKeyId ?? "可用")
                        : "缺少密钥，需输入密码"
                      : "创建加密快照"}
                    {syncStatus.pendingChanges > 0
                      ? " · 待上传 " + syncStatus.pendingChanges + " 项"
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
              导出诊断
            </button>
          </div>
        )}
        {syncStatus?.lastError && (
          <p className="settings-section-hint">
            同步失败：{syncStatus.lastError}
          </p>
        )}
        {syncConflicts.length > 0 && (
          <div className="sync-conflict-list">
            <div className="settings-list-label">冲突</div>
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
                      清单名称冲突，先重命名本地清单。
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

      {pendingSyncRemoval && (
        <div className="dialog-overlay restore-confirm-overlay">
          <div
            className="restore-confirm-card"
            role="alertdialog"
            aria-modal="true"
          >
            <h3>确认移除同步配置?</h3>
            <p>删除本机同步配置，不影响远端数据。</p>
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
              撤销 <strong>{pendingDeviceRevoke.name}</strong> 后不能继续同步。
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
                ? "轮换加密密钥?"
                : "启用端到端加密?"}
            </h3>
            <p>其他设备需要用新密码重新同步。</p>
            <label className="form-field">
              <span>新加密密码</span>
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
              <span>确认新密码</span>
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
            <p>删除已确认的 30 天前历史，保留冲突记录。</p>
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
    </>
  );
}
