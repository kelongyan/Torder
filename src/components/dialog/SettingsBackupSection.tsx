import { useState } from "react";
import {
  open as openFileDialog,
  save as saveFileDialog,
} from "@tauri-apps/plugin-dialog";
import { DatabaseBackup, FileDown, FileUp, HardDrive } from "lucide-react";
import type { ToastKind } from "../../types/ui";
import { usePresence } from "../../hooks/usePresence";
import { ToggleSwitch } from "../common/ToggleSwitch";
import {
  backupDatabase,
  exportBackupPackage,
  importMigrationPackage,
  previewMigrationPackage,
  type BackupImportPreview,
  type ImportMode,
} from "../../services/backupService";
import { upsertSetting } from "../../services/settingsService";
import { isTauri } from "@tauri-apps/api/core";
import { isMobile } from "../../utils/platform";

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
  const [migrationPreview, setMigrationPreview] =
    useState<BackupImportPreview | null>(null);
  // 确认浮层走 usePresence（rendered + phase），避免裸条件渲染缺失退场动画
  const migrationPresence = usePresence(migrationPreview, 280);
  // 迁移包需要系统保存/打开对话框，浏览器 mock 没有该能力
  const migrationsAvailable = isTauri() && !isMobile();

  async function handleBackup() {
    setBusy(true);
    try {
      await backupDatabase();
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

  /** 导出完整迁移包到用户选定位置（含事项、清单、设置、附件）。 */
  async function handleExportPackage() {
    try {
      const destination = await saveFileDialog({
        title: "导出完整备份",
        defaultPath: `Torder_${new Date().toISOString().slice(0, 10)}.torder`,
        filters: [{ name: "Torder 备份", extensions: ["torder"] }],
      });
      if (!destination) return; // 用户取消
      setBusy(true);
      await exportBackupPackage(destination);
      onToast("完整备份已导出", "success");
    } catch (error) {
      onToast(`导出失败: ${String(error)}`, "error");
    } finally {
      setBusy(false);
    }
  }

  /** 选一个迁移包并预览内容，预览确认后才执行恢复。 */
  async function handlePickPackage() {
    try {
      const selected = await openFileDialog({
        title: "选择备份文件",
        multiple: false,
        directory: false,
        filters: [
          { name: "Torder 备份", extensions: ["torder", "zip", "sqlite"] },
        ],
      });
      if (!selected || Array.isArray(selected)) return; // 用户取消
      setBusy(true);
      const preview = await previewMigrationPackage(selected);
      setMigrationPreview(preview);
    } catch (error) {
      onToast(`无法读取备份: ${String(error)}`, "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleMigration(mode: ImportMode) {
    const preview = migrationPreview;
    if (!preview) return;
    setBusy(true);
    try {
      await importMigrationPackage(preview.path, mode);
      onClose();
      // 与恢复同理：整库/大范围变更后必须重载，让所有查询重新命中新数据。
      window.location.reload();
    } catch (error) {
      setMigrationPreview(null);
      onToast(`导入失败: ${String(error)}`, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="settings-section">
        <h3 className="settings-section-title">
          <DatabaseBackup aria-hidden="true" className="icon-sm" />
          备份与迁移
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
          {migrationsAvailable && (
            <>
              <button
                type="button"
                className="btn-secondary"
                disabled={busy}
                onClick={() => void handleExportPackage()}
              >
                <FileDown aria-hidden="true" className="icon-sm" />
                导出完整备份
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={busy}
                onClick={() => void handlePickPackage()}
              >
                <FileUp aria-hidden="true" className="icon-sm" />
                从备份恢复
              </button>
            </>
          )}
        </div>
        <div className="settings-toggle-row">
          <span className="settings-toggle-label">启动时自动备份</span>
          <ToggleSwitch
            checked={autoBackup}
            label="启动时自动备份"
            disabled={busy}
            onChange={(next) => void handleAutoBackupToggle(next)}
          />
        </div>
      </section>

      {migrationPresence.rendered && migrationPresence.value && (
        <div
          className={`dialog-overlay restore-confirm-overlay ${migrationPresence.className}`}
        >
          <div
            className="restore-confirm-card"
            role="alertdialog"
            aria-modal="true"
          >
            <h3>从备份恢复</h3>
            <p>
              <strong>{migrationPresence.value.name}</strong> 包含：
            </p>
            <ul className="settings-migration-summary">
              <li>{migrationPresence.value.taskCount} 个事项</li>
              <li>{migrationPresence.value.listCount} 个清单</li>
              <li>{migrationPresence.value.recurringRuleCount} 条循环规则</li>
              <li>{migrationPresence.value.calendarEventCount} 个日程</li>
              <li>{migrationPresence.value.settingCount} 项设置</li>
            </ul>
            <div className="settings-migration-modes">
              <button
                type="button"
                className="btn-secondary"
                disabled={busy}
                onClick={() => setMigrationPreview(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={busy}
                onClick={() => void handleMigration("merge")}
              >
                合并导入
              </button>
              <button
                type="button"
                className="btn-danger-solid"
                disabled={busy}
                onClick={() => void handleMigration("replace")}
              >
                替换全部数据
              </button>
            </div>
            <p className="settings-migration-hint">
              合并会保留现有数据，只补齐备份里的内容（同名清单自动复用）；
              替换会清空当前数据、完全回到备份状态（恢复前会自动存一份当前数据副本）。
            </p>
          </div>
        </div>
      )}

    </>
  );
}
