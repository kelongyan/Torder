/**
 * mobile/pages/focusReview.tsx — 专注模式 / 每日回顾（M-C 页化）
 * 专注：复用 focusStore（真实时间戳状态机）与 notifyFocusFinished；
 *        UI 为移动页布局（桌面 FocusDialog 的去浮层形态）。
 * 回顾：统计口径全部来自 utils/taskStats（唯一实现），一键顺延走
 *        store.patchTask（乐观更新），与桌面 ReviewDialog 同一数据路径。
 */
import { useEffect, useRef, useState, type JSX } from "react";
import {
  CheckCircle2,
  Coffee,
  Flame,
  Pause,
  Play,
  RotateCcw,
} from "lucide-react";
import { useFocusStore } from "../../stores/focusStore";
import { useTaskStore } from "../../stores/taskStore";
import { localDateKey, shiftDateKey } from "../../services/taskQuery";
import {
  completedToday,
  createdTodayCount,
  dueTodayTodos,
  overdueTodos,
  shiftOverdueTaskPatch,
  weekTrend,
} from "../../utils/taskStats";
import { notifyFocusFinished } from "../../services/focusService";
import { useMobilePage } from "../router";
import { useMobileProps } from "../context";
import { ScreenShell, TopBar } from "../ui";

/* ================= 专注模式 ================= */

const QUICK_MINUTES = [25, 45, 60];

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function FocusScreen(): JSX.Element {
  const { nav } = useMobilePage();
  const props = useMobileProps();
  const allTasks = useTaskStore((s) => s.allTasks);
  const candidates = allTasks.filter(
    (t) => t.deletedAt == null && t.status !== "done",
  );

  const mode = useFocusStore((s) => s.mode);
  const durationMin = useFocusStore((s) => s.durationMin);
  const focusTaskId = useFocusStore((s) => s.focusTaskId);
  const startedAt = useFocusStore((s) => s.startedAt);
  const lastCompletedAt = useFocusStore((s) => s.lastCompletedAt);
  const [clock, setClock] = useState(0);
  const reportedRef = useRef<number | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const store = useFocusStore.getState();
      store.tick();
      setClock(store.remaining());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (lastCompletedAt === null) return;
    if (reportedRef.current === lastCompletedAt) return;
    reportedRef.current = lastCompletedAt;
    void notifyFocusFinished();
    props.onToast("本轮专注已完成", "success");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastCompletedAt]);

  const idle = mode === "idle";
  const running = mode === "running";
  const paused = mode === "paused";
  const focusTask = candidates.find((task) => task.id === focusTaskId);

  return (
    <ScreenShell
      topbar={<TopBar back onBack={() => nav.back()} title="专注模式" />}
      className="m-focus-page"
    >
      <div className="m-focus-stage">
        <div className="m-focus-clock-wrap">
          <span className={`m-focus-clock ${idle ? "dim" : ""}`}>
            {idle
              ? `${String(durationMin).padStart(2, "0")}:00`
              : formatClock(clock)}
          </span>
          <span className="m-focus-hint">
            {running
              ? `始于 ${
                  startedAt
                    ? new Date(startedAt).toLocaleTimeString("zh-CN", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "现在"
                }`
              : paused
                ? "已暂停"
                : "选择时长开始一轮专注"}
          </span>
        </div>

        {idle ? (
          <>
            <label className="m-focus-field">
              <span>绑定任务（可选，用于行高亮）</span>
              <select
                className="m-focus-select"
                value={focusTaskId ?? ""}
                onChange={(e) =>
                  useFocusStore.getState().setFocusTask(e.target.value || null)
                }
              >
                <option value="">不绑定</option>
                {candidates.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
              </select>
            </label>
            <div className="m-focus-duration-row">
              {QUICK_MINUTES.map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  className={`m-focus-chip ${
                    durationMin === minutes ? "active" : ""
                  }`}
                  onClick={() => useFocusStore.getState().setDuration(minutes)}
                >
                  {minutes} 分
                </button>
              ))}
            </div>
            <button
              type="button"
              className="m-primary-btn grow m-focus-start"
              onClick={() => {
                navigator.vibrate?.(8);
                useFocusStore.getState().start();
              }}
            >
              <Flame aria-hidden="true" />
              开始专注
            </button>
          </>
        ) : (
          <div className="m-focus-running">
            {focusTask && (
              <div className="m-focus-task">正在专注：{focusTask.title}</div>
            )}
            <div className="m-focus-actions">
              {running ? (
                <button
                  type="button"
                  className="m-primary-btn ghost"
                  onClick={() => useFocusStore.getState().pause()}
                >
                  <Pause aria-hidden="true" />
                  暂停
                </button>
              ) : (
                <button
                  type="button"
                  className="m-primary-btn"
                  onClick={() => useFocusStore.getState().resume()}
                >
                  <Play aria-hidden="true" />
                  继续
                </button>
              )}
              <button
                type="button"
                className="m-primary-btn ghost"
                onClick={() => useFocusStore.getState().reset()}
              >
                <RotateCcw aria-hidden="true" />
                重置
              </button>
            </div>
          </div>
        )}
      </div>
    </ScreenShell>
  );
}

