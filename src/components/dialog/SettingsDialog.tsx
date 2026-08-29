import { type CSSProperties, useState } from "react";
import {
  Cloud,
  DatabaseBackup,
  Info,
  Palette,
  Settings,
  Settings2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
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
import { SettingsDesktopSection } from "./SettingsDesktopSection";
import { SettingsAppearanceSection } from "./SettingsAppearanceSection";
import type { AppSettings } from "../../types/settings";
import type { TaskList } from "../../types/database";

type SettingsPanel = "general" | "appearance" | "sync" | "data" | "about";

const settingsPanels = [
  {
    id: "general",
    title: "常规",
    description: "默认行为、提醒、回收站、桌面与启动",
    icon: Settings2,
  },
  {
    id: "appearance",
    title: "外观",
    description: "桌面小窗便签的纸色、透明度、字体与纸面细节",
    icon: Palette,
  },
  {
    id: "sync",
    title: "WebDAV 同步",
    navTitle: "同步",
    description: "账号、自动同步、设备与冲突",
    icon: Cloud,
  },
  {
    id: "data",
    title: "数据与备份",
    navTitle: "数据",
    description: "备份、恢复、导入和导出",
    icon: DatabaseBackup,
    desktopOnly: true,
  },
  {
    id: "about",
    title: "关于",
    description: "版本信息与更新",
    icon: Info,
  },
] satisfies Array<{
  id: SettingsPanel;
  title: string;
  navTitle?: string;
  description: string;
  icon: LucideIcon;
  desktopOnly?: boolean;
}>;

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
  const [activePanel, setActivePanel] = useState<SettingsPanel>("general");
  const visiblePanels = settingsPanels.filter(
    (panel) => !panel.desktopOnly || !mobile,
  );
  const activeMeta =
    visiblePanels.find((panel) => panel.id === activePanel) ?? visiblePanels[0];

  return (
    <DialogShell
      title="设置"
      icon={Settings}
      width="920px"
      presence={presence}
      overlayClassName="settings-dialog"
      onClose={onClose}
    >
      <div className="settings-layout">
        <aside className="settings-sidebar" aria-label="设置分类">
          <nav
            className="settings-side-nav"
            role="tablist"
            style={
              {
                "--settings-panel-count": visiblePanels.length,
              } as CSSProperties
            }
          >
            {visiblePanels.map((panel) => {
              const Icon = panel.icon;
              const selected = panel.id === activeMeta.id;
              return (
                <button
                  key={panel.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className={[
                    "settings-side-nav-item",
                    selected ? "is-active" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => setActivePanel(panel.id)}
                >
                  <Icon aria-hidden="true" />
                  <span>
                    <strong>{panel.navTitle ?? panel.title}</strong>
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        <div
          className="settings-content"
          role="tabpanel"
          aria-label={activeMeta.title}
        >
          <div className="settings-content-head">
            <h3>{activeMeta.title}</h3>
            <p>{activeMeta.description}</p>
          </div>

          <div className="settings-panel">
            {activeMeta.id === "general" && (
              <>
                <SettingsPreferencesSection
                  settings={settings}
                  lists={lists}
                  onSettingsChange={onSettingsChange}
                  onToast={onToast}
                />
                <SettingsDesktopSection onToast={onToast} />
              </>
            )}

            {activeMeta.id === "appearance" && (
              <SettingsAppearanceSection onToast={onToast} />
            )}

            {activeMeta.id === "sync" && (
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

            {activeMeta.id === "data" && !mobile && (
              <>
                <SettingsBackupSection
                  autoBackup={autoBackup}
                  onAutoBackupChange={onAutoBackupChange}
                  onClose={onClose}
                  onToast={onToast}
                />
                <SettingsImportSection
                  lists={lists}
                  onToast={onToast}
                  onImported={onImportComplete}
                />
                <SettingsExportSection onToast={onToast} />
              </>
            )}

            {activeMeta.id === "about" && (
              <SettingsAboutSection onToast={onToast} />
            )}
          </div>
        </div>
      </div>

      <footer className="dialog-footer">
        <button type="button" className="btn-secondary" onClick={onClose}>
          完成
        </button>
      </footer>
    </DialogShell>
  );
}
