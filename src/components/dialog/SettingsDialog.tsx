import { type ReactNode, useMemo, useState } from "react";
import {
  ArrowLeft,
  Bell,
  ChevronRight,
  Cloud,
  DatabaseBackup,
  Info,
  Keyboard,
  Palette,
  RotateCcw,
  Search,
  Settings,
  Settings2,
  SlidersHorizontal,
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
import type { AppSettings, SettingsPanelId } from "../../types/settings";
import type { TaskList } from "../../types/database";

type SettingsPanel = SettingsPanelId;

const settingsPanels = [
  {
    id: "general",
    title: "常规",
    description: "启动视图、备份与回收站、桌面行为",
    descriptionMobile: "启动视图、回收站清理与逾期顺延",
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
    descriptionMobile: "新建事项的默认清单、截止与优先级",
    icon: SlidersHorizontal,
    keywords: "默认清单 默认截止 默认优先级 速记 自然语言 新建 完成 归入已完成",
  },
  {
    id: "notifications",
    title: "提醒与通知",
    navTitle: "提醒",
    description: "系统通知、提示音与默认提前提醒",
    icon: Bell,
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
    icon: Keyboard,
    desktopOnly: true,
    keywords: "快捷键 键盘 ctrl 组合键",
  },
  {
    id: "about",
    title: "关于",
    description: "版本信息与更新",
    descriptionMobile: "版本信息与开源许可",
    icon: Info,
    keywords: "版本 更新 日志 许可 开源 关于",
  },
] satisfies Array<{
  id: SettingsPanel;
  title: string;
  navTitle?: string;
  description: string;
  /** 桌面专属描述（移动端隐藏了便签等能力时不能照抄）。 */
  descriptionDesktop?: string;
  /** 移动端描述（面板内容被裁剪后，描述也不能承诺桌面独有的项）。 */
  descriptionMobile?: string;
  icon: LucideIcon;
  desktopOnly?: boolean;
  keywords: string;
}>;

type PanelMeta = (typeof settingsPanels)[number];

function panelDescription(panel: PanelMeta, mobile: boolean): string {
  if (mobile) return panel.descriptionMobile ?? panel.description;
  return panel.descriptionDesktop ?? panel.description;
}

export function SettingsDialog({
  autoBackup,
  settings,
  lists,
  syncAutoEnabled,
  syncWifiOnly,
  externalSyncStatus,
  presence,
  activePanel,
  onActivePanelChange,
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
  /**
   * 当前面板。null = 移动端停在分类列表（桌面兜底到首个面板）。
   * 由 App 的 dialog 管理器持有，好让安卓系统返回能把二级面板当一层弹层退。
   */
  activePanel: SettingsPanel | null;
  onActivePanelChange: (panel: SettingsPanel | null) => void;
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
  const visiblePanels = settingsPanels.filter(
    (panel) => !panel.desktopOnly || !mobile,
  );
  // F2 · T-10：设置搜索——导航与面板按标题/描述/关键词过滤
  const [searchQuery, setSearchQuery] = useState("");
  const [resetRequested, setResetRequested] = useState(false);
  const resetConfirm = usePresence<boolean>(resetRequested, 220);
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
  const selectedMeta =
    visiblePanels.find((panel) => panel.id === activePanel) ?? null;

  async function handleResetConfirm() {
    try {
      const next = await resetAppSettings();
      onSettingsChange(next);
      onToast("已恢复默认设置", "success");
    } finally {
      setResetRequested(false);
    }
  }

  const resetConfirmDialog = (
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
  );

  function renderPanelBody(meta: PanelMeta): ReactNode {
    return (
      <div className="settings-panel">
        {meta.id === "general" && (
          <>
            <SettingsPreferencesSection
              settings={settings}
              onSettingsChange={onSettingsChange}
              onToast={onToast}
            />
            <SettingsDesktopSection onToast={onToast} />
          </>
        )}

        {meta.id === "appearance" && (
          <SettingsAppearanceSection
            settings={settings}
            onSettingsChange={onSettingsChange}
            onToast={onToast}
          />
        )}

        {/* F2 · T-10 甲组：事项默认值 / 提醒与通知 / 快捷键转正 */}
        {meta.id === "defaults" && (
          <SettingsDefaultsSection
            settings={settings}
            lists={lists}
            onSettingsChange={onSettingsChange}
            onToast={onToast}
          />
        )}

        {meta.id === "notifications" && (
          <SettingsNotificationsSection
            settings={settings}
            onSettingsChange={onSettingsChange}
            onToast={onToast}
          />
        )}

        {meta.id === "shortcuts" && <SettingsShortcutsSection />}

        {meta.id === "sync" && (
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

        {meta.id === "data" && !mobile && (
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

        {meta.id === "about" && (
          <>
            <SettingsAboutSection onToast={onToast} />
            {/* F2 · T-11：更新日志 / 开源许可转正 */}
            <SettingsAboutExtras />
          </>
        )}
      </div>
    );
  }

  const searchField = (
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
  );

  if (mobile) {
    return (
      <>
        <MobileSettings
          panels={filteredPanels}
          selected={selectedMeta}
          presence={presence}
          searchField={searchField}
          hasQuery={searchQuery.trim().length > 0}
          renderPanelBody={renderPanelBody}
          onSelect={onActivePanelChange}
          onRequestReset={() => setResetRequested(true)}
          onClose={onClose}
        />
        {resetConfirmDialog}
      </>
    );
  }

  // 搜索中若当前面板被过滤掉，落到第一个命中面板，保证内容与导航一致
  const desktopMeta = selectedMeta ?? visiblePanels[0];
  const effectiveMeta = filteredPanels.some(
    (panel) => panel.id === desktopMeta.id,
  )
    ? desktopMeta
    : (filteredPanels[0] ?? desktopMeta);

  return (
    <>
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
            {searchField}
            <nav className="settings-side-nav" role="tablist">
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
                    onClick={() => onActivePanelChange(panel.id)}
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
              <p>{panelDescription(effectiveMeta, false)}</p>
            </div>
            {renderPanelBody(effectiveMeta)}
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
      </DialogShell>

      {/* 确认框必须是 DialogShell 的兄弟节点：.dialog-card 带 will-change: transform，
          会成为 fixed 后代的包含块，嵌在里面的浮层会被它的 overflow: hidden 裁掉。 */}
      {resetConfirmDialog}
    </>
  );
}

/**
 * 移动端设置：底部 sheet 内的两级流。
 *
 * 一级是分类列表（每行「图标 + 标题 + 说明 + chevron」，触摸目标 ≥ 56px），
 * 二级是面板正文，头部左侧图标槽换成返回按钮。这样做的原因是原来的横向
 * Tab 条在 390px 宽下要塞 6 个分类，每格只剩约 22px，图标与标题会互相压字；
 * 而分类列表是移动端惯用形态，也与「我的」页的 m-nav-row 语言一致。
 */
function MobileSettings({
  panels,
  selected,
  presence,
  searchField,
  hasQuery,
  renderPanelBody,
  onSelect,
  onRequestReset,
  onClose,
}: {
  panels: readonly PanelMeta[];
  selected: PanelMeta | null;
  presence: PresencePhase;
  searchField: ReactNode;
  hasQuery: boolean;
  renderPanelBody: (meta: PanelMeta) => ReactNode;
  onSelect: (panel: SettingsPanel | null) => void;
  onRequestReset: () => void;
  onClose: () => void;
}) {
  if (selected) {
    return (
      <DialogShell
        title={selected.title}
        icon={selected.icon}
        width="800px"
        presence={presence}
        overlayClassName="settings-dialog settings-dialog-mobile"
        leading={
          <button
            type="button"
            className="icon-button settings-m-back"
            aria-label="返回设置分类"
            onClick={() => onSelect(null)}
          >
            <ArrowLeft aria-hidden="true" />
          </button>
        }
        onClose={onClose}
      >
        <div className="settings-m-body">
          <p className="settings-m-panel-hint">
            {panelDescription(selected, true)}
          </p>
          {renderPanelBody(selected)}
        </div>
      </DialogShell>
    );
  }

  return (
    <DialogShell
      title="设置"
      icon={Settings}
      width="800px"
      presence={presence}
      overlayClassName="settings-dialog settings-dialog-mobile"
      onClose={onClose}
    >
      <div className="settings-m-body">
        {searchField}
        {panels.length === 0 ? (
          <p className="settings-search-empty">没有匹配的设置项</p>
        ) : (
          <nav className="settings-m-list" aria-label="设置分类">
            {panels.map((panel) => {
              const Icon = panel.icon;
              return (
                <button
                  key={panel.id}
                  type="button"
                  className="settings-m-row"
                  onClick={() => onSelect(panel.id)}
                >
                  <span className="settings-m-row-icon">
                    <Icon aria-hidden="true" />
                  </span>
                  <span className="settings-m-row-copy">
                    <strong>{panel.title}</strong>
                    <span>{panelDescription(panel, true)}</span>
                  </span>
                  <ChevronRight
                    aria-hidden="true"
                    className="settings-m-row-chevron"
                  />
                </button>
              );
            })}
          </nav>
        )}
        {!hasQuery && (
          <button
            type="button"
            className="settings-m-reset"
            onClick={onRequestReset}
          >
            <RotateCcw aria-hidden="true" className="icon-xs" />
            恢复默认设置
          </button>
        )}
        <p className="settings-m-note">所有更改已自动保存到本机</p>
      </div>
    </DialogShell>
  );
}
