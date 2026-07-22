import { Plus, Search } from "lucide-react";
import logoUrl from "../../assets/torder-logo.png";
import { systemNav } from "../../constants/taskConfig";
import { taskViewCopy } from "../../app/taskViews";
import { isScopeActive } from "../../utils/taskHelpers";
import { listScope, viewScope } from "../../stores/taskStore";
import type { TaskList, TaskScope } from "../../types/database";
import { SidebarItem } from "./SidebarItem";

export function Sidebar({
  lists,
  scope,
  searchQuery,
  counts,
  onSearchChange,
  onScopeChange,
  onNewList,
}: {
  lists: TaskList[];
  scope: TaskScope;
  searchQuery: string;
  counts: {
    views: Record<string, number>;
    lists: Record<string, number>;
  };
  onSearchChange: (query: string) => void;
  onScopeChange: (scope: TaskScope) => void;
  onNewList: () => void;
}) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <img src={logoUrl} alt="" className="brand-logo" />
        <div>
          <div className="brand-title">Torder</div>
          <div className="brand-subtitle">待办清单</div>
        </div>
      </div>

      <label className="search-box">
        <Search aria-hidden="true" className="icon-sm" />
        <input
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="搜索任务..."
          aria-label="搜索任务"
        />
      </label>

      <nav className="sidebar-nav" aria-label="任务视图">
        <div className="nav-group-label">导航</div>
        {systemNav.map((item) => (
          <SidebarItem
            key={item.view}
            icon={item.icon}
            label={taskViewCopy[item.view].title}
            active={isScopeActive(scope, viewScope(item.view))}
            count={counts.views[item.view] ?? 0}
            onClick={() => onScopeChange(viewScope(item.view))}
          />
        ))}

        <div className="sidebar-divider" />
        <div className="nav-group-label">我的清单</div>
        {lists.map((list) => (
          <SidebarItem
            key={list.id}
            color={list.color ?? "#6366f1"}
            label={list.name}
            active={isScopeActive(scope, listScope(list.id))}
            count={counts.lists[list.id] ?? 0}
            onClick={() => onScopeChange(listScope(list.id))}
          />
        ))}
      </nav>

      <button
        type="button"
        className="new-list-button"
        onClick={onNewList}
      >
        <Plus aria-hidden="true" className="icon-sm" />
        新建清单
      </button>
    </aside>
  );
}
