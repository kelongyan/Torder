import {
  Calendar,
  Filter,
  Plus,
  Repeat2,
  Search,
  Star,
  Tag,
  X,
  type LucideIcon,
} from "lucide-react";
import logoUrl from "../../assets/torder-logo.png";
import { DEFAULT_LIST_COLOR } from "../../constants/listConfig";
import { systemNav } from "../../constants/taskConfig";
import { taskViewCopy } from "../../constants/taskViews";
import { isScopeActive } from "../../utils/taskHelpers";
import { listScope, viewScope } from "../../stores/taskStore";
import type { TaskList, TaskScope } from "../../types/database";
import type { SavedTaskView, SavedViewIcon } from "../../types/settings";
import { SidebarItem } from "./SidebarItem";

const savedViewIcons: Record<SavedViewIcon, LucideIcon> = {
  filter: Filter,
  star: Star,
  calendar: Calendar,
  tag: Tag,
};

export function Sidebar({
  lists,
  scope,
  searchQuery,
  counts,
  savedViews,
  activeSavedViewId,
  onSearchChange,
  onScopeChange,
  onSavedViewOpen,
  onSavedViewAdd,
  onSavedViewEdit,
  onSavedViewDelete,
  onAddList,
  onEditList,
  onDeleteList,
  recurringActive,
  recurringCount,
  onOpenRecurring,
  onClose,
}: {
  lists: TaskList[];
  scope: TaskScope;
  searchQuery: string;
  counts: {
    views: Record<string, number>;
    lists: Record<string, number>;
  };
  savedViews: SavedTaskView[];
  activeSavedViewId: string | null;
  onSearchChange: (query: string) => void;
  onScopeChange: (scope: TaskScope) => void;
  onSavedViewOpen: (view: SavedTaskView) => void;
  onSavedViewAdd: () => void;
  onSavedViewEdit: (view: SavedTaskView) => void;
  onSavedViewDelete: (view: SavedTaskView) => void;
  onAddList: () => void;
  onEditList: (list: TaskList) => void;
  onDeleteList: (list: TaskList) => void;
  recurringActive: boolean;
  recurringCount: number;
  onOpenRecurring: () => void;
  onClose?: () => void;
}) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <img src={logoUrl} alt="" className="brand-logo" />
        <div>
          <div className="brand-title">Torder</div>
          <div className="brand-subtitle">待办清单</div>
        </div>
        {onClose && (
          <button
            type="button"
            className="drawer-close"
            onClick={onClose}
            aria-label="关闭导航"
            title="关闭导航"
          >
            <X aria-hidden="true" className="icon-sm" />
          </button>
        )}
      </div>

      <div className="search-box">
        <Search aria-hidden="true" className="search-icon" />
        <input
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="搜索"
          aria-label="搜索任务"
        />
        {searchQuery && (
          <button
            type="button"
            className="search-clear"
            onClick={() => onSearchChange("")}
            aria-label="清空搜索"
            title="清空搜索"
          >
            <X aria-hidden="true" />
          </button>
        )}
      </div>

      <nav className="sidebar-nav" aria-label="任务视图">
        <div className="nav-group-header">
          <span className="nav-group-label">导航</span>
        </div>
        {systemNav.map((item) => (
          <SidebarItem
            key={item.view}
            icon={item.icon}
            label={taskViewCopy[item.view].title}
            active={
              !recurringActive && isScopeActive(scope, viewScope(item.view))
            }
            count={
              item.view === "deleted"
                ? undefined
                : (counts.views[item.view] ?? 0)
            }
            onClick={() => onScopeChange(viewScope(item.view))}
          />
        ))}
        <SidebarItem
          icon={Repeat2}
          label="循环任务"
          active={recurringActive}
          count={recurringCount}
          onClick={onOpenRecurring}
        />

        <div className="sidebar-divider" />
        <div className="nav-group-header">
          <span className="nav-group-label">保存视图</span>
          <button
            type="button"
            className="btn-add-list"
            onClick={onSavedViewAdd}
            title="保存当前筛选"
            aria-label="保存当前筛选"
          >
            <Plus className="icon-xs" />
          </button>
        </div>
        {savedViews.map((view) => (
          <SidebarItem
            key={view.id}
            icon={savedViewIcons[view.icon]}
            label={view.name}
            active={!recurringActive && activeSavedViewId === view.id}
            onClick={() => onSavedViewOpen(view)}
            onEdit={() => onSavedViewEdit(view)}
            onDelete={() => onSavedViewDelete(view)}
            editLabel="编辑保存视图"
            deleteLabel="删除保存视图"
          />
        ))}

        <div className="sidebar-divider" />
        <div className="nav-group-header">
          <span className="nav-group-label">我的清单</span>
          <button
            type="button"
            className="btn-add-list"
            onClick={onAddList}
            title="新建自定义清单"
            aria-label="新建自定义清单"
          >
            <Plus className="icon-xs" />
          </button>
        </div>
        {lists.map((list) => (
          <SidebarItem
            key={list.id}
            color={list.color ?? DEFAULT_LIST_COLOR}
            label={list.name}
            active={
              !recurringActive && isScopeActive(scope, listScope(list.id))
            }
            count={counts.lists[list.id] ?? 0}
            onClick={() => onScopeChange(listScope(list.id))}
            onEdit={!list.isDefault ? () => onEditList(list) : undefined}
            onDelete={!list.isDefault ? () => onDeleteList(list) : undefined}
          />
        ))}
      </nav>
    </aside>
  );
}
