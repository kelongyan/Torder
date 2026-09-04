import { type CSSProperties, useMemo, useState } from "react";
import {
  Cloud,
  DatabaseBackup,
  Info,
  Palette,
  RotateCcw,
  Search,
  Settings,
  Settings2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { DialogShell } from "./DialogShell";
import { ConfirmDialog } from "./ConfirmDialog";
import { usePresence } from "../../hooks/usePresence";
import type { PresencePhase } from "../../hooks/usePresence";
import type { ToastKind } from "../../types/ui";
import type { SyncStatus } from "../../types/sync";
import { isMobile } from "../../utils/platform";
import { resetAppSettings } from "../../services/settingsService";
import { SettingsBackupSection } from "./SettingsBackupSection";
import { SettingsSyncSection } from "./SettingsSyncSection";
import { SettingsExportSection } from "./SettingsExportSection";
import { SettingsImportSection } from "./SettingsImportSection";
import { SettingsAboutSection } from "./SettingsAboutSection";
import { SettingsPreferencesSection } from "./SettingsPreferencesSection";
import { SettingsDesktopSection } from "./SettingsDesktopSection";
import { SettingsAppearanceSection } from "./SettingsAppearanceSection";
import { SettingsDefaultsSection } from "./SettingsDefaultsSection";
import { SettingsNotificationsSection } from "./SettingsNotificationsSection";
import { SettingsShortcutsSection } from "./SettingsShortcutsSection";
import { SettingsAboutExtras } from "./SettingsAboutExtras";
import type { AppSettings } from "../../types/settings";
import type { TaskList } from "../../types/database";

type SettingsPanel =
  | "general"
  | "appearance"
  | "defaults"
  | "notifications"
  | "sync"
  | "data"
  | "shortcuts"
  | "about";

const settingsPanels = [
  {
    id: "general",
    title: "常规",
    description: "启动视图、备份与回收站、桌面行为",
    icon: Settings2,
    keywords: "启动视图 备份 回收站 清理 开机 桌面",
  },
  {
    id: "appearance",
    title: "外观",
    description: "应用主题与强调色",
    descriptionDesktop: "应用主题、强调色与桌面便签外观",
    icon: Palette,
    keywords: "主题 深色 浅色 强调色 颜色 便签",
  },
  {
    id: "defaults",
    title: "事项默认值",
    description: "新建事项的默认清单、截止与优先级，以及完成后的归位方式",
    icon: Settings2,
    keywords: "默认清单 默认截止 默认优先级 速记 自然语言 新建 完成 归入已完成",
  },
  {
    id: "notifications",
    title: "提醒与通知",
    description: "系统通知、提示音与默认提前提醒",
    icon: Settings2,
    keywords: "通知 提醒 提示音 声音 静音 到期",
  },
  {
    id: "sync",
    title: "WebDAV 同步",
    navTitle: "同步",
    description: "账号、自动同步、设备与冲突",
    icon: Cloud,
    keywords: "同步 webdav 账号 设备 冲突",
  },
  {
    id: "data",
    title: "数据与备份",
    navTitle: "数据",
    description: "备份、恢复、导入和导出",
    icon: DatabaseBackup,
    desktopOnly: true,
    keywords: "备份 恢复 导入 导出 数据",
  },
  {
    id: "shortcuts",
    title: "快捷键",
    description: "全局、事项与视图快捷键速查",
    icon: Settings2,
    desktopOnly: true,
    keywords: "快捷键 键盘 ctrl 组合键",
  },
  {
    id: "about",
    title: "关于",
    description: "版本信息与更新",
    icon: Info,
    keywords: "版本 更新 日志 许可 开源 关于",
  },
] satisfies Array<{
  id: SettingsPanel;
  title: string;
  navTitle?: string;
  description: string;
  descriptionDesktop?: string;
  icon: LucideIcon;
  desktopOnly?: boolean;
  keywords: string;
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
  // F2 · T-10：设置搜索——导航与面板按标题/描述/关键词过滤
  const [searchQuery, setSearchQuery] = useState("");
  const [resetRequested, setResetRequested] = useState(false);
  const resetConfirm = usePresence<boolean>(resetRequested, 220);
  const visiblePanels = settingsPanels.filter(
    (panel) => !panel.desktopOnly || !mobile,
  );
  const filteredPanels = useMemo(() => {
    const query = searchQuery.trim();
    if (!query) return visiblePanels;
    const needle = query.toLowerCase();
    return visiblePanels.filter((panel) =>
      `${panel.title} ${panel.navTitle ?? ""} ${panel.description} ${panel.keywords}`
        .toLowerCase()
        .includes(needle),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, mobile]);
  const activeMeta =
    visiblePanels.find((panel) => panel.id === activePanel) ?? visiblePanels[0];
  // 搜索中若当前面板被过滤掉，落到第一个命中面板，保证内容与导航一致
  const effectiveMeta = filteredPanels.some(
    (panel) => panel.id === activeMeta.id,
  )
    ? activeMeta
    : (filteredPanels[0] ?? activeMeta);

  async function handleResetConfirm() {
    try {
      const next = await resetAppSettings();
      onSettingsChange(next);
      onToast("已恢复默认设置", "success");
    } finally {
      setResetRequested(false);
    }
  }

  return (
    <DialogShell
      title="设置"
      icon={Settings}
      width="800px"
      presence={presence}
      overlayClassName="settings-dialog"
      onClose={onClose}
    >
      <div className="settings-layout">
        <aside className="settings-sidebar" aria-label="设置分类">
          <label className="settings-search">
            <Search aria-hidden="true" className="icon-xs" />
            <input
              type="text"
              value={searchQuery}
              placeholder="搜索设置"
              aria-label="搜索设置"
              autoComplete="off"
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </label>
          <nav
            className="settings-side-nav"
            role="tablist"
            style={
              {
                "--settings-panel-count": filteredPanels.length,
              } as CSSProperties
            }
          >
            {filteredPanels.map((panel) => {
              const Icon = panel.icon;
              const selected = panel.id === effectiveMeta.id;
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
            {filteredPanels.length === 0 && (
              <p className="settings-search-empty">没有匹配的设置项</p>
            )}
          </nav>
        </aside>

        <div
          className="settings-content"
          role="tabpanel"
          aria-label={effectiveMeta.title}
        >
          <div className="settings-content-head">
            <h3>{effectiveMeta.title}</h3>
            <p>
              {mobile && effectiveMeta.descriptionDesktop
                ? effectiveMeta.description
                : effectiveMeta.descriptionDesktop ?? effectiveMeta.description}
            </p>
          </div>

          <div className="settings-panel">
            {effectiveMeta.id === "general" && (
              <>
                <SettingsPreferencesSection
                  settings={settings}
                  onSettingsChange={onSettingsChange}
                  onToast={onToast}
                />
                <SettingsDesktopSection onToast={onToast} />
              </>
            )}

            {effectiveMeta.id === "appearance" && (
              <SettingsAppearanceSection
                settings={settings}
                onSettingsChange={onSettingsChange}
                onToast={onToast}
              />
            )}

            {/* F2 · T-10 甲组：事项默认值 / 提醒与通知 / 快捷键转正 */}
            {effectiveMeta.id === "defaults" && (
              <SettingsDefaultsSection
                settings={settings}
                lists={lists}
                onSettingsChange={onSettingsChange}
                onToast={onToast}
              />
            )}

            {effectiveMeta.id === "notifications" && (
              <SettingsNotificationsSection
                settings={settings}
                onSettingsChange={onSettingsChange}
                onToast={onToast}
              />
            )}

            {effectiveMeta.id === "shortcuts" && <SettingsShortcutsSection />}

            {effectiveMeta.id === "sync" && (
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

            {effectiveMeta.id === "data" && !mobile && (
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

            {effectiveMeta.id === "about" && (
              <>
                <SettingsAboutSection onToast={onToast} />
                {/* F2 · T-11：更新日志 / 开源许可转正 */}
                <SettingsAboutExtras />
              </>
            )}
          </div>
        </div>
      </div>

      <footer className="dialog-footer settings-footer">
        <button
          type="button"
          className="settings-reset-button"
          onClick={() => setResetRequested(true)}
        >
          <RotateCcw aria-hidden="true" className="icon-xs" />
          恢复默认设置
        </button>
        <span className="settings-footer-note">所有更改已自动保存到本机</span>
        <button type="button" className="btn-secondary" onClick={onClose}>
          完成
        </button>
      </footer>

      <ConfirmDialog
        state={
          resetConfirm.rendered
            ? {
                title: "恢复默认设置？",
                body: "主题、强调色与各默认值将回到初始状态；任务、清单与同步配置不受影响。",
                confirmText: "恢复默认",
                onConfirm: handleResetConfirm,
              }
            : null
        }
        presence={resetConfirm.phase}
        onClose={() => setResetRequested(false)}
      />
    </DialogShell>
  );
}
