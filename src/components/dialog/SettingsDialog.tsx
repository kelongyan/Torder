import { useState } from "react";
import {
  ArrowLeft,
  ChevronRight,
  Cloud,
  Download,
  FileUp,
  Settings,
} from "lucide-react";
import { DialogShell } from "./DialogShell";
import type { PresencePhase } from "../../hooks/usePresence";
import type { ToastKind } from "../../types/ui";
import type { SyncStatus } from "../../types/sync";
import { isMobile } from "../../utils/platform";
import { SettingsBackupSection } from "./SettingsBackupSection";
import { SettingsSyncSection } from "./SettingsSyncSection";
import { SettingsExportSection } from "./SettingsExportSection";
import { SettingsImportSection } from "./SettingsImportSection";
import { SettingsAboutSection } from "./SettingsAboutSection";
import { SettingsPreferencesSection } from "./SettingsPreferencesSection";
import type { AppSettings } from "../../types/settings";
import type { TaskList } from "../../types/database";

type SettingsPanel = "root" | "sync" | "transfer";

const panelMeta = {
  root: {
    title: "设置",
    icon: Settings,
  },
  sync: {
    title: "WebDAV 同步",
    icon: Cloud,
  },
  transfer: {
    title: "导入导出",
    icon: FileUp,
  },
} satisfies Record<SettingsPanel, { title: string; icon: typeof Settings }>;

export function SettingsDialog({
  autoBackup,
  settings,
  lists,
  syncAutoEnabled,
  syncWifiOnly,
  externalSyncStatus,
  presence,
  onClose,
  onAutoBackupChange,
  onSettingsChange,
  onSyncAutoEnabledChange,
  onSyncWifiOnlyChange,
  onSyncStatusChange,
  onToast,
  onImportComplete,
}: {
  autoBackup: boolean;
  settings: AppSettings;
  lists: TaskList[];
  syncAutoEnabled: boolean;
  syncWifiOnly: boolean;
  externalSyncStatus: SyncStatus | null;
  presence: PresencePhase;
  onClose: () => void;
  onAutoBackupChange: (enabled: boolean) => void;
  onSettingsChange: (settings: AppSettings) => void;
  onSyncAutoEnabledChange: (enabled: boolean) => void;
  onSyncWifiOnlyChange: (enabled: boolean) => void;
  onSyncStatusChange: (status: SyncStatus) => void;
  onToast: (message: string, type: ToastKind) => void;
  onImportComplete: () => Promise<void>;
}) {
  const mobile = isMobile();
  const [activePanel, setActivePanel] = useState<SettingsPanel>("root");
  const dialogMeta = panelMeta[activePanel];

  return (
    <DialogShell
      title={dialogMeta.title}
      icon={dialogMeta.icon}
      width="520px"
      presence={presence}
      overlayClassName="settings-dialog"
      onClose={onClose}
    >
      <div className="dialog-form">
        {activePanel === "root" && (
          <>
            <SettingsPreferencesSection
              settings={settings}
              lists={lists}
              onSettingsChange={onSettingsChange}
              onToast={onToast}
            />

            <section className="settings-section">
              <div className="settings-nav-list">
                <button
                  type="button"
                  className="settings-nav-item"
                  onClick={() => setActivePanel("sync")}
                >
                  <span className="settings-nav-icon">
                    <Cloud aria-hidden="true" />
                  </span>
                  <span className="settings-nav-copy">
                    <strong>WebDAV 同步</strong>
                    <span>账号、自动同步、冲突处理、诊断</span>
                  </span>
                  <ChevronRight aria-hidden="true" className="icon-sm" />
                </button>
                {!mobile && (
                  <button
                    type="button"
                    className="settings-nav-item"
                    onClick={() => setActivePanel("transfer")}
                  >
                    <span className="settings-nav-icon">
                      <Download aria-hidden="true" />
                    </span>
                    <span className="settings-nav-copy">
                      <strong>导入导出</strong>
                      <span>导入文件或旧备份，导出任务数据</span>
                    </span>
                    <ChevronRight aria-hidden="true" className="icon-sm" />
                  </button>
                )}
              </div>
            </section>

            {!mobile && (
              <SettingsBackupSection
                autoBackup={autoBackup}
                onAutoBackupChange={onAutoBackupChange}
                onClose={onClose}
                onToast={onToast}
              />
            )}

            <SettingsAboutSection onToast={onToast} />
          </>
        )}

        {activePanel === "sync" && (
          <SettingsSyncSection
            syncAutoEnabled={syncAutoEnabled}
            syncWifiOnly={syncWifiOnly}
            externalSyncStatus={externalSyncStatus}
            onSyncAutoEnabledChange={onSyncAutoEnabledChange}
            onSyncWifiOnlyChange={onSyncWifiOnlyChange}
            onSyncStatusChange={onSyncStatusChange}
            onToast={onToast}
          />
        )}

        {activePanel === "transfer" && !mobile && (
          <>
            <SettingsImportSection
              lists={lists}
              onToast={onToast}
              onImported={onImportComplete}
            />
            <SettingsExportSection onToast={onToast} />
          </>
        )}
      </div>

      <footer className="dialog-footer">
        {activePanel !== "root" && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setActivePanel("root")}
          >
            <ArrowLeft aria-hidden="true" className="icon-sm" />
            返回设置
          </button>
        )}
        <button type="button" className="btn-secondary" onClick={onClose}>
          完成
        </button>
      </footer>
    </DialogShell>
  );
}
