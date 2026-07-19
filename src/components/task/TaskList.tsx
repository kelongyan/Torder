import { Bell, CalendarClock, Check, Inbox, LoaderCircle } from "lucide-react";
import { formatTaskDate, isOverdue } from "../../app/taskDates";
import { taskViewCopy } from "../../app/taskViews";
import type { Task, TaskList, TaskView } from "../../types/database";

interface TaskListProps {
  view: TaskView;
  tasks: Task[];
  lists: TaskList[];
  loading: boolean;
  hasActiveFilters: boolean;
  onToggle: (task: Task) => Promise<void>;
  onOpen: (task: Task) => void;
}

export function TaskListView({
  view,
  tasks,
  lists,
  loading,
  hasActiveFilters,
  onToggle,
  onOpen,
}: TaskListProps) {
  if (loading && tasks.length === 0) {
    return (
      <div className="glass-surface flex min-h-72 items-center justify-center rounded-2xl text-sm text-stone-500 dark:text-stone-400">
        <LoaderCircle aria-hidden="true" className="mr-2 size-4 animate-spin" />
        正在读取任务
      </div>
    );
  }

  if (tasks.length === 0) {
    const copy = taskViewCopy[view];
    return (
      <div className="glass-surface flex min-h-72 flex-col items-center justify-center rounded-2xl px-6 text-center">
        <span className="glass-surface grid size-11 place-items-center rounded-2xl text-stone-500 dark:text-stone-400">
          <Inbox aria-hidden="true" className="size-5" />
        </span>
        <h2 className="mt-4 font-serif text-xl font-semibold">
          {hasActiveFilters ? "没有匹配的任务" : copy.emptyTitle}
        </h2>
        <p className="mt-2 max-w-sm text-sm text-stone-500 dark:text-stone-400">
          {hasActiveFilters
            ? "换个关键词或减少筛选条件，再找找看。"
            : copy.emptyBody}
        </p>
      </div>
    );
  }

  const listNames = new Map(lists.map((list) => [list.id, list.name]));

  return (
    <div className="glass-surface overflow-hidden rounded-2xl">
      {tasks.map((task) => {
        const dueLabel = formatTaskDate(task.dueAt);
        const overdue = isOverdue(task.dueAt, task.status);
        return (
          <article
            key={task.id}
            className="glass-row group grid min-h-16 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 border-b last:border-b-0 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
          >
            <button
              type="button"
              onClick={() => void onToggle(task)}
              aria-label={task.status === "done" ? "取消完成" : "标记完成"}
              className={`ml-2 grid size-6 place-items-center rounded-lg border transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 dark:focus-visible:outline-blue-300 sm:ml-3 ${
                task.status === "done"
                  ? "border-emerald-900 bg-emerald-900 text-white dark:border-blue-300/30 dark:bg-blue-500/70"
                  : "border-stone-400/70 bg-white/45 text-transparent shadow-[inset_0_1px_0_rgba(255,255,255,.8)] hover:border-emerald-800 dark:border-stone-500 dark:bg-white/5"
              }`}
            >
              <Check aria-hidden="true" className="size-4" />
            </button>

            <button
              type="button"
              onClick={() => onOpen(task)}
              className="min-w-0 py-3.5 pr-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 dark:focus-visible:outline-blue-300"
            >
              <span
                className={`block truncate text-sm font-medium ${
                  task.status === "done"
                    ? "text-stone-400 line-through"
                    : "text-stone-900 dark:text-stone-100"
                }`}
              >
                {task.title}
              </span>
              <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
                {dueLabel && (
                  <span
                    className={`inline-flex items-center gap-1 ${overdue ? "font-medium text-red-700 dark:text-red-400" : ""}`}
                  >
                    <CalendarClock aria-hidden="true" className="size-3.5" />
                    {overdue ? `已过期 · ${dueLabel}` : dueLabel}
                  </span>
                )}
                {task.remindAt && (
                  <span className="inline-flex items-center gap-1">
                    <Bell aria-hidden="true" className="size-3.5" />
                    已设置提醒
                  </span>
                )}
                <span>{listNames.get(task.listId) ?? "收件箱"}</span>
                {task.priority > 0 && (
                  <span>{task.priority === 2 ? "紧急" : "重要"}</span>
                )}
              </span>
            </button>

            <button
              type="button"
              onClick={() => onOpen(task)}
              className="mr-3 hidden rounded-lg px-2 py-1 text-xs text-stone-400 opacity-0 transition hover:bg-stone-200 hover:text-stone-700 group-hover:opacity-100 dark:hover:bg-stone-700 dark:hover:text-stone-200 sm:block"
            >
              详情
            </button>
          </article>
        );
      })}
    </div>
  );
}
