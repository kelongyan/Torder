import {
  Calendar,
  ChevronLeft,
  ChevronRight,
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
import {
  toggleSidebarCollapsed,
  useSidebarCollapsed,
} from "../../hooks/useSidebarCollapsed";

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
  tags,
  activeTags,
  onTagToggle,
  onClearTags,
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
  /** T-07：在用标签及其任务数（App 层从 allTasks 聚合）。 */
  tags: Array<{ tag: string; count: number }>;
  activeTags: string[];
  onTagToggle: (tag: string) => void;
  onClearTags: () => void;
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
  const collapsed = useSidebarCollapsed();

  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="brand">
        <img src={logoUrl} alt="" className="brand-logo" />
        <div className="brand-text">
          <div className="brand-title">Torder</div>
          <div className="brand-subtitle">待办清单</div>
        </div>
        <button
          type="button"
          className="brand-collapse"
          onClick={toggleSidebarCollapsed}
          aria-label={collapsed ? "展开侧栏" : "折叠侧栏"}
          title={collapsed ? "展开侧栏 (Ctrl B)" : "折叠侧栏 (Ctrl B)"}
        >
          {collapsed ? (
            <ChevronRight aria-hidden="true" className="icon-sm" />
          ) : (
            <ChevronLeft aria-hidden="true" className="icon-sm" />
          )}
        </button>
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

      {collapsed ? (
        <button
          type="button"
          className="search-box collapsed-search"
          onClick={toggleSidebarCollapsed}
          aria-label="展开侧栏并搜索"
          title="展开侧栏并搜索"
        >
          <Search aria-hidden="true" className="search-icon" />
        </button>
      ) : (
        <div className="search-box">
          <Search aria-hidden="true" className="search-icon" />
          <input
            id="sidebar-search-input"
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="搜索"
            aria-label="搜索任务"
          />
          <kbd className="search-kbd" aria-hidden="true">
            Ctrl F
          </kbd>
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
      )}

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
            alert={item.view === "overdue" && (counts.views[item.view] ?? 0) > 0}
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

        {/*
          F1 · T-07 标签分组：从在用标签聚合而来，点击切换 filter.tags 过滤。
          按方案书 Q2 定稿不设「新建标签」入口——标签在事项录入时自然产生。
          无标签时整组不渲染，避免出现一个永远空的分组。
        */}
        {tags.length > 0 && (
          <>
            <div className="sidebar-divider" />
            <div className="nav-group-header">
              <span className="nav-group-label">标签</span>
              {activeTags.length > 0 && (
                <button
                  type="button"
                  className="btn-add-list"
                  onClick={onClearTags}
                  title="清除标签筛选"
                  aria-label="清除标签筛选"
                >
                  <X className="icon-xs" />
                </button>
              )}
            </div>
            {tags.map((item) => (
              <SidebarItem
                key={item.tag}
                icon={Tag}
                label={item.tag}
                active={activeTags.includes(item.tag)}
                count={item.count}
                onClick={() => onTagToggle(item.tag)}
              />
            ))}
          </>
        )}
      </nav>
    </aside>
  );
}
