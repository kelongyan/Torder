import {
  CalendarDays,
  CircleCheckBig,
  ListFilter,
  ListTodo,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings2,
  TriangleAlert,
} from "lucide-react";
import torderLogo from "../../assets/torder-logo.png";
import type { TaskView } from "../../types/database";

interface AppSidebarProps {
  view: TaskView;
  activeSection: "tasks" | "settings";
  activeQuickAction: "add" | "search" | "filters" | null;
  hasSearchQuery: boolean;
  filterCount: number;
  collapsed: boolean;
  onSelectView: (view: TaskView) => void;
  onOpenQuickAdd: () => void;
  onOpenSearch: () => void;
  onOpenFilters: () => void;
  onOpenSettings: () => void;
  onToggleCollapse: () => void;
}

const views: Array<{
  id: TaskView;
  label: string;
  icon: typeof CalendarDays;
}> = [
  { id: "today", label: "今日", icon: CalendarDays },
  { id: "all", label: "全部任务", icon: ListTodo },
  { id: "completed", label: "已完成", icon: CircleCheckBig },
  { id: "overdue", label: "过期", icon: TriangleAlert },
];

export function AppSidebar({
  view,
  activeSection,
  activeQuickAction,
  hasSearchQuery,
  filterCount,
  collapsed,
  onSelectView,
  onOpenQuickAdd,
  onOpenSearch,
  onOpenFilters,
  onOpenSettings,
  onToggleCollapse,
}: AppSidebarProps) {
  return (
    <>
      {/* ── Desktop sidebar ── */}
      <aside
        className={`glass-sidebar hidden shrink-0 flex-col shadow-[1px_0_8px_rgba(0,0,0,0.04)] transition-[width] duration-[var(--duration-normal)] ease-[var(--ease-out-expo)] md:flex ${
          collapsed ? "w-16" : "w-[200px]"
        }`}
      >
        {/* Logo */}
        <div
          className={`flex h-14 shrink-0 items-center border-b border-[var(--glass-border-muted)] ${
            collapsed ? "justify-center px-0" : "gap-2.5 px-4"
          }`}
        >
          <img
            src={torderLogo}
            alt=""
            aria-hidden="true"
            className="size-8 shrink-0 rounded-lg shadow-sm shadow-black/10 ring-1 ring-white/60 dark:shadow-black/40 dark:ring-white/10"
          />
          {!collapsed && (
            <span className="text-sm font-semibold tracking-tight text-[var(--text-primary)]">
              今序
            </span>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="智能视图">
          <div className="space-y-0.5">
            {views.slice(0, 2).map((item) => (
              <NavItem
                key={item.id}
                icon={item.icon}
                label={item.label}
                active={activeSection === "tasks" && item.id === view}
                collapsed={collapsed}
                onClick={() => onSelectView(item.id)}
              />
            ))}
          </div>

          {/* Action buttons */}
          <div
            className="my-2 space-y-0.5 border-y border-[var(--glass-border-muted)] py-2"
            role="toolbar"
            aria-label="任务操作"
          >
            <NavItem
              icon={Plus}
              label="新建事项"
              shortcut="Ctrl+N"
              active={activeQuickAction === "add"}
              primary
              collapsed={collapsed}
              onClick={onOpenQuickAdd}
              ariaExpanded={activeQuickAction === "add"}
            />
            <NavItem
              icon={Search}
              label="搜索事项"
              shortcut="Ctrl+F"
              active={activeQuickAction === "search" || hasSearchQuery}
              collapsed={collapsed}
              onClick={onOpenSearch}
              ariaExpanded={activeQuickAction === "search"}
              dot={hasSearchQuery && activeQuickAction !== "search"}
            />
            <NavItem
              icon={ListFilter}
              label="筛选事项"
              active={activeQuickAction === "filters" || filterCount > 0}
              collapsed={collapsed}
              onClick={onOpenFilters}
              ariaExpanded={activeQuickAction === "filters"}
              badge={filterCount > 0 ? filterCount : undefined}
            />
          </div>

          <div className="space-y-0.5">
            {views.slice(2).map((item) => (
              <NavItem
                key={item.id}
                icon={item.icon}
                label={item.label}
                active={activeSection === "tasks" && item.id === view}
                collapsed={collapsed}
                onClick={() => onSelectView(item.id)}
              />
            ))}
          </div>
        </nav>

        {/* Bottom: settings + collapse toggle */}
        <div className="shrink-0 space-y-0.5 border-t border-[var(--glass-border-muted)] px-2 py-2">
          <NavItem
            icon={Settings2}
            label="设置"
            shortcut="Ctrl+,"
            active={activeSection === "settings"}
            collapsed={collapsed}
            onClick={onOpenSettings}
          />
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? "展开侧边栏" : "折叠侧边栏"}
            title={collapsed ? "展开侧边栏" : "折叠侧边栏"}
            className="group flex w-full items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-2 text-[var(--text-muted)] transition-colors duration-[var(--duration-fast)] hover:bg-[var(--glass-control)] hover:text-[var(--text-secondary)]"
          >
            {collapsed ? (
              <PanelLeftOpen aria-hidden="true" className="size-4.5 shrink-0" />
            ) : (
              <>
                <PanelLeftClose
                  aria-hidden="true"
                  className="size-4.5 shrink-0"
                />
                <span className="text-[13px] leading-5">折叠</span>
              </>
            )}
          </button>
        </div>
      </aside>

      {/* ── Mobile top bar ── */}
      <aside className="glass-sidebar flex items-center justify-between border-b border-[var(--glass-border-muted)] px-2.5 py-2 md:hidden">
        <img
          src={torderLogo}
          alt=""
          aria-hidden="true"
          className="size-7 shrink-0 rounded-lg"
        />
        <div className="flex items-center gap-0.5">
          {/* Views */}
          <nav className="flex items-center gap-0.5" aria-label="智能视图">
            {views.map((item) => (
              <MobileIconButton
                key={item.id}
                icon={item.icon}
                label={item.label}
                active={activeSection === "tasks" && item.id === view}
                onClick={() => onSelectView(item.id)}
              />
            ))}
          </nav>

          {/* Separator */}
          <span
            aria-hidden="true"
            className="mx-1 h-4 w-px bg-[var(--glass-border-muted)]"
          />

          {/* Actions */}
          <div
            className="flex items-center gap-0.5"
            role="toolbar"
            aria-label="任务操作"
          >
            <MobileIconButton
              icon={Plus}
              label="新建事项"
              active={activeQuickAction === "add"}
              onClick={onOpenQuickAdd}
            />
            <MobileIconButton
              icon={Search}
              label="搜索事项"
              active={activeQuickAction === "search" || hasSearchQuery}
              onClick={onOpenSearch}
            />
            <MobileIconButton
              icon={ListFilter}
              label="筛选事项"
              active={activeQuickAction === "filters" || filterCount > 0}
              onClick={onOpenFilters}
              badge={filterCount > 0 ? filterCount : undefined}
            />
          </div>

          {/* Separator */}
          <span
            aria-hidden="true"
            className="mx-1 h-4 w-px bg-[var(--glass-border-muted)]"
          />

          {/* Settings */}
          <MobileIconButton
            icon={Settings2}
            label="设置"
            active={activeSection === "settings"}
            onClick={onOpenSettings}
          />
        </div>
      </aside>
    </>
  );
}

/* ── Desktop nav item with label + tooltip ── */
function NavItem({
  icon: Icon,
  label,
  shortcut,
  active,
  primary,
  collapsed,
  onClick,
  ariaExpanded,
  dot,
  badge,
}: {
  icon: typeof CalendarDays;
  label: string;
  shortcut?: string;
  active: boolean;
  primary?: boolean;
  collapsed: boolean;
  onClick: () => void;
  ariaExpanded?: boolean;
  dot?: boolean;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      aria-expanded={ariaExpanded}
      aria-controls={
        ariaExpanded !== undefined ? "task-toolbar-panel" : undefined
      }
      title={shortcut ? `${label}（${shortcut}）` : label}
      className={`group relative flex w-full items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-2 outline-none transition-colors duration-[var(--duration-fast)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
        active
          ? "bg-[var(--accent-soft)] text-[var(--accent)]"
          : primary
            ? "text-[var(--accent)] hover:bg-[var(--accent-muted)]"
            : "text-[var(--text-muted)] hover:bg-[var(--glass-control)] hover:text-[var(--text-primary)]"
      }`}
    >
      {/* Active indicator bar */}
      {active && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-[var(--accent)]"
        />
      )}

      <span className="relative shrink-0">
        <Icon aria-hidden="true" className="size-4.5" />
        {dot && (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-[var(--accent)]"
          />
        )}
        {badge !== undefined && (
          <span className="absolute -top-1.5 -right-2 grid size-4 place-items-center rounded-full bg-[var(--accent)] text-[10px] leading-none font-semibold text-[var(--accent-fg)]">
            {badge}
          </span>
        )}
      </span>

      {!collapsed && (
        <span className="min-w-0 flex-1 truncate text-left text-[13px] leading-5 font-medium">
          {label}
        </span>
      )}

      {/* Tooltip when collapsed */}
      {collapsed && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-full z-50 ml-2 hidden whitespace-nowrap rounded-[var(--radius-sm)] bg-[var(--glass-panel-strong)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-primary)] shadow-lg backdrop-blur-xl group-hover:block"
        >
          {shortcut ? `${label} ${shortcut}` : label}
        </span>
      )}
    </button>
  );
}

/* ── Mobile icon-only button ── */
function MobileIconButton({
  icon: Icon,
  label,
  active,
  onClick,
  badge,
}: {
  icon: typeof CalendarDays;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-expanded={active}
      aria-controls="task-toolbar-panel"
      className={`relative grid size-8 shrink-0 place-items-center rounded-[var(--radius-sm)] transition-colors duration-[var(--duration-fast)] ${
        active
          ? "bg-[var(--accent-soft)] text-[var(--accent)]"
          : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
      }`}
    >
      <Icon aria-hidden="true" className="size-4" />
      {badge !== undefined && (
        <span className="absolute -top-1 -right-1 grid size-3.5 place-items-center rounded-full bg-[var(--accent)] text-[9px] leading-none font-semibold text-[var(--accent-fg)]">
          {badge}
        </span>
      )}
    </button>
  );
}
