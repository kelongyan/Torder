import type { Task, TaskList } from "../../types/database";
import { listProgress } from "../../utils/taskStats";

/**
 * 项目详情页头（阶段 D / T-06）：清单进入 list 布局时展示在列表上方。
 * 单行布局：标题/副标题 + 内联数字统计（无框）+ 细进度条（百分比 + 轨道）。
 * 2026-10-06 重设计：移除渐变清单徽标——清单色身份移交给进度条填充；
 * 64px 渐变圆环换成细进度条，与无框统计同一套视觉语言，弱装饰、强扫读。
 * 统计口径来自 taskStats（与 T-04 每日回顾同一实现，禁止另写）。
 * 空项目空态由下方 TaskListView 的 EmptyState 承接（主操作新建第一个事项）。
 */

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
  const percent = Math.round(ratio * 100);
  const accentColor = list.color ?? "var(--accent)";

  return (
    <div className="project-header">
      <div className="project-header-main">
        <div className="project-title-col">
          <h2 className="project-title">{list.name}</h2>
          <p className="project-subtitle">
            {progress.total === 0
              ? "空清单——还没有任务"
              : `${progress.done} / ${progress.total} 已完成`}
          </p>
        </div>
        <div className="project-cards">
          <div className="project-stat is-total">
            <span className="project-stat-value">{progress.total}</span>
            <span className="project-stat-label">总事项</span>
          </div>
          <div className="project-stat is-doing">
            <span className="project-stat-value">{progress.todo}</span>
            <span className="project-stat-label">进行中</span>
          </div>
          <div className="project-stat is-done">
            <span className="project-stat-value">{progress.done}</span>
            <span className="project-stat-label">已完成</span>
          </div>
        </div>
        <div
          className="project-progress"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="清单完成度"
        >
          <span className="project-progress-value">{percent}%</span>
          <span className="project-progress-track">
            <span
              className="project-progress-fill"
              style={{ width: `${ratio * 100}%`, backgroundColor: accentColor }}
            />
          </span>
        </div>
      </div>
    </div>
  );
}
