import { useState } from "react";
import { Bell, CalendarClock, Check, Plus } from "lucide-react";
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
  onQuickAdd?: () => void;
}

export function TaskListView({
  view,
  tasks,
  lists,
  loading,
  hasActiveFilters,
  onToggle,
  onOpen,
  onQuickAdd,
}: TaskListProps) {
  if (loading && tasks.length === 0) {
    return <TaskSkeleton />;
  }

  if (tasks.length === 0) {
    const copy = taskViewCopy[view];
    const canAdd = view === "today" || view === "all";
    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center px-6 text-center">
        {/* Empty state illustration */}
        <svg
          aria-hidden="true"
          width="120"
          height="120"
          viewBox="0 0 64 64"
          fill="none"
          className="mb-6 text-[var(--accent)] opacity-30"
        >
          <rect
            x="12"
            y="8"
            width="40"
            height="48"
            rx="6"
            stroke="currentColor"
            strokeWidth="2"
          />
          <path
            d="M22 24h20M22 32h14M22 40h8"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle cx="46" cy="46" r="12" fill="var(--accent-soft)" />
          <path
            d="M42 46h8M46 42v8"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
        <h2 className="text-base font-semibold text-[var(--text-primary)]">
          {hasActiveFilters ? "没有匹配的任务" : copy.emptyTitle}
        </h2>
        <p className="body-copy mt-2 max-w-sm">
          {hasActiveFilters
            ? "换个关键词或减少筛选条件，再找找看。"
            : copy.emptyBody}
        </p>
        {canAdd && !hasActiveFilters && onQuickAdd && (
          <button
            type="button"
            onClick={onQuickAdd}
            className="btn-primary mt-5"
          >
            <Plus aria-hidden="true" className="size-4" />
            新建任务
          </button>
        )}
      </div>
    );
  }

  const listMap = new Map(lists.map((list) => [list.id, list]));

  return (
    <div className="glass-surface overflow-hidden rounded-[var(--radius-lg)]">
      {tasks.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          listName={listMap.get(task.listId)?.name ?? "收件箱"}
          listColor={listMap.get(task.listId)?.color ?? null}
          onToggle={onToggle}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

/* ── Single task row ── */
function TaskRow({
  task,
  listName,
  listColor,
  onToggle,
  onOpen,
}: {
  task: Task;
  listName: string;
  listColor: string | null;
  onToggle: (task: Task) => Promise<void>;
  onOpen: (task: Task) => void;
}) {
  const [justCompleted, setJustCompleted] = useState(false);
  const dueLabel = formatTaskDate(task.dueAt);
  const overdue = isOverdue(task.dueAt, task.status);
  const done = task.status === "done";

  async function handleToggle() {
    if (!done) {
      setJustCompleted(true);
      window.setTimeout(() => setJustCompleted(false), 600);
    }
    await onToggle(task);
  }

  return (
    <article
      className={`glass-row group relative grid min-h-14 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 border-b last:border-b-0 ${
        justCompleted ? "bg-[var(--accent-muted)]" : ""
      }`}
      style={{
        transition: "background-color 300ms ease",
      }}
    >
      {/* Priority bar */}
      {task.priority > 0 && !done && (
        <span
          aria-hidden="true"
          className={`priority-bar ${
            task.priority === 2 ? "priority-urgent" : "priority-important"
          }`}
        />
      )}

      {/* Checkbox */}
      <button
        type="button"
        onClick={() => void handleToggle()}
        aria-label={done ? "取消完成" : "标记完成"}
        className={`ml-3 grid size-7 shrink-0 place-items-center rounded-full border-2 transition-all duration-[var(--duration-fast)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
          done
            ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]"
            : "border-[color-mix(in_srgb,var(--text-muted)_50%,transparent)] bg-transparent text-transparent hover:border-[var(--accent)] hover:text-[color-mix(in_srgb,var(--accent)_40%,transparent)]"
        } ${justCompleted ? "check-bounce" : ""}`}
      >
        <Check aria-hidden="true" className="size-3.5" strokeWidth={3} />
      </button>

      {/* Content */}
      <button
        type="button"
        onClick={() => onOpen(task)}
        className="min-w-0 py-2.5 pr-3 text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
      >
        {/* Title */}
        <span
          className={`block truncate text-sm leading-[21px] font-medium transition-colors duration-[var(--duration-slow)] ${
            done
              ? "text-[var(--text-muted)] line-through decoration-[color-mix(in_srgb,var(--text-muted)_50%,transparent)]"
              : "text-[var(--text-primary)]"
          }`}
        >
          {task.title}
        </span>

        {/* Meta row */}
        <span className="meta-copy mt-0.5 flex flex-wrap items-center gap-x-1 gap-y-0.5">
          {dueLabel && (
            <span
              className={`inline-flex items-center gap-1 ${
                overdue && !done
                  ? "font-semibold text-[var(--status-danger)]"
                  : ""
              }`}
            >
              <CalendarClock aria-hidden="true" className="size-3" />
              {overdue && !done ? `已过期 · ${dueLabel}` : dueLabel}
            </span>
          )}

          {dueLabel && task.remindAt && (
            <span
              aria-hidden="true"
              className="text-[var(--text-muted)] opacity-40"
            >
              ·
            </span>
          )}

          {task.remindAt && (
            <span className="inline-flex items-center" title="已设置提醒">
              <Bell aria-hidden="true" className="size-3" />
            </span>
          )}

          {(dueLabel || task.remindAt) && (
            <span
              aria-hidden="true"
              className="text-[var(--text-muted)] opacity-40"
            >
              ·
            </span>
          )}

          <span className="inline-flex items-center gap-1">
            {listColor && (
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full"
                style={{ backgroundColor: listColor }}
              />
            )}
            {listName}
          </span>

          {task.priority > 0 && !done && (
            <>
              <span
                aria-hidden="true"
                className="text-[var(--text-muted)] opacity-40"
              >
                ·
              </span>
              <span
                className={`badge ${
                  task.priority === 2 ? "badge-danger" : "badge-warning"
                }`}
              >
                {task.priority === 2 ? "紧急" : "重要"}
              </span>
            </>
          )}
        </span>
      </button>
    </article>
  );
}

/* ── Loading skeleton ── */
function TaskSkeleton() {
  return (
    <div className="glass-surface overflow-hidden rounded-[var(--radius-lg)]">
      {Array.from({ length: 4 }, (_, index) => (
        <div
          key={index}
          className="flex items-center gap-3 border-b border-[var(--glass-border-muted)] px-3 py-3.5 last:border-b-0"
        >
          <div className="skeleton ml-0.5 size-7 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <div
              className="skeleton h-3.5 rounded-[var(--radius-sm)]"
              style={{ width: `${65 - index * 10}%` }}
            />
            <div
              className="skeleton h-2.5 rounded-[var(--radius-sm)]"
              style={{ width: `${40 - index * 5}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
