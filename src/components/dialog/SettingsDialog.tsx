import { useEffect, useState } from "react";
import {
  DatabaseBackup,
  Download,
  ExternalLink,
  HardDrive,
  Info,
  RefreshCw,
  Settings,
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

export function SettingsDialog({
  autoBackup,
  presence,
  onClose,
  onAutoBackupChange,
  onToast,
}: {
  autoBackup: boolean;
  presence: PresencePhase;
  onClose: () => void;
  onAutoBackupChange: (enabled: boolean) => void;
  onToast: (message: string, type: ToastKind) => void;
}) {
  const mobile = isMobile();
  const [busy, setBusy] = useState(false);
  const [backups, setBackups] = useState<string[]>([]);
  const [pendingRestore, setPendingRestore] = useState<string | null>(null);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [updateState, setUpdateState] = useState<
    | { state: "idle" }
    | { state: "checking" }
    | { state: "none" }
    | { state: "found"; info: UpdateInfo }
    | { state: "error"; message: string }
  >({ state: "idle" });

  useEffect(() => {
    void listBackups().then(setBackups);
    void getAppInfo()
      .then(setAppInfo)
      .catch(() => setAppInfo(null));
  }, []);

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
      const path = await backupDatabase();
      const backups = await listBackups();
      setBackups(backups);
      onToast("数据库备份完成", "success");
      console.info("backup saved at:", path);
    } catch (error) {
      onToast(`备份失败: ${String(error)}`, "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleExport(format: ExportFormat) {
    setBusy(true);
    try {
      const path = await exportTasks(format);
      onToast(
        format === "json"
          ? "已导出 JSON"
          : format === "markdown"
            ? "已导出 Markdown"
            : "已导出 CSV",
        "success",
      );
      console.info("export saved at:", path);
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
    <div className="dialog-overlay settings-dialog">
      <DialogShell
        title="设置"
        subtitle={mobile ? "关于与更新" : "备份 · 导出 · 更新"}
        icon={Settings}
        width="520px"
        presence={presence}
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
      </DialogShell>
    </div>
  );
}
