import { useRef, useEffect } from "react";
import { MoreHorizontal, Moon, Sun } from "lucide-react";
import { layoutOptions } from "../../constants/taskConfig";
import { usePresence } from "../../hooks/usePresence";
import type { TaskLayout } from "../../types/database";
import type { ThemePreference } from "../../types/settings";
import { ViewMenu } from "../common/ViewMenu";

export function MainHeader({
  title,
  layout,
  theme,
  sortBy,
  showCompleted,
  onLayoutChange,
  onThemeToggle,
  onMenuToggle,
  menuOpen,
  onSortChange,
  onShowCompletedChange,
}: {
  title: string;
  taskCount: number;
  layout: TaskLayout;
  theme: ThemePreference;
  sortBy: import("../../types/database").TaskSortBy;
  showCompleted: boolean;
  onLayoutChange: (layout: TaskLayout) => void;
  onThemeToggle: () => void;
  onMenuToggle: () => void;
  menuOpen: boolean;
  onSortChange: (sortBy: import("../../types/database").TaskSortBy) => void;
  onShowCompletedChange: () => void;
}) {
  const menuPresence = usePresence(menuOpen, 180);
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

  const handleSortSelect = (newSortBy: import("../../types/database").TaskSortBy) => {
    onSortChange(newSortBy);
    onMenuToggle();
  };

  const handleShowCompletedToggle = () => {
    onShowCompletedChange();
    onMenuToggle();
  };

  return (
    <header className="main-header">
      <div className="main-header-left" style={{ display: "flex", alignItems: "center", gap: "16px" }}>
        <h1 style={{ margin: 0, fontSize: "18px", fontWeight: 700 }}>{title}</h1>
        <div className="layout-tabs" aria-label="布局切换">
          {layoutOptions.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.value}
                type="button"
                className={layout === item.value ? "active" : ""}
                onClick={() => onLayoutChange(item.value)}
              >
                <Icon aria-hidden="true" className="tab-icon" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="header-actions">
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
              sortBy={sortBy}
              showCompleted={showCompleted}
              presence={menuPresence.phase}
              onSortChange={handleSortSelect}
              onShowCompletedChange={handleShowCompletedToggle}
            />
          )}
        </div>
      </div>
    </header>
  );
}
