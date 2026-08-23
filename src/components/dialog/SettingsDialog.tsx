import { Settings } from "lucide-react";
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

  return (
    <DialogShell
      title="设置"
      icon={Settings}
      width="520px"
      presence={presence}
      overlayClassName="settings-dialog"
      onClose={onClose}
    >
      <div className="dialog-form">
        <SettingsPreferencesSection
          settings={settings}
          lists={lists}
          onSettingsChange={onSettingsChange}
          onToast={onToast}
        />

        {!mobile && (
          <SettingsBackupSection
            autoBackup={autoBackup}
            onAutoBackupChange={onAutoBackupChange}
            onClose={onClose}
            onToast={onToast}
          />
        )}

        <SettingsSyncSection
          syncAutoEnabled={syncAutoEnabled}
          syncWifiOnly={syncWifiOnly}
          externalSyncStatus={externalSyncStatus}
          onSyncAutoEnabledChange={onSyncAutoEnabledChange}
          onSyncWifiOnlyChange={onSyncWifiOnlyChange}
          onSyncStatusChange={onSyncStatusChange}
          onToast={onToast}
        />

        {!mobile && (
          <>
            <SettingsImportSection
              lists={lists}
              onToast={onToast}
              onImported={onImportComplete}
            />
            <SettingsExportSection onToast={onToast} />
          </>
        )}

        <SettingsAboutSection onToast={onToast} />
      </div>

      <footer className="dialog-footer">
        <button type="button" className="btn-secondary" onClick={onClose}>
          完成
        </button>
      </footer>
    </DialogShell>
  );
}