/* ================= 每日回顾 ================= */

export function ReviewScreen(): JSX.Element {
  const { nav } = useMobilePage();
  const props = useMobileProps();
  const allTasks = useTaskStore((s) => s.allTasks);
  const todayKey = localDateKey(new Date());
  const [busy, setBusy] = useState(false);

  const stats = computeReview(allTasks, todayKey);
  const { completed, created, overdue, dueToday, trend } = stats;
  const maxTrend = Math.max(
    1,
    ...trend.map((day) => Math.max(day.completed, day.created)),
  );

  async function handleShiftOverdue() {
    if (busy || overdue.length === 0) return;
    setBusy(true);
    try {
      const tomorrow = shiftDateKey(todayKey, 1);
      let shifted = 0;
      for (const task of overdue) {
        const patch = shiftOverdueTaskPatch(task, tomorrow);
        if (!patch) continue;
        await useTaskStore.getState().patchTask(task.id, patch);
        shifted += 1;
      }
      if (shifted > 0)
        props.onToast(`已顺延 ${shifted} 项逾期任务到明天`, "success");
      else props.onToast("今天没有需要顺延的逾期任务", "info");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScreenShell
      topbar={<TopBar back onBack={() => nav.back()} title="每日回顾" />}
    >
      <div className="m-review-cards">
        <div className="m-review-card">
          <span className="m-review-label">今日完成</span>
          <span className="m-review-value">{completed.length}</span>
        </div>
        <div className="m-review-card">
          <span className="m-review-label">今日新增</span>
          <span className="m-review-value">{created}</span>
        </div>
        <div className="m-review-card danger">
          <span className="m-review-label">今日逾期</span>
          <span className="m-review-value">{overdue.length}</span>
        </div>
      </div>

      <div className="m-review-trend">
        <div className="m-field-label">近 7 日</div>
        <div className="m-review-bars">
          {trend.map((day) => (
            <div key={day.key} className="m-review-bar-col">
              <div
                className="m-review-bar"
                title={`完成 ${day.completed} · 新增 ${day.created}`}
                style={{
                  height: `${Math.max(
                    4,
                    Math.round(
                      (Math.max(day.completed, day.created) / maxTrend) * 52,
                    ),
                  )}px`,
                }}
              />
              <span className="m-review-bar-label">{day.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="m-field-label">逾期待办</div>
      {overdue.length === 0 ? (
        <p className="m-detail-static-row">没有逾期的任务。</p>
      ) : (
        <div className="m-review-overdue">
          {overdue.slice(0, 8).map((task) => (
            <button
              key={task.id}
              type="button"
              className="m-review-item"
              onClick={() => nav.push(`/task/${task.id}`)}
            >
              <span className="m-review-item-title">{task.title}</span>
              {task.dueAt && (
                <span className="m-review-item-meta">
                  {new Date(task.dueAt).toLocaleString("zh-CN", {
                    month: "numeric",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              )}
            </button>
          ))}
          {overdue.length > 8 && (
            <div className="m-review-more">另有 {overdue.length - 8} 项</div>
          )}
          <button
            type="button"
            className="m-primary-btn ghost m-review-shift"
            disabled={busy}
            onClick={() => void handleShiftOverdue()}
          >
            <RotateCcw aria-hidden="true" />
            全部顺延到明天
          </button>
        </div>
      )}

      <div className="m-field-label">今日双栏</div>
      <div className="m-review-duo">
        <div>
          <div className="m-review-duo-head">
            <CheckCircle2 aria-hidden="true" />
            已完成
          </div>
          <ul className="m-review-duo-list">
            {completed.slice(0, 6).map((task) => (
              <li key={task.id} className="m-review-item-title">
                {task.title}
              </li>
            ))}
            {completed.length === 0 && <li className="m-review-empty">暂无</li>}
          </ul>
        </div>
        <div>
          <div className="m-review-duo-head">
            <Coffee aria-hidden="true" />
            今日到期
          </div>
          <ul className="m-review-duo-list">
            {dueToday.map((task) => (
              <li key={task.id} className="m-review-item-title">
                {task.title}
              </li>
            ))}
            {dueToday.length === 0 && <li className="m-review-empty">暂无</li>}
          </ul>
        </div>
      </div>
    </ScreenShell>
  );
}

/* 轻量纯函数：避免 import useMemo 以最小化依赖 */
function computeReview(
  tasks: ReturnType<typeof useTaskStore.getState>["allTasks"],
  todayKey: string,
) {
  const done = completedToday(tasks, todayKey);
  const due = dueTodayTodos(tasks, todayKey);
  const late = overdueTodos(tasks, todayKey);
  return {
    completed: done,
    created: createdTodayCount(tasks, todayKey),
    overdue: late,
    dueToday: due,
    trend: weekTrend(tasks, todayKey),
  };
}
