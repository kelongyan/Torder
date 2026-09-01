import { ChevronRight } from "lucide-react";

/**
 * 粘性分组头：折叠箭头 + 标题 + 分隔线，右侧完成进度（线性条 + done/total）。
 * 滚动时悬挂在内容区顶部（由 .section-header 的 sticky + 毛玻璃底承载）。
 */
export function SectionHeader({
  label,
  progress,
}: {
  label: string;
  progress?: { done: number; total: number };
}) {
  const ratio =
    progress && progress.total > 0
      ? Math.min(1, progress.done / progress.total)
      : 0;

  return (
    <div className="section-header">
      <span className="section-header-chevron" aria-hidden="true">
        <ChevronRight />
      </span>
      <span className="section-header-label">{label}</span>
      <span className="section-header-rule" aria-hidden="true" />
      {progress && (
        <span
          className="section-progress"
          title={`已完成 ${progress.done}/${progress.total}`}
        >
          <span
            className="section-progress-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.done}
            aria-label={`已完成 ${progress.done}/${progress.total}`}
          >
            <span
              className="section-progress-fill"
              style={{ width: `${ratio * 100}%` }}
            />
          </span>
          <span className="section-progress-text">
            {progress.done}/{progress.total}
          </span>
        </span>
      )}
    </div>
  );
}
