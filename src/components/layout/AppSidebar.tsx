import {
  CalendarDays,
  CircleCheckBig,
  ListTodo,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
  TriangleAlert,
} from "lucide-react";
import torderLogo from "../../assets/torder-logo.png";
import type { TaskView } from "../../types/database";

interface AppSidebarProps {
  view: TaskView;
  activeSection: "tasks" | "settings";
  collapsed: boolean;
  onSelectView: (view: TaskView) => void;
  onOpenSettings: () => void;
  onToggleCollapsed: () => void;
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
  collapsed,
  onSelectView,
  onOpenSettings,
  onToggleCollapsed,
}: AppSidebarProps) {
  const labelClass = `overflow-hidden whitespace-nowrap transition-[max-width,opacity,transform] duration-200 ease-out motion-reduce:transition-none ${
    collapsed
      ? "md:max-w-0 md:-translate-x-1 md:opacity-0"
      : "md:max-w-36 md:translate-x-0 md:opacity-100"
  }`;

  return (
    <aside
      className={`border-b border-stone-200 bg-stone-50 transition-[width] duration-300 ease-out motion-reduce:transition-none dark:border-stone-800 dark:bg-stone-950 md:flex md:shrink-0 md:flex-col md:border-r md:border-b-0 ${
        collapsed ? "md:w-[76px]" : "md:w-60"
      }`}
    >
      <div
        className={`flex h-16 items-center gap-3 px-5 md:h-20 ${
          collapsed ? "md:justify-center md:px-3" : ""
        }`}
      >
        <img
          src={torderLogo}
          alt=""
          aria-hidden="true"
          className="size-9 shrink-0 rounded-xl shadow-sm shadow-stone-900/10 dark:shadow-black/30"
        />
        <span className={`text-xl font-semibold tracking-tight ${labelClass}`}>
          今序
        </span>
      </div>

      <nav
        className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible md:pb-0"
        aria-label="智能视图"
      >
        {views.map(({ id, label, icon: Icon }) => {
          const active = activeSection === "tasks" && id === view;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelectView(id)}
              aria-current={active ? "page" : undefined}
              title={collapsed ? label : undefined}
              className={`flex shrink-0 items-center gap-2 rounded-xl px-2.5 py-2.5 text-left text-sm font-medium transition-all duration-200 motion-reduce:transition-none md:w-full ${
                collapsed
                  ? "md:justify-center md:gap-0 md:px-0"
                  : "md:gap-3 md:px-3"
              } ${
                active
                  ? "bg-emerald-900/10 text-emerald-950 dark:bg-emerald-950/50 dark:text-emerald-200"
                  : "text-stone-600 hover:bg-stone-200 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
              }`}
            >
              <Icon aria-hidden="true" className="size-4.5 shrink-0" />
              <span className={labelClass}>{label}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={onOpenSettings}
          aria-current={activeSection === "settings" ? "page" : undefined}
          className={`flex shrink-0 items-center gap-2 rounded-xl px-2.5 py-2.5 text-left text-sm font-medium transition-colors md:hidden ${
            activeSection === "settings"
              ? "bg-emerald-900/10 text-emerald-950 dark:text-emerald-200"
              : "text-stone-600 hover:bg-stone-200 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
          }`}
        >
          <Settings2 aria-hidden="true" className="size-4.5" />
          <span>设置</span>
        </button>
      </nav>

      <div className="mt-auto hidden border-t border-stone-200 p-3 dark:border-stone-800 md:block">
        <button
          type="button"
          onClick={onOpenSettings}
          aria-current={activeSection === "settings" ? "page" : undefined}
          title={collapsed ? "设置" : undefined}
          className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-all duration-200 motion-reduce:transition-none ${
            collapsed ? "justify-center gap-0 px-0" : ""
          } ${
            activeSection === "settings"
              ? "bg-emerald-900/10 font-medium text-emerald-950 dark:text-emerald-200"
              : "text-stone-500 hover:bg-stone-200 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
          }`}
        >
          <Settings2 aria-hidden="true" className="size-4.5 shrink-0" />
          <span className={labelClass}>设置</span>
        </button>
        <p
          className={`mt-3 overflow-hidden px-3 text-xs whitespace-nowrap text-stone-400 transition-[max-height,opacity] duration-200 motion-reduce:transition-none dark:text-stone-600 ${
            collapsed ? "max-h-0 opacity-0" : "max-h-5 opacity-100"
          }`}
        >
          本地优先 · SQLite
        </p>
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
          title={collapsed ? "展开侧边栏" : "收起侧边栏"}
          className={`mt-2 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-stone-400 transition-all duration-200 motion-reduce:transition-none hover:bg-stone-200 hover:text-stone-800 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-200 ${
            collapsed ? "justify-center gap-0 px-0" : ""
          }`}
        >
          {collapsed ? (
            <PanelLeftOpen aria-hidden="true" className="size-4.5 shrink-0" />
          ) : (
            <PanelLeftClose aria-hidden="true" className="size-4.5 shrink-0" />
          )}
          <span className={labelClass}>
            {collapsed ? "展开侧栏" : "收起侧栏"}
          </span>
        </button>
      </div>
    </aside>
  );
}
