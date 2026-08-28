import { useEffect, useState } from "react";
import { DatabaseBackup, HardDrive, RefreshCw } from "lucide-react";
import type { ToastKind } from "../../types/ui";
import { usePresence } from "../../hooks/usePresence";
import {
  backupDatabase,
  listBackups,
  restoreBackup,
} from "../../services/backupService";
import { upsertSetting } from "../../services/settingsService";

export function SettingsBackupSection({
  autoBackup,
  onAutoBackupChange,
  onClose,
  onToast,
}: {
  autoBackup: boolean;
  onAutoBackupChange: (enabled: boolean) => void;
  onClose: () => void;
  onToast: (message: string, type: ToastKind) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [backups, setBackups] = useState<string[]>([]);
  const [pendingRestore, setPendingRestore] = useState<string | null>(null);
  // 确认浮层走 usePresence（rendered + phase），避免裸条件渲染缺失退场动画
  const restorePresence = usePresence(pendingRestore, 280);

  // 挂载时加载一次已有备份，否则恢复入口只在手动备份后才可见
  useEffect(() => {
    let cancelled = false;
    void listBackups()
      .then((nextBackups) => {
        if (!cancelled) setBackups(nextBackups);
      })
      .catch(() => {
        // 列表加载失败不打扰用户，手动备份后仍会刷新
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleBackup() {
    setBusy(true);
    try {
      await backupDatabase();
      const nextBackups = await listBackups();
      setBackups(nextBackups);
      onToast("备份完成", "success");
    } catch (error) {
      onToast(`备份失败: ${String(error)}`, "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleAutoBackupToggle(enabled: boolean) {
    try {
      await upsertSetting("autoBackup", enabled);
      onAutoBackupChange(enabled);
      onToast(enabled ? "已开启自动备份" : "已关闭自动备份", "info");
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
    <>
      <section className="settings-section">
        <h3 className="settings-section-title">
          <DatabaseBackup aria-hidden="true" className="icon-sm" />
          备份
        </h3>
        <div className="settings-row settings-action-row">
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
                void handleAutoBackupToggle(event.target.checked)
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

      {restorePresence.rendered && restorePresence.value && (
        <div
          className={`dialog-overlay restore-confirm-overlay ${restorePresence.className}`}
        >
          <div
            className="restore-confirm-card"
            role="alertdialog"
            aria-modal="true"
          >
            <h3>确认恢复备份?</h3>
            <p>
              用 <strong>{shortName(restorePresence.value)}</strong>{" "}
              覆盖当前数据，不可撤销。
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
                onClick={() => {
                  if (restorePresence.value) void handleRestore(restorePresence.value);
                }}
              >
                确认恢复
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
