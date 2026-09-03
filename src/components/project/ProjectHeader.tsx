import { ListChecks, CheckCircle2, Circle } from "lucide-react";
import type { Task, TaskList } from "../../types/database";
import { listProgress } from "../../utils/taskStats";

/**
 * 项目详情页头（阶段 D / T-06）：清单进入 list 布局时展示在列表上方。
 * 项目色点 + 进度环（完成比例）+ 三统计卡（总/进行/完成）。
 * 统计口径来自 taskStats（与 T-04 每日回顾同一实现，禁止另写）。
 * 空项目空态由下方 TaskListView 的 EmptyState 承接（主操作新建第一个事项）。
 */

const RING_RADIUS = 22;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function ProjectHeader({
  list,
  tasks,
}: {
  list: TaskList;
  /** 该清单的全量任务（不过滤 showCompleted）。 */
  tasks: Task[];
}) {
  const progress = listProgress(tasks);
  const ratio = Math.min(1, Math.max(0, progress.ratio));
  const offset = RING_CIRCUMFERENCE * (1 - ratio);

  return (
    <div className="project-header">
      <div className="project-header-main">
        <div
          className="project-avatar"
          style={{ backgroundColor: list.color ?? "var(--accent)" }}
          aria-hidden="true"
        >
          <ListChecks className="icon-sm" />
        </div>
        <div className="project-title-col">
          <h2 className="project-title">{list.name}</h2>
          <p className="project-subtitle">
            {progress.total === 0
              ? "空清单——还没有任务"
              : `${progress.done} / ${progress.total} 已完成`}
          </p>
        </div>
        <div
          className="project-ring"
          role="img"
          aria-label={`完成度 ${Math.round(ratio * 100)}%`}
        >
          <svg width="56" height="56" viewBox="0 0 56 56">
            <circle
              cx="28"
              cy="28"
              r={RING_RADIUS}
              fill="none"
              stroke="var(--border-subtle)"
              strokeWidth="5"
            />
            <circle
              cx="28"
              cy="28"
              r={RING_RADIUS}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={offset}
              transform="rotate(-90 28 28)"
            />
          </svg>
          <span className="project-ring-text">{Math.round(ratio * 100)}%</span>
        </div>
      </div>
      <div className="project-cards">
        <div className="project-stat">
          <ListChecks
            aria-hidden="true"
            className="icon-sm project-stat-icon"
          />
          <span className="project-stat-value">{progress.total}</span>
          <span className="project-stat-label">总事项</span>
        </div>
        <div className="project-stat">
          <Circle aria-hidden="true" className="icon-sm project-stat-icon" />
          <span className="project-stat-value">{progress.todo}</span>
          <span className="project-stat-label">进行中</span>
        </div>
        <div className="project-stat">
          <CheckCircle2
            aria-hidden="true"
            className="icon-sm project-stat-icon"
          />
          <span className="project-stat-value">{progress.done}</span>
          <span className="project-stat-label">已完成</span>
        </div>
      </div>
    </div>
  );
}
