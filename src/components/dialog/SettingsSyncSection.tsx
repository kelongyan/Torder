import { type KeyboardEvent, useCallback, useEffect, useState } from "react";
import { Cloud, RefreshCw } from "lucide-react";
import type { ToastKind } from "../../types/ui";
import { usePresence } from "../../hooks/usePresence";
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
import { mergedConflictPayload } from "../../utils/syncConflict";
import { SyncConflictPanel } from "./SyncConflictPanel";
import { SyncDevicesPanel } from "./SyncDevicesPanel";
import { SyncEncryptionCard } from "./SyncEncryptionCard";
import { SyncConfirmOverlay } from "./SyncConfirmOverlay";
import { SyncRotationDialog } from "./SyncRotationDialog";

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

  // 确认浮层统一走 usePresence（rendered + phase），避免裸条件渲染缺失退场动画
  const syncRemovalPresence = usePresence(pendingSyncRemoval, 280);
  const deviceRevokePresence = usePresence(pendingDeviceRevoke, 280);
  const syncRotationPresence = usePresence(pendingSyncRotation, 280);
  const syncCleanupPresence = usePresence(pendingSyncCleanup, 280);

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
        resolution === "merge"
          ? mergedConflictPayload(conflict, mergeChoices)
          : undefined,
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

  function handleSyncCredentialKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    if (syncStatus?.configured || syncSetupStep !== 2 || syncBusy !== null) {
      return;
    }
    event.preventDefault();
    void handleTestSync();
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
                    className={syncSetupStep === index + 1 ? "is-current" : ""}
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
                        enterKeyHint="next"
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
                        enterKeyHint="done"
                        value={syncPassword}
                        onChange={(event) =>
                          setSyncPassword(event.target.value)
                        }
                        onKeyDown={handleSyncCredentialKeyDown}
                      />
                    </label>
                  </>
                )}
                <SyncEncryptionCard
                  enabled={syncEncryptionEnabled}
                  remoteEnabled={syncInspection?.encryptionEnabled}
                  configured={syncStatus?.configured === true}
                  keyAvailable={syncStatus?.encryptionKeyAvailable}
                  password={syncEncryptionPassword}
                  passwordConfirm={syncEncryptionPasswordConfirm}
                  onEnabledChange={setSyncEncryptionEnabled}
                  onPasswordChange={setSyncEncryptionPassword}
                  onPasswordConfirmChange={setSyncEncryptionPasswordConfirm}
                />
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
            <SyncDevicesPanel
              devices={syncDevices}
              status={syncStatus}
              busy={syncBusy !== null}
              onRevokeRequest={(device) => setPendingDeviceRevoke(device)}
              onCleanupRequest={() => setPendingSyncCleanup(true)}
              onRotateRequest={() => setPendingSyncRotation(true)}
              onExport={() => void handleExportSyncDiagnostics()}
            />
          </div>
        )}
        {syncStatus?.lastError && (
          <p className="settings-section-hint">
            同步失败：{syncStatus.lastError}
          </p>
        )}
        <SyncConflictPanel
          conflicts={syncConflicts}
          mergeChoices={mergeChoices}
          busy={syncBusy !== null}
          onMergeChoice={updateMergeChoice}
          onResolve={(conflict, resolution) =>
            void handleResolveConflict(conflict, resolution)
          }
        />
      </section>

      <SyncConfirmOverlay
        rendered={syncRemovalPresence.rendered}
        className={syncRemovalPresence.className}
        title="确认移除同步配置?"
        confirmLabel="确认移除"
        danger
        busy={syncBusy !== null}
        onCancel={() => setPendingSyncRemoval(false)}
        onConfirm={() => void handleRemoveSync()}
      >
        <p>删除本机同步配置，不影响远端数据。</p>
      </SyncConfirmOverlay>
      <SyncConfirmOverlay
        rendered={
          deviceRevokePresence.rendered && Boolean(deviceRevokePresence.value)
        }
        className={deviceRevokePresence.className}
        title="确认撤销设备?"
        confirmLabel="确认撤销"
        danger
        busy={syncBusy !== null}
        onCancel={() => setPendingDeviceRevoke(null)}
        onConfirm={() => void handleRevokeDevice()}
      >
        <p>
          撤销 <strong>{deviceRevokePresence.value?.name}</strong>{" "}
          后不能继续同步。
        </p>
      </SyncConfirmOverlay>
      <SyncRotationDialog
        rendered={syncRotationPresence.rendered}
        className={syncRotationPresence.className}
        encryptionEnabled={syncStatus?.encryptionEnabled}
        password={syncRotationPassword}
        passwordConfirm={syncRotationPasswordConfirm}
        busy={syncBusy}
        onPasswordChange={setSyncRotationPassword}
        onPasswordConfirmChange={setSyncRotationPasswordConfirm}
        onCancel={() => {
          setPendingSyncRotation(false);
          setSyncRotationPassword("");
          setSyncRotationPasswordConfirm("");
        }}
        onConfirm={() => void handleRotateSyncEncryption()}
      />
      <SyncConfirmOverlay
        rendered={syncCleanupPresence.rendered}
        className={syncCleanupPresence.className}
        title="确认清理同步历史?"
        confirmLabel="确认清理"
        danger
        busy={syncBusy !== null}
        onCancel={() => setPendingSyncCleanup(false)}
        onConfirm={() => void handleCleanupHistory()}
      >
        <p>删除已确认的 30 天前历史，保留冲突记录。</p>
      </SyncConfirmOverlay>
    </>
  );
}
