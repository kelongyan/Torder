import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownUp,
  Cloud,
  CloudAlert,
  CloudOff,
  Filter,
  Menu,
  MoreHorizontal,
  Moon,
  Plus,
  RefreshCw,
  Sun,
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
  syncStatus,
  showLayoutControls = true,
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
  syncStatus: SyncStatus | null;
  showLayoutControls?: boolean;
}) {
  const menuPresence = usePresence(menuOpen, 280);
  const menuAnchorRef = useRef<HTMLDivElement>(null);
  const [sortOpen, setSortOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const sortPresence = usePresence(sortOpen, 280);
  const filterPresence = usePresence(filterOpen, 280);
  const sortAnchorRef = useRef<HTMLDivElement>(null);
  const filterAnchorRef = useRef<HTMLDivElement>(null);

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
      className={`main-header ${showLayoutControls ? "" : "no-layout-tabs"} ${syncStatus?.configured ? "has-sync-status" : ""}`}
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
        className={`header-actions ${showLayoutControls ? "" : "no-layout-tabs"}`}
      >
        {showLayoutControls && (
          <div className="header-view-toolbar">
            {onOpenCreate && (
              <button
                type="button"
                className="header-create-button"
                onClick={onOpenCreate}
              >
                <Plus aria-hidden="true" className="icon-sm" />
                <span>新建</span>
              </button>
            )}

            <div className="layout-tabs" aria-label="布局切换">
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
            aria-label={filterCount > 0 ? `筛选 · ${filterCount} 个条件` : "筛选"}
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
    </header>
  );
}
