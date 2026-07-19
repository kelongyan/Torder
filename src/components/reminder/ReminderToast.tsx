import { BellRing, Clock3, X } from "lucide-react";
import type { Task } from "../../types/database";

interface ReminderToastProps {
  task: Task | null;
  onOpen: (task: Task) => Promise<void>;
  onSnooze: (task: Task) => Promise<void>;
  onDismiss: () => void;
}

export function ReminderToast({
  task,
  onOpen,
  onSnooze,
  onDismiss,
}: ReminderToastProps) {
  if (!task) return null;

  return (
    <aside
      role="status"
      aria-label="任务提醒"
      className="glass-floating liquid-panel fixed right-20 bottom-4 z-30 w-[min(400px,calc(100vw-7rem))] rounded-2xl border-emerald-900/20 p-4 dark:border-blue-300/20 sm:right-24 sm:bottom-6 sm:p-5"
    >
      <div className="flex items-start gap-3">
        <span className="glass-surface grid size-10 shrink-0 place-items-center rounded-xl text-emerald-900 dark:text-blue-300">
          <BellRing aria-hidden="true" className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold tracking-wide text-emerald-900 uppercase dark:text-blue-300">
            任务提醒
          </p>
          <p className="mt-1 truncate text-sm font-semibold">{task.title}</p>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
            <Clock3 aria-hidden="true" className="size-3.5" />
            {formatReminderTime(task.remindAt)}
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="关闭任务提醒"
          className="glass-button rounded-lg p-1.5 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={() => void onSnooze(task)}
          className="glass-button rounded-lg border-[var(--glass-border-muted)] bg-white/20 px-3 py-2 text-xs font-medium text-stone-600 dark:bg-white/5 dark:text-stone-300"
        >
          10 分钟后提醒
        </button>
        <button
          type="button"
          onClick={() => void onOpen(task)}
          className="rounded-lg bg-emerald-900 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-950 dark:bg-blue-500/75 dark:hover:bg-blue-400"
        >
          查看任务
        </button>
      </div>
    </aside>
  );
}

function formatReminderTime(value: string | null): string {
  if (!value) return "提醒时间已到";
  const reminder = new Date(value);
  const overdueMinutes = Math.max(
    0,
    Math.floor((Date.now() - reminder.getTime()) / 60_000),
  );
  if (overdueMinutes >= 1) return `已过提醒时间 ${overdueMinutes} 分钟`;
  return "提醒时间已到";
}
