/**
 * 主头副标内的视图摘要：左起线性进度条 + done/total + 逾期警告。
 * 设计稿 H-1：「3/11 项已完成 · 逾期 2」。
 * 行为不可见时（done=0 且 overdue=0）整体不渲染，保持主头极简。
 */

export function ViewSummary({
  done,
  total,
  overdue,
}: {
  done: number;
  total: number;
  overdue: number;
}) {
  const visible = total > 0 && (done > 0 || overdue > 0);
  if (!visible) return null;
  const ratio = total > 0 ? Math.min(1, done / total) : 0;
  return (
    <span className="view-summary" aria-label={`已完成 ${done}/${total}${overdue > 0 ? `, 逾期 ${overdue}` : ""}`}>
      <span
        className="view-summary-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
      >
        <span
          className="view-summary-fill"
          style={{ width: `${ratio * 100}%` }}
        />
      </span>
      <span className="view-summary-text">
        {done}/{total} 项已完成
      </span>
      {overdue > 0 && (
        <span className="view-summary-overdue">逾期 {overdue}</span>
      )}
    </span>
  );
}
