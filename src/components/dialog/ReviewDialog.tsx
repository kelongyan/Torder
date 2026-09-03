import { useMemo, useState } from "react";
import { CalendarCheck, CheckCircle2, ArrowRightToLine } from "lucide-react";
import { DialogShell } from "./DialogShell";
import type { PresencePhase } from "../../hooks/usePresence";
import type { Task } from "../../types/database";
import { localDateKey, shiftDateKey } from "../../services/taskQuery";
import {
  completedToday,
  createdTodayCount,
  dueTodayTodos,
  overdueTodos,
  shiftOverdueTaskPatch,
  weekTrend,
} from "../../utils/taskStats";
import { useTaskStore } from "../../stores/taskStore";

/**
 * 每日回顾（阶段 C / T-04 打样）：三统计卡 + 近 7 日趋势 + 今日双栏 +
 * 一键顺延逾期。统计口径全部来自 taskStats（唯一实现，供 T-06 复用）。
 * 顺延逐条走 store.patchTask（乐观更新），完成后回调 onShiftsApplied 由
 * App 弹 toast；数据源 tasks 由调用方传入，随 store 更新自动重渲染。
 */

export function ReviewDialog({
  tasks,
  presence,
  onClose,
  onShiftsApplied,
}: {
  tasks: Task[];
  presence: PresencePhase;
  onClose: () => void;
  onShiftsApplied: (count: number) => void;
}) {
  const todayKey = localDateKey(new Date());
  const [busy, setBusy] = useState(false);

  const { completed, created, overdue, dueToday, trend } = useMemo(() => {
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
  }, [tasks, todayKey]);

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
      onShiftsApplied(shifted);
    } finally {
      setBusy(false);
    }
  }

  const maxTrend = Math.max(
    1,
    ...trend.map((day) => Math.max(day.completed, day.created)),
  );

  return (
    <DialogShell
      title="每日回顾"
      icon={CalendarCheck}
      width="560px"
      presence={presence}
      onClose={onClose}
    >
      <div className="dialog-form">
        <div className="review-cards">
          <div className="review-card">
            <span className="review-card-label">今日完成</span>
            <span className="review-card-value">{completed.length}</span>
          </div>
          <div className="review-card">
            <span className="review-card-label">今日新增</span>
            <span className="review-card-value">{created}</span>
          </div>
          <div className="review-card review-card--danger">
            <span className="review-card-label">今日逾期</span>
            <span className="review-card-value">{overdue.length}</span>
          </div>
        </div>

        <div className="review-trend">
          <div className="settings-list-label">近 7 日</div>
          <div className="review-trend-bars">
            {trend.map((day) => (
              <div key={day.key} className="review-trend-col">
                <div
                  className="review-trend-bar"
                  title={`完成 ${day.completed} · 新增 ${day.created}`}
                  style={{
                    height: `${Math.max(
                      4,
                      Math.round(
                        (Math.max(day.completed, day.created) / maxTrend) * 56,
                      ),
                    )}px`,
                  }}
                />
                <span className="review-trend-label">{day.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="review-sections">
          <div className="settings-list-label">逾期待办</div>
          {overdue.length === 0 ? (
            <p className="settings-section-hint">没有逾期的任务。</p>
          ) : (
            <>
              <ul className="review-list">
                {overdue.slice(0, 8).map((task) => (
                  <li key={task.id} className="review-item">
                    <span className="review-item-title">{task.title}</span>
                    <span className="review-item-meta">
                      {task.dueAt
                        ? new Date(task.dueAt).toLocaleString("zh-CN", {
                            month: "numeric",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : ""}
                    </span>
                  </li>
                ))}
                {overdue.length > 8 && (
                  <li className="review-item review-item--more">
                    另有 {overdue.length - 8} 项
                  </li>
                )}
              </ul>
              <button
                type="button"
                className="btn-secondary btn-sm"
                disabled={busy}
                onClick={() => void handleShiftOverdue()}
              >
                <ArrowRightToLine aria-hidden="true" className="icon-sm" />
                全部顺延到明天
              </button>
            </>
          )}
        </div>

        <div className="review-sections">
          <div className="settings-list-label">今日双栏</div>
          <div className="review-duo">
            <div>
              <div className="review-duo-head">
                <CheckCircle2 aria-hidden="true" className="icon-sm" />
                已完成
              </div>
              <ul className="review-list">
                {completed.slice(0, 6).map((task) => (
                  <li key={task.id} className="review-item">
                    {task.title}
                  </li>
                ))}
                {completed.length === 0 && (
                  <li className="review-item review-item--empty">暂无</li>
                )}
              </ul>
            </div>
            <div>
              <div className="review-duo-head">今日到期</div>
              <ul className="review-list">
                {dueToday.map((task) => (
                  <li key={task.id} className="review-item">
                    {task.title}
                  </li>
                ))}
                {dueToday.length === 0 && (
                  <li className="review-item review-item--empty">暂无</li>
                )}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </DialogShell>
  );
}
