import { useEffect, useRef, useState } from "react";
import { Coffee, Flame, Pause, Play, RotateCcw } from "lucide-react";
import { DialogShell } from "./DialogShell";
import type { PresencePhase } from "../../hooks/usePresence";
import { useFocusStore } from "../../stores/focusStore";
import type { Task } from "../../types/database";

/**
 * 专注模式控制面板（阶段 A / T-02 一期）。
 * 计时状态在 focusStore（真实时间戳现算，后台/切标签不漂移）；
 * 本组件以 1s tick 推进渲染，并在本轮自然结束时回调 onFinished
 * （由 App 弹 toast 并触发 Rust 系统通知）。
 */

const QUICK_MINUTES = [25, 45, 60];

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function FocusDialog({
  tasks,
  presence,
  onClose,
  onFinished,
}: {
  /** 可选专注任务的候选列表（传入当前视图任务或全部任务）。 */
  tasks: Task[];
  presence: PresencePhase;
  onClose: () => void;
  /** 一轮专注自然结束（tick 幂等完成）时回调一次。 */
  onFinished: () => void;
}) {
  const mode = useFocusStore((state) => state.mode);
  const durationMin = useFocusStore((state) => state.durationMin);
  const focusTaskId = useFocusStore((state) => state.focusTaskId);
  const startedAt = useFocusStore((state) => state.startedAt);
  const lastCompletedAt = useFocusStore((state) => state.lastCompletedAt);
  const [clock, setClock] = useState(0);
  const reportedRef = useRef<number | null>(null);

  // 每秒推进：store.tick 负责到期幂等完成；本地 clock 负责倒计时显示。
  useEffect(() => {
    const timer = window.setInterval(() => {
      const store = useFocusStore.getState();
      store.tick();
      setClock(store.remaining());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  // 完成上报（每轮仅一次）：lastCompletedAt 变化且尚未上报时触发。
  useEffect(() => {
    if (lastCompletedAt === null) return;
    if (reportedRef.current === lastCompletedAt) return;
    reportedRef.current = lastCompletedAt;
    onFinished();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastCompletedAt]);

  const idle = mode === "idle";
  const running = mode === "running";
  const paused = mode === "paused";
  const focusTask = tasks.find((task) => task.id === focusTaskId);

  return (
    <DialogShell
      title={running || paused ? "专注进行中" : "专注模式"}
      icon={running || paused ? Flame : Coffee}
      width="380px"
      presence={presence}
      onClose={onClose}
    >
      <div className="dialog-form">
        <div className="focus-clock-row" data-testid="focus-clock">
          {running || paused ? (
            <span className="focus-clock">{formatClock(clock)}</span>
          ) : (
            <span className="focus-clock focus-clock--dim">
              {String(durationMin).padStart(2, "0")}:00
            </span>
          )}
          <span className="settings-section-hint">
            {running
              ? `始于 ${startedAt ? new Date(startedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "现在"}`
              : paused
                ? "已暂停"
                : "选择时长开始一轮专注"}
          </span>
        </div>

        {idle && (
          <>
            <label className="form-field">
              <span>绑定任务（可选，用于行高亮）</span>
              <select
                value={focusTaskId ?? ""}
                disabled={!idle}
                onChange={(event) =>
                  useFocusStore
                    .getState()
                    .setFocusTask(event.target.value || null)
                }
              >
                <option value="">不绑定</option>
                {tasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
              </select>
            </label>
            <div className="focus-duration-row">
              {QUICK_MINUTES.map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  className={`focus-duration-chip ${
                    durationMin === minutes ? "is-active" : ""
                  }`}
                  onClick={() => useFocusStore.getState().setDuration(minutes)}
                >
                  {minutes}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn-primary focus-start"
              onClick={() => useFocusStore.getState().start()}
            >
              <Flame aria-hidden="true" className="icon-sm" />
              开始专注
            </button>
          </>
        )}

        {!idle && (
          <>
            {focusTask && (
              <div className="focus-task-label">
                正在专注：{focusTask.title}
              </div>
            )}
            <div className="settings-row focus-actions">
              {running ? (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => useFocusStore.getState().pause()}
                >
                  <Pause aria-hidden="true" className="icon-sm" />
                  暂停
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => useFocusStore.getState().resume()}
                >
                  <Play aria-hidden="true" className="icon-sm" />
                  继续
                </button>
              )}
              <button
                type="button"
                className="btn-secondary"
                onClick={() => useFocusStore.getState().reset()}
              >
                <RotateCcw aria-hidden="true" className="icon-sm" />
                重置
              </button>
            </div>
          </>
        )}
      </div>
    </DialogShell>
  );
}
