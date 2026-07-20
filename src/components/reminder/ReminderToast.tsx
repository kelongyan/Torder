import { useRef, useState } from "react";
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
  const [dismissing, setDismissing] = useState(false);
  const dismissTimerRef = useRef<number | null>(null);

  if (!task && !dismissing) return null;

  function animateOut(callback: () => void) {
    setDismissing(true);
    dismissTimerRef.current = window.setTimeout(() => {
      setDismissing(false);
      callback();
    }, 200);
  }

  function handleDismiss() {
    animateOut(onDismiss);
  }

  function handleSnooze() {
    if (!task) return;
    animateOut(() => void onSnooze(task));
  }

  function handleOpen() {
    if (!task) return;
    animateOut(() => void onOpen(task));
  }

  return (
    <aside
      role="status"
      aria-label="任务提醒"
      className={`glass-floating fixed right-4 bottom-4 z-[var(--z-toast)] w-[min(380px,calc(100vw-2rem))] rounded-[var(--radius-lg)] border-[color-mix(in_srgb,var(--accent)_25%,transparent)] p-4 sm:right-6 sm:bottom-6 ${
        dismissing ? "toast-exit" : "liquid-panel"
      }`}
    >
      {task && (
        <>
          <div className="flex items-start gap-3">
            <span className="glass-surface grid size-9 shrink-0 place-items-center rounded-[var(--radius-md)] text-[var(--accent)]">
              <BellRing aria-hidden="true" className="size-4.5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="eyebrow">任务提醒</p>
              <p className="mt-0.5 truncate text-sm leading-[21px] font-semibold text-[var(--text-primary)]">
                {task.title}
              </p>
              <p className="meta-copy tabular-nums mt-0.5 flex items-center gap-1">
                <Clock3 aria-hidden="true" className="size-3" />
                {formatReminderTime(task.remindAt)}
              </p>
            </div>
            <button
              type="button"
              onClick={handleDismiss}
              aria-label="关闭任务提醒"
              className="glass-button rounded-[var(--radius-sm)] p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              <X aria-hidden="true" className="size-3.5" />
            </button>
          </div>

          <div className="mt-3.5 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={handleSnooze}
              className="btn-secondary min-h-9 px-3 text-[13px]"
            >
              10 分钟后提醒
            </button>
            <button
              type="button"
              onClick={handleOpen}
              className="btn-primary min-h-9 px-3 text-[13px]"
            >
              查看任务
            </button>
          </div>
        </>
      )}
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
