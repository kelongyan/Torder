import { useRef, useEffect } from "react";
import { Menu, MoreHorizontal, Moon, Plus, Sun } from "lucide-react";
import logoUrl from "../../assets/torder-logo.png";
import { layoutOptions } from "../../constants/taskConfig";
import { usePresence } from "../../hooks/usePresence";
import type { TaskLayout } from "../../types/database";
import type { ThemePreference } from "../../types/settings";
import { ViewMenu } from "../common/ViewMenu";

export function MainHeader({
  title,
  taskCount,
  layout,
  theme,
  sortBy,
  showCompleted,
  onOpenSidebar,
  onOpenCreate,
  onLayoutChange,
  onThemeToggle,
  onMenuToggle,
  menuOpen,
  onSortChange,
  onShowCompletedChange,
  onOpenSettings,
  onOpenStats,
  showLayoutControls = true,
}: {
  title: string;
  taskCount: number;
  layout: TaskLayout;
  theme: ThemePreference;
  sortBy: import("../../types/database").TaskSortBy;
  showCompleted: boolean;
  onOpenSidebar?: () => void;
  onOpenCreate?: () => void;
  onLayoutChange: (layout: TaskLayout) => void;
  onThemeToggle: () => void;
  onMenuToggle: () => void;
  menuOpen: boolean;
  onSortChange: (sortBy: import("../../types/database").TaskSortBy) => void;
  onShowCompletedChange: () => void;
  onOpenSettings: () => void;
  onOpenStats: () => void;
  showLayoutControls?: boolean;
}) {
  const menuPresence = usePresence(menuOpen, 280);
  const menuAnchorRef = useRef<HTMLDivElement>(null);

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

  const handleSortSelect = (
    newSortBy: import("../../types/database").TaskSortBy,
  ) => {
    onSortChange(newSortBy);
    onMenuToggle();
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

  return (
    <header
      className={`main-header ${showLayoutControls ? "" : "no-layout-tabs"}`}
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
          <p>
            {taskCount} 项 · {currentLayoutLabel}
          </p>
        </div>
      </div>

      {onOpenCreate && (
        <button
          type="button"
          className="icon-button mobile-create-button"
          onClick={onOpenCreate}
          aria-label="新建任务"
          title="新建任务"
        >
          <Plus aria-hidden="true" className="menu-icon" />
        </button>
      )}

      <div
        className={`header-actions ${showLayoutControls ? "" : "no-layout-tabs"}`}
      >
        {showLayoutControls && (
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
        )}

        <button
          type="button"
          className="icon-button theme-toggle-btn"
          onClick={onThemeToggle}
          aria-label="切换主题"
          title={`当前主题: ${theme === "dark" ? "暗色" : "亮色"}，点击切换`}
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
