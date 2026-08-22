import { Settings } from "lucide-react";
import { DialogShell } from "./DialogShell";
import type { PresencePhase } from "../../hooks/usePresence";
import type { ToastKind } from "../../types/ui";
import type { SyncStatus } from "../../types/sync";
import { isMobile } from "../../utils/platform";
import { SettingsBackupSection } from "./SettingsBackupSection";
import { SettingsSyncSection } from "./SettingsSyncSection";
import { SettingsExportSection } from "./SettingsExportSection";
import { SettingsAboutSection } from "./SettingsAboutSection";

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

        {!mobile && <SettingsExportSection onToast={onToast} />}

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
