import { useMemo } from "react";
import { BarChart3 } from "lucide-react";
import { DialogShell } from "./DialogShell";
import type { PresencePhase } from "../../hooks/usePresence";
import { priorityCopy } from "../../constants/taskConfig";
import { DEFAULT_LIST_COLOR } from "../../constants/listConfig";
import type { Task, TaskList } from "../../types/database";

const weekdays = ["日", "一", "二", "三", "四", "五", "六"];

export function StatsDialog({
  tasks,
  lists,
  presence,
  onClose,
}: {
  tasks: Task[];
  lists: TaskList[];
  presence: PresencePhase;
  onClose: () => void;
}) {
  const stats = useMemo(() => buildStats(tasks, lists), [tasks, lists]);
  const maxTrend = Math.max(1, ...stats.trend.map((item) => item.count));
  const maxBar = Math.max(
    1,
    ...stats.priorityBars.map((item) => item.count),
    ...stats.listBars.map((item) => item.count),
  );

  return (
    <div className="dialog-overlay">
      <DialogShell
        title="统计洞察"
        subtitle="任务完成情况一览"
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
          </div>

          <section className="stats-section">
            <h3 className="stats-section-title">最近 7 天完成趋势</h3>
            <div className="stats-trend">
              {stats.trend.map((item) => (
                <div key={item.label} className="stats-trend-col">
                  <span className="stats-trend-count">
                    {item.count > 0 ? item.count : ""}
                  </span>
                  <div
                    className="stats-trend-bar"
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
        </div>

        <footer className="dialog-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>
            完成
          </button>
        </footer>
      </DialogShell>
    </div>
  );
}

function buildStats(tasks: Task[], lists: TaskList[]) {
  const active = tasks.filter((task) => !task.deletedAt);
  const total = active.length;
  const done = active.filter((task) => task.status === "done").length;
  const todo = total - done;
  const rate = total === 0 ? 0 : Math.round((done / total) * 100);

  const trend: Array<{ label: string; count: number }> = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - offset);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const count = active.filter(
      (task) => task.status === "done" && task.completedAt?.startsWith(key),
    ).length;
    trend.push({
      label: offset === 0 ? "今天" : weekdays[date.getDay()],
      count,
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

  return { total, todo, done, rate, trend, priorityBars, listBars };
}

function priorityColor(priority: number): string {
  if (priority === 2) return "var(--red)";
  if (priority === 1) return "var(--amber)";
  return "var(--blue)";
}
