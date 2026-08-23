import { useMemo } from "react";
import { BarChart3 } from "lucide-react";
import { DialogShell } from "./DialogShell";
import type { PresencePhase } from "../../hooks/usePresence";
import { priorityCopy } from "../../constants/taskConfig";
import { DEFAULT_LIST_COLOR } from "../../constants/listConfig";
import type { RecurringRule, Task, TaskList } from "../../types/database";

const weekdays = ["日", "一", "二", "三", "四", "五", "六"];

export function StatsDialog({
  tasks,
  lists,
  recurringRules,
  presence,
  onClose,
}: {
  tasks: Task[];
  lists: TaskList[];
  recurringRules: RecurringRule[];
  presence: PresencePhase;
  onClose: () => void;
}) {
  const stats = useMemo(
    () => buildStats(tasks, lists, recurringRules),
    [lists, recurringRules, tasks],
  );
  const maxTrend = Math.max(1, ...stats.trend.map((item) => item.count));
  const maxCreatedTrend = Math.max(
    1,
    ...stats.trend.map((item) => item.created),
    ...stats.trend.map((item) => item.count),
  );
  const maxBar = Math.max(
    1,
    ...stats.priorityBars.map((item) => item.count),
    ...stats.listBars.map((item) => item.count),
  );

  return (
    <DialogShell
      title="统计洞察"
      icon={BarChart3}
      width="560px"
      presence={presence}
      onClose={onClose}
    >
      <div className="dialog-form">
        <div className="stats-overview">
          <div className="stats-metric">
            <span>总任务</span>
            <strong>{stats.total}</strong>
          </div>
          <div className="stats-metric">
            <span>待办</span>
            <strong>{stats.todo}</strong>
          </div>
          <div className="stats-metric">
            <span>已完成</span>
            <strong>{stats.done}</strong>
          </div>
          <div className="stats-metric">
            <span>完成率</span>
            <strong>{stats.rate}%</strong>
          </div>
          <div className="stats-metric">
            <span>本周完成</span>
            <strong>{stats.weekDone}</strong>
          </div>
          <div className="stats-metric">
            <span>连续完成</span>
            <strong>{stats.streak}天</strong>
          </div>
          <div className="stats-metric">
            <span>逾期率</span>
            <strong>{stats.overdueRate}%</strong>
          </div>
          <div className="stats-metric">
            <span>循环完成</span>
            <strong>{stats.recurringRate}%</strong>
          </div>
        </div>

        <section className="stats-section">
          <h3 className="stats-section-title">最近 7 天新增 / 完成</h3>
          <div className="stats-trend">
            {stats.trend.map((item) => (
              <div key={item.label} className="stats-trend-col">
                <span className="stats-trend-count">
                  {item.created > 0 || item.count > 0
                    ? `${item.created}/${item.count}`
                    : ""}
                </span>
                <div
                  className="stats-trend-bar stats-trend-created"
                  style={{
                    height: `${Math.max(
                      4,
                      Math.round((item.created / maxCreatedTrend) * 64),
                    )}px`,
                  }}
                />
                <div
                  className="stats-trend-bar stats-trend-done"
                  style={{
                    height: `${Math.max(
                      4,
                      Math.round((item.count / maxTrend) * 64),
                    )}px`,
                  }}
                />
                <span className="stats-trend-label">{item.label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="stats-section">
          <h3 className="stats-section-title">优先级分布</h3>
          {stats.priorityBars.map((item) => (
            <div key={item.label} className="stats-bar-row">
              <span className="stats-bar-label">
                <span
                  className="stats-bar-dot"
                  style={{ background: item.color }}
                />
                {item.label}
              </span>
              <div className="stats-bar-track">
                <div
                  className="stats-bar-fill"
                  style={{
                    width: `${Math.round((item.count / maxBar) * 100)}%`,
                    background: item.color,
                  }}
                />
              </div>
              <span className="stats-bar-count">{item.count}</span>
            </div>
          ))}
        </section>

        <section className="stats-section">
          <h3 className="stats-section-title">清单分布</h3>
          {stats.listBars.map((item) => (
            <div key={item.id} className="stats-bar-row">
              <span className="stats-bar-label">
                <span
                  className="stats-bar-dot"
                  style={{ background: item.color }}
                />
                {item.name}
              </span>
              <div className="stats-bar-track">
                <div
                  className="stats-bar-fill"
                  style={{
                    width: `${Math.round((item.count / maxBar) * 100)}%`,
                    background: item.color,
                  }}
                />
              </div>
              <span className="stats-bar-count">{item.count}</span>
            </div>
          ))}
        </section>

        <section className="stats-section">
          <h3 className="stats-section-title">清单完成率</h3>
          {stats.listRates.map((item) => (
            <div key={item.id} className="stats-bar-row">
              <span className="stats-bar-label">
                <span
                  className="stats-bar-dot"
                  style={{ background: item.color }}
                />
                {item.name}
              </span>
              <div className="stats-bar-track">
                <div
                  className="stats-bar-fill"
                  style={{
                    width: `${item.rate}%`,
                    background: item.color,
                  }}
                />
              </div>
              <span className="stats-bar-count">{item.rate}%</span>
            </div>
          ))}
        </section>
      </div>

      <footer className="dialog-footer">
        <button type="button" className="btn-secondary" onClick={onClose}>
          完成
        </button>
      </footer>
    </DialogShell>
  );
}

function buildStats(
  tasks: Task[],
  lists: TaskList[],
  recurringRules: RecurringRule[],
) {
  const active = tasks.filter((task) => !task.deletedAt);
  const total = active.length;
  const done = active.filter((task) => task.status === "done").length;
  const todo = total - done;
  const rate = total === 0 ? 0 : Math.round((done / total) * 100);
  const today = new Date();
  const weekStart = startOfWeek(today);
  const weekDone = active.filter(
    (task) =>
      task.status === "done" &&
      task.completedAt &&
      new Date(task.completedAt) >= weekStart,
  ).length;
  const streak = completionStreak(active);
  const datedTodo = active.filter(
    (task) => task.status !== "done" && task.dueAt,
  );
  const overdue = datedTodo.filter(
    (task) =>
      task.dueAt && localDateKey(new Date(task.dueAt)) < localDateKey(today),
  ).length;
  const overdueRate =
    datedTodo.length === 0 ? 0 : Math.round((overdue / datedTodo.length) * 100);
  const recurringTasks = active.filter((task) => task.recurringRuleId);
  const recurringDone = recurringTasks.filter(
    (task) => task.status === "done",
  ).length;
  const recurringRate =
    recurringTasks.length === 0
      ? recurringRules.length === 0
        ? 0
        : 100
      : Math.round((recurringDone / recurringTasks.length) * 100);

  const trend: Array<{ label: string; count: number; created: number }> = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - offset);
    const key = localDateKey(date);
    const count = active.filter(
      (task) => task.status === "done" && task.completedAt?.startsWith(key),
    ).length;
    const created = active.filter((task) =>
      task.createdAt.startsWith(key),
    ).length;
    trend.push({
      label: offset === 0 ? "今天" : weekdays[date.getDay()],
      count,
      created,
    });
  }

  const priorityBars = [2, 1, 0].map((priority) => ({
    label: priorityCopy[priority as 0 | 1 | 2].label,
    color: priorityColor(priority),
    count: active.filter((task) => task.priority === priority).length,
  }));

  const listBars = lists.map((list) => ({
    id: list.id,
    name: list.name,
    color: list.color ?? DEFAULT_LIST_COLOR,
    count: active.filter((task) => task.listId === list.id).length,
  }));
  const listRates = lists.map((list) => {
    const listTasks = active.filter((task) => task.listId === list.id);
    const listDone = listTasks.filter((task) => task.status === "done").length;
    return {
      id: list.id,
      name: list.name,
      color: list.color ?? DEFAULT_LIST_COLOR,
      rate:
        listTasks.length === 0
          ? 0
          : Math.round((listDone / listTasks.length) * 100),
    };
  });

  return {
    total,
    todo,
    done,
    rate,
    weekDone,
    streak,
    overdueRate,
    recurringRate,
    trend,
    priorityBars,
    listBars,
    listRates,
  };
}

function priorityColor(priority: number): string {
  if (priority === 2) return "var(--red)";
  if (priority === 1) return "var(--amber)";
  return "var(--blue)";
}

function startOfWeek(date: Date): Date {
  const value = new Date(date);
  const leading = (value.getDay() + 6) % 7;
  value.setHours(0, 0, 0, 0);
  value.setDate(value.getDate() - leading);
  return value;
}

function completionStreak(tasks: Task[]): number {
  let streak = 0;
  const date = new Date();
  for (let index = 0; index < 366; index += 1) {
    const key = localDateKey(date);
    const hasCompleted = tasks.some(
      (task) => task.status === "done" && task.completedAt?.startsWith(key),
    );
    if (!hasCompleted) break;
    streak += 1;
    date.setDate(date.getDate() - 1);
  }
  return streak;
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
