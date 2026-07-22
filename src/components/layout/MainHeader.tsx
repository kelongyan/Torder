import { MoreHorizontal, Moon, Sun } from "lucide-react";
import { layoutOptions } from "../../constants/taskConfig";
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
  return (
    <header className="main-header">
      <div>
        <h1>{title}</h1>
        <p>{taskCount} 项任务</p>
      </div>

      <div className="header-actions">
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
          {menuOpen && (
            <ViewMenu
              sortBy={sortBy}
              showCompleted={showCompleted}
              onSortChange={onSortChange}
              onShowCompletedChange={onShowCompletedChange}
            />
          )}
        </div>
      </div>
    </header>
  );
}
