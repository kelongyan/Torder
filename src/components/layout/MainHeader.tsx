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

  return (
    <header className="main-header">
      <div className="main-header-left" style={{ display: "flex", alignItems: "center", gap: "16px" }}>
        <h1 style={{ margin: 0, fontSize: "18px", fontWeight: 700 }}>{title}</h1>
        <div className="layout-tabs" aria-label="布局切换">
          {layoutOptions.map((item) => (
            <button
              key={item.value}
              type="button"
              className={layout === item.value ? "active" : ""}
              onClick={() => onLayoutChange(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="header-actions">
        <button
          type="button"
          className="icon-button"
          onClick={onThemeToggle}
          aria-label="切换主题"
          title="切换主题"
        >
          {theme === "dark" ? (
            <Sun aria-hidden="true" />
          ) : (
            <Moon aria-hidden="true" />
          )}
        </button>

        <div className="menu-anchor">
          <button
            type="button"
            className="icon-button"
            onClick={onMenuToggle}
            aria-label="更多设置"
            aria-expanded={menuOpen}
          >
            <MoreHorizontal aria-hidden="true" />
          </button>
          {menuPresence.rendered && (
            <ViewMenu
              sortBy={sortBy}
              showCompleted={showCompleted}
              presence={menuPresence.phase}
              onSortChange={onSortChange}
              onShowCompletedChange={onShowCompletedChange}
            />
          )}
        </div>
      </div>
    </header>
  );
}
