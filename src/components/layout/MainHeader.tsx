import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowDownUp,
  CheckSquare,
  Cloud,
  CloudAlert,
  CloudOff,
  Command,
  Filter,
  Flame,
  Menu,
  MoreHorizontal,
  Moon,
  Plus,
  RefreshCw,
  Sparkles,
  Sun,
  TrendingUp,
} from "lucide-react";
import logoUrl from "../../assets/torder-logo.png";
import { layoutOptions } from "../../constants/taskConfig";
import { usePresence } from "../../hooks/usePresence";
import type { TaskFilter, TaskLayout, TaskList } from "../../types/database";
import type { TaskSortBy } from "../../types/database";
import type { ThemePreference } from "../../types/settings";
import type { SyncStatus } from "../../types/sync";
import { FilterPanel } from "../common/FilterPanel";
import { SortMenu } from "../common/SortMenu";
import { ViewMenu } from "../common/ViewMenu";

export function MainHeader({
  title,
  meta,
  taskCount,
  layout,
  theme,
  sortBy,
  sortAsc,
  filter,
  filterCount,
  lists,
  tags,
  showCompleted,
  batchMode,
  onOpenSidebar,
  onOpenCreate,
  onLayoutChange,
  onThemeToggle,
  onMenuToggle,
  menuOpen,
  onSortChange,
  onSortAscToggle,
  onToggleFilterList,
  onToggleFilterTag,
  onToggleFilterPriority,
  onToggleFilterCompleted,
  onClearFilter,
  onShowCompletedChange,
  onOpenSettings,
  onOpenStats,
  onOpenCommandPalette,
  onToggleBatchMode,
  syncStatus,
  showLayoutControls = true,
  detailOpen = false,
  headerHidden = false,
}: {
  title: string;
  meta?: string | ReactNode | null;
  taskCount: number;
  layout: TaskLayout;
  theme: ThemePreference;
  sortBy: TaskSortBy;
  sortAsc: boolean;
  filter: TaskFilter;
  filterCount: number;
  lists: TaskList[];
  tags: string[];
  showCompleted: boolean;
  batchMode: boolean;
  onOpenSidebar?: () => void;
  onOpenCreate?: () => void;
  onLayoutChange: (layout: TaskLayout) => void;
  onThemeToggle: () => void;
  onMenuToggle: () => void;
  menuOpen: boolean;
  onSortChange: (sortBy: TaskSortBy) => void;
  onSortAscToggle: () => void;
  onToggleFilterList: (listId: string) => void;
  onToggleFilterTag: (tag: string) => void;
  onToggleFilterPriority: (priority: 0 | 1 | 2) => void;
  onToggleFilterCompleted: () => void;
  onClearFilter: () => void;
  onShowCompletedChange: () => void;
  onOpenSettings: () => void;
  onOpenStats: () => void;
  /** F2 · T-01：命令面板（Ctrl K / 图标）。 */
  onOpenCommandPalette: () => void;
  onToggleBatchMode: () => void;
  syncStatus: SyncStatus | null;
  showLayoutControls?: boolean;
  /** R6：详情抽屉打开时头部工具收紧（占位组隐藏、分段图标化），避免溢出到抽屉下方。 */
  detailOpen?: boolean;
  /** M3.2 移动端滚动折叠：向下滚动内容时整个主 header 收起（顶部滑出），true 表示收起。 */
  headerHidden?: boolean;
}) {
  const menuPresence = usePresence(menuOpen, 280);
  const menuAnchorRef = useRef<HTMLDivElement>(null);
  const [sortOpen, setSortOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const sortPresence = usePresence(sortOpen, 280);
  const filterPresence = usePresence(filterOpen, 280);
  const sortAnchorRef = useRef<HTMLDivElement>(null);
  const filterAnchorRef = useRef<HTMLDivElement>(null);

  // D11 滑动拇指分段：拇指滑到当前选中项下方（非列表/看板视图无选中时隐藏）
  const segRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState({ x: 0, w: 0, on: false });
  useLayoutEffect(() => {
    const el = segRef.current;
    if (!el) return;
    const update = () => {
      const active = el.querySelector<HTMLButtonElement>(
        ".layout-tabs button.active",
      );
      if (!active) {
        setThumb((prev) => ({ ...prev, on: false }));
        return;
      }
      setThumb({ x: active.offsetLeft, w: active.offsetWidth, on: true });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [layout, showLayoutControls]);

  useEffect(() => {
    if (!menuOpen) return;

    const handlePointerDownOutside = (event: PointerEvent) => {
      if (
        menuAnchorRef.current &&
        !menuAnchorRef.current.contains(event.target as Node)
      ) {
        onMenuToggle();
      }
    };

    document.addEventListener("pointerdown", handlePointerDownOutside);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDownOutside);
    };
  }, [menuOpen, onMenuToggle]);

  // R04：排序与筛选是两个独立浮层，点外部 / Esc 各自收起，互不影响 ··· 主菜单
  useEffect(() => {
    if (!sortOpen && !filterOpen) return;

    const handlePointerDownOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        sortOpen &&
        sortAnchorRef.current &&
        !sortAnchorRef.current.contains(target)
      ) {
        setSortOpen(false);
      }
      if (
        filterOpen &&
        filterAnchorRef.current &&
        !filterAnchorRef.current.contains(target)
      ) {
        setFilterOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSortOpen(false);
      setFilterOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDownOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDownOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [filterOpen, sortOpen]);

  const handleSortSelect = (newSortBy: TaskSortBy) => {
    onSortChange(newSortBy);
    setSortOpen(false);
  };

  const handleDirectionToggle = () => {
    onSortAscToggle();
  };

  const handleShowCompletedToggle = () => {
    onShowCompletedChange();
    onMenuToggle();
  };

  const handleLayoutSelect = (nextLayout: TaskLayout) => {
    onLayoutChange(nextLayout);
    onMenuToggle();
  };

  const currentLayoutLabel =
    layoutOptions.find((item) => item.value === layout)?.label ?? "列表";
  const headerMeta =
    meta === undefined ? `${taskCount} 项 · ${currentLayoutLabel}` : meta;
  const SyncIcon =
    syncStatus?.state === "syncing"
      ? RefreshCw
      : syncStatus?.state === "error" ||
          syncStatus?.state === "needsAuth" ||
          syncStatus?.state === "incompatible" ||
          syncStatus?.state === "needsConflict"
        ? CloudAlert
        : syncStatus?.state === "disabled"
          ? CloudOff
          : Cloud;
  const syncLabel = syncStatus
    ? syncStatus.conflictCount > 0
      ? `${syncStatus.conflictCount} 个同步冲突待处理`
      : syncStatus.state === "syncing"
        ? "正在同步"
        : syncStatus.state === "success"
          ? "同步正常"
          : syncStatus.lastError || "查看同步设置"
    : "查看同步设置";

  return (
    <header
      className={`main-header ${showLayoutControls ? "" : "no-layout-tabs"} ${syncStatus?.configured ? "has-sync-status" : ""} ${headerHidden ? "is-collapsed" : ""}`}
    >
      <button
        type="button"
        className="icon-button mobile-nav-toggle"
        onClick={onOpenSidebar}
        aria-label="打开导航"
        title="打开导航"
      >
        <Menu aria-hidden="true" className="menu-icon" />
      </button>

      <div className="main-header-left">
        <img src={logoUrl} alt="" className="main-header-logo" />
        <div className="main-header-copy">
          <h1>{title}</h1>
          {headerMeta && <p>{headerMeta}</p>}
        </div>
      </div>

      <div
        className={`header-actions ${showLayoutControls ? "" : "no-layout-tabs"} ${detailOpen ? "compact" : ""}`}
      >
        {/* 分组一：视图工具（布局分段 / 排序 / 筛选 / 批量 / 命令 / 未开发占位）。
            桌面端 display:contents 保持既有展平布局；移动端独立为工具行（M1.1）。 */}
        <div className="header-tools">
          {showLayoutControls && (
            <div className="header-view-toolbar">
              <div className="layout-tabs" aria-label="布局切换" ref={segRef}>
                {/* D11 滑动拇指：选中项浮起卡片，切换时 160ms 平移 */}
                <span
                  className="seg-thumb"
                  aria-hidden="true"
                  style={{
                    transform: `translateX(${thumb.x}px)`,
                    width: `${thumb.w}px`,
                    opacity: thumb.on ? 1 : 0,
                  }}
                />
                {/* D10（用户拍板，推翻 D9）：5 种布局全部分段展示，按设计稿 seg 规格收紧排布 */}
                {layoutOptions.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      className={layout === item.value ? "active" : ""}
                      onClick={() => onLayoutChange(item.value)}
                      aria-label={`切换到${item.label}`}
                      title={item.label}
                    >
                      <Icon aria-hidden="true" className="tab-icon" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="menu-anchor" ref={sortAnchorRef}>
            <button
              type="button"
              className={`icon-button sort-menu-btn ${sortOpen ? "active" : ""} ${sortAsc ? "" : "is-desc"}`}
              onClick={() => setSortOpen((open) => !open)}
              aria-label="排序"
              title={`排序 · 当前${sortAsc ? "升序" : "降序"}`}
              aria-expanded={sortOpen}
            >
              <ArrowDownUp aria-hidden="true" className="menu-icon" />
            </button>
            {sortPresence.rendered && (
              <SortMenu
                sortBy={sortBy}
                sortAsc={sortAsc}
                presence={sortPresence.phase}
                onSortChange={handleSortSelect}
                onDirectionToggle={handleDirectionToggle}
              />
            )}
          </div>

          <div className="menu-anchor" ref={filterAnchorRef}>
            <button
              type="button"
              className={`icon-button filter-panel-btn ${filterOpen ? "active" : ""} ${filterCount > 0 ? "has-filter" : ""}`}
              onClick={() => setFilterOpen((open) => !open)}
              aria-label={
                filterCount > 0 ? `筛选 · ${filterCount} 个条件` : "筛选"
              }
              title={filterCount > 0 ? `筛选 · ${filterCount} 个条件` : "筛选"}
              aria-expanded={filterOpen}
            >
              <Filter aria-hidden="true" className="menu-icon" />
            </button>
            {filterPresence.rendered && (
              <FilterPanel
                lists={lists}
                tags={tags}
                filter={filter}
                presence={filterPresence.phase}
                onToggleList={onToggleFilterList}
                onToggleTag={onToggleFilterTag}
                onTogglePriority={onToggleFilterPriority}
                onToggleCompleted={onToggleFilterCompleted}
                onClear={onClearFilter}
              />
            )}
          </div>

          {showLayoutControls && (
            <button
              type="button"
              className={`icon-button batch-toggle-btn ${batchMode ? "active" : ""}`}
              onClick={onToggleBatchMode}
              aria-label="批量选择"
              title="批量选择 (B)"
              aria-pressed={batchMode}
            >
              <CheckSquare aria-hidden="true" className="menu-icon" />
            </button>
          )}

          {/* F2 · T-01 命令面板：已接通（Ctrl K / 图标） */}
          <button
            type="button"
            className="icon-button"
            aria-label="命令面板"
            title="命令面板 (Ctrl K)"
            onClick={onOpenCommandPalette}
          >
            <Command aria-hidden="true" className="menu-icon" />
          </button>
          {/* T-02~T-04 · 迷你窗/每日回顾/专注模式：未开发，纯灰显占位（§13 规则 4） */}
          <div className="tool-group tool-group--soon">
            <button
              type="button"
              className="icon-button ui-placeholder"
              aria-disabled="true"
              tabIndex={-1}
              aria-label="迷你窗"
            >
              <Sparkles aria-hidden="true" className="menu-icon" />
            </button>
            <button
              type="button"
              className="icon-button ui-placeholder"
              aria-disabled="true"
              tabIndex={-1}
              aria-label="每日回顾"
            >
              <TrendingUp aria-hidden="true" className="menu-icon" />
            </button>
            <button
              type="button"
              className="icon-button ui-placeholder"
              aria-disabled="true"
              tabIndex={-1}
              aria-label="专注模式"
            >
              <Flame aria-hidden="true" className="menu-icon" />
            </button>
          </div>
        </div>

        {/* 分组二：应用操作（主题 / 同步状态 / 更多）。桌面 display:contents；移动端主行。 */}
        <div className="header-app">
          <div className="tool-group tool-group--app">
            <button
              type="button"
              className="icon-button theme-toggle-btn"
              onClick={onThemeToggle}
              aria-label="切换主题"
              title="切换主题"
            >
              {theme === "dark" ? (
                <Sun aria-hidden="true" className="theme-icon sun" />
              ) : (
                <Moon aria-hidden="true" className="theme-icon moon" />
              )}
            </button>

            {syncStatus?.configured && (
              <button
                type="button"
                className={`icon-button sync-status-button state-${syncStatus.state}`}
                onClick={onOpenSettings}
                aria-label={syncLabel}
                title={syncLabel}
              >
                <SyncIcon
                  aria-hidden="true"
                  className={`sync-status-icon ${syncStatus.state === "syncing" ? "is-spinning" : ""}`}
                />
                {syncStatus.conflictCount > 0 && (
                  <span className="sync-status-count">
                    {Math.min(syncStatus.conflictCount, 99)}
                  </span>
                )}
              </button>
            )}

            <div className="menu-anchor" ref={menuAnchorRef}>
              <button
                type="button"
                className={`icon-button menu-toggle-btn ${menuOpen ? "active" : ""}`}
                onClick={onMenuToggle}
                aria-label="更多设置"
                aria-expanded={menuOpen}
              >
                <MoreHorizontal aria-hidden="true" className="menu-icon" />
              </button>
              {menuPresence.rendered && (
                <ViewMenu
                  layout={showLayoutControls ? layout : undefined}
                  sortBy={sortBy}
                  showCompleted={showCompleted}
                  presence={menuPresence.phase}
                  onLayoutChange={
                    showLayoutControls ? handleLayoutSelect : undefined
                  }
                  onSortChange={handleSortSelect}
                  onShowCompletedChange={handleShowCompletedToggle}
                  onOpenSettings={onOpenSettings}
                  onOpenStats={onOpenStats}
                />
              )}
            </div>
          </div>
        </div>

        {showLayoutControls && onOpenCreate && (
          <button
            type="button"
            className="header-create-button"
            onClick={onOpenCreate}
            aria-label="新建事项"
            title="新建事项（Ctrl+N）"
          >
            <Plus aria-hidden="true" />
          </button>
        )}
      </div>
    </header>
  );
}
