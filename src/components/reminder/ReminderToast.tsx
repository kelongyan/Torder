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
      className="fixed right-4 bottom-4 z-30 w-[min(400px,calc(100vw-2rem))] rounded-2xl border border-emerald-900/20 bg-white p-4 shadow-2xl shadow-stone-950/15 dark:border-emerald-500/30 dark:bg-stone-900 dark:shadow-black/40 sm:p-5"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-900/10 text-emerald-900 dark:bg-emerald-400/10 dark:text-emerald-400">
          <BellRing aria-hidden="true" className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold tracking-wide text-emerald-900 uppercase dark:text-emerald-400">
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
          className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={() => void onSnooze(task)}
          className="rounded-lg border border-stone-200 px-3 py-2 text-xs font-medium text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
        >
          10 分钟后提醒
        </button>
        <button
          type="button"
          onClick={() => void onOpen(task)}
          className="rounded-lg bg-emerald-900 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-950 dark:bg-emerald-700 dark:hover:bg-emerald-600"
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
