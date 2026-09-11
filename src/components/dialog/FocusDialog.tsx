import { useEffect, useRef, useState } from "react";
import { Coffee, Flame, Pause, Play, RotateCcw } from "lucide-react";
import { DialogShell } from "./DialogShell";
import type { PresencePhase } from "../../hooks/usePresence";
import { useFocusStore } from "../../stores/focusStore";

const QUICK_MINUTES = [25, 45, 60];

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function FocusDialog({
  presence,
  onClose,
  onFinished,
}: {
  presence: PresencePhase;
  onClose: () => void;
  /** 一轮专注自然结束（tick 幂等完成）时回调一次。 */
  onFinished: () => void;
}) {
  const mode = useFocusStore((state) => state.mode);
  const durationMin = useFocusStore((state) => state.durationMin);
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

  // 计算圆环进度
  const totalSeconds = durationMin * 60;
  const currentSeconds = idle ? totalSeconds : clock;
  const progress = Math.max(0, Math.min(1, currentSeconds / totalSeconds));

  const circleRadius = 66;
  const circumference = 2 * Math.PI * circleRadius;
  const strokeDashoffset = circumference * (1 - progress);

  return (
    <DialogShell
      title={running ? "专注进行中" : paused ? "专注已暂停" : "专注模式"}
      icon={running ? Flame : Coffee}
      width="360px"
      presence={presence}
      onClose={onClose}
    >
      <div className="focus-dialog-body">
        {/* 核心环形时钟仪表盘 */}
        <div
          className={`focus-dial-container ${running ? "is-running" : ""} ${paused ? "is-paused" : ""}`}
        >
          <svg
            className="focus-dial-svg"
            viewBox="0 0 160 160"
            aria-hidden="true"
          >
            <circle
              className="focus-dial-track"
              cx="80"
              cy="80"
              r={circleRadius}
            />
            <circle
              className="focus-dial-indicator"
              cx="80"
              cy="80"
              r={circleRadius}
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
            />
          </svg>

          <div className="focus-clock-center">
            <span
              className="focus-clock-digits"
              style={{ fontSize: "34px", lineHeight: 1 }}
            >
              {idle
                ? `${String(durationMin).padStart(2, "0")}:00`
                : formatClock(clock)}
            </span>
            <span className="focus-status-badge">
              {running ? "专注中" : paused ? "已暂停" : "深呼吸"}
            </span>
          </div>
        </div>

        {/* 时长分段药丸（仅在空闲状态可见） */}
        {idle && (
          <div className="focus-duration-pills">
            {QUICK_MINUTES.map((minutes) => (
              <button
                key={minutes}
                type="button"
                className={`focus-pill-btn ${
                  durationMin === minutes ? "is-active" : ""
                }`}
                onClick={() => useFocusStore.getState().setDuration(minutes)}
              >
                {minutes} 分钟
              </button>
            ))}
          </div>
        )}

        {/* 操作区 */}
        <div className="focus-action-area">
          {idle ? (
            <button
              type="button"
              className="focus-main-btn"
              onClick={() => useFocusStore.getState().start()}
            >
              <Flame aria-hidden="true" className="icon-sm" />
              <span>开始专注</span>
            </button>
          ) : (
            <div className="focus-running-actions">
              {running ? (
                <button
                  type="button"
                  className="focus-control-btn btn-secondary"
                  onClick={() => useFocusStore.getState().pause()}
                >
                  <Pause aria-hidden="true" className="icon-sm" />
                  <span>暂停</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="focus-control-btn btn-primary"
                  onClick={() => useFocusStore.getState().resume()}
                >
                  <Play aria-hidden="true" className="icon-sm" />
                  <span>继续</span>
                </button>
              )}
              <button
                type="button"
                className="focus-control-btn btn-ghost"
                onClick={() => useFocusStore.getState().reset()}
              >
                <RotateCcw aria-hidden="true" className="icon-sm" />
                <span>放弃</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </DialogShell>
  );
}
