import {
  CalendarDays,
  CircleCheckBig,
  ListFilter,
  ListTodo,
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
  onSelectView: (view: TaskView) => void;
  onOpenQuickAdd: () => void;
  onOpenSearch: () => void;
  onOpenFilters: () => void;
  onOpenSettings: () => void;
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
  onSelectView,
  onOpenQuickAdd,
  onOpenSearch,
  onOpenFilters,
  onOpenSettings,
}: AppSidebarProps) {
  function renderViewButton({ id, label, icon: Icon }: (typeof views)[number]) {
    const active = activeSection === "tasks" && id === view;
    return (
      <button
        key={id}
        type="button"
        onClick={() => onSelectView(id)}
        aria-label={label}
        aria-current={active ? "page" : undefined}
        title={label}
        className={iconButton(active)}
      >
        <Icon aria-hidden="true" className="size-4.5" />
      </button>
    );
  }

  return (
    <aside className="glass-sidebar flex items-center gap-5 border-0 border-b !border-b-[var(--glass-border-muted)] px-3 py-3 md:w-[76px] md:shrink-0 md:flex-col md:gap-0 md:border-r md:border-b-0 md:!border-r-[var(--glass-border-muted)] md:px-0 md:py-0">
      <div className="flex shrink-0 items-center md:h-[72px] md:w-full md:justify-center md:px-3">
        <img
          src={torderLogo}
          alt=""
          aria-hidden="true"
          className="size-9 shrink-0 rounded-xl shadow-md shadow-emerald-950/15 ring-1 ring-white/70 dark:shadow-black/40 dark:ring-white/10"
        />
      </div>

      <nav
        className="min-w-0 flex-1 overflow-x-auto md:w-full md:flex-none md:overflow-visible md:px-3"
        aria-label="智能视图"
      >
        <div className="ml-auto flex w-max min-w-max gap-1.5 md:ml-0 md:w-full md:min-w-0 md:flex-col md:items-stretch">
          {views.slice(0, 2).map(renderViewButton)}

          <div
            className="flex shrink-0 gap-1.5 md:w-full md:flex-col"
            role="toolbar"
            aria-label="任务操作"
          >
            <button
              id="task-action-add"
              type="button"
              onClick={onOpenQuickAdd}
              aria-label="新建事项"
              aria-expanded={activeQuickAction === "add"}
              aria-controls="task-toolbar-panel"
              title="新建事项（Ctrl + N）"
              className={iconButton(activeQuickAction === "add", true)}
            >
              <Plus aria-hidden="true" className="size-[19px]" />
            </button>
            <button
              id="task-action-search"
              type="button"
              onClick={onOpenSearch}
              aria-label="搜索事项"
              aria-expanded={activeQuickAction === "search"}
              aria-controls="task-toolbar-panel"
              title="搜索事项（Ctrl + F）"
              className={iconButton(
                activeQuickAction === "search" || hasSearchQuery,
              )}
            >
              <Search aria-hidden="true" className="size-[17px]" />
              {hasSearchQuery && activeQuickAction !== "search" && (
                <span
                  aria-hidden="true"
                  className="absolute top-1 right-1 size-1.5 rounded-full bg-emerald-700 dark:bg-blue-300"
                />
              )}
            </button>
            <button
              id="task-action-filters"
              type="button"
              onClick={onOpenFilters}
              aria-label="筛选事项"
              aria-expanded={activeQuickAction === "filters"}
              aria-controls="task-toolbar-panel"
              title="筛选事项"
              className={iconButton(
                activeQuickAction === "filters" || filterCount > 0,
              )}
            >
              <ListFilter aria-hidden="true" className="size-[17px]" />
              {filterCount > 0 && (
                <span className="absolute -top-1 -right-1 grid size-4 place-items-center rounded-full bg-emerald-900 text-[10px] leading-none font-semibold text-white ring-2 ring-white dark:bg-blue-400 dark:text-blue-950 dark:ring-slate-950">
                  {filterCount}
                </span>
              )}
            </button>
          </div>

          {views.slice(2).map(renderViewButton)}

          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="设置"
            aria-current={activeSection === "settings" ? "page" : undefined}
            title="设置"
            className={`${iconButton(activeSection === "settings")} md:hidden`}
          >
            <Settings2 aria-hidden="true" className="size-4.5" />
          </button>
        </div>
      </nav>

      <div className="mt-auto hidden border-t border-[var(--glass-border-muted)] p-3 md:block">
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="设置"
          aria-current={activeSection === "settings" ? "page" : undefined}
          title="设置"
          className={iconButton(activeSection === "settings")}
        >
          <Settings2 aria-hidden="true" className="size-4.5" />
        </button>
      </div>
    </aside>
  );
}

function iconButton(active: boolean, primary = false): string {
  const base =
    "glass-button relative grid size-10 shrink-0 place-items-center rounded-xl outline-none duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 md:w-full dark:focus-visible:outline-blue-300";
  if (active) {
    return `${base} border-emerald-700/40 bg-emerald-900/90 text-white shadow-[0_8px_24px_rgba(5,95,75,.2)] dark:border-blue-300/20 dark:bg-blue-500/70`;
  }
  if (primary) {
    return `${base} border-emerald-800/15 bg-[var(--accent-soft)] text-emerald-900 shadow-[inset_0_1px_0_var(--glass-highlight)] hover:bg-emerald-900/14 dark:border-blue-300/15 dark:text-blue-300 dark:hover:bg-blue-500/18`;
  }
  return `${base} text-stone-500 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100`;
}
