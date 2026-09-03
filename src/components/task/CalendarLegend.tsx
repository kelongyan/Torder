import type { CSSProperties } from "react";

/**
 * 设计稿 V-3 月历图例：四类任务状态色块
 * （今天 / 选中日 / 已逾期 / 已完成）。
 * 同时在第二个区段保留日程事件类型，
 * 避免原有页面失去事件类型提示。
 */
export function CalendarLegend() {
  return (
    <footer className="month-legend">
      <span className="month-legend-group" aria-label="任务状态">
        <span className="month-legend-item">
          <span className="month-legend-swatch is-today" aria-hidden="true" />
          今天
        </span>
        <span className="month-legend-item">
          <span
            className="month-legend-swatch is-selected"
            aria-hidden="true"
            style={{ borderColor: "var(--blue)" } as CSSProperties}
          />
          选中日
        </span>
        <span className="month-legend-item">
          <span className="month-legend-swatch is-overdue" aria-hidden="true" />
          已逾期
        </span>
        <span className="month-legend-item">
          <span className="month-legend-swatch is-done" aria-hidden="true" />
          已完成
        </span>
      </span>
      <span className="month-legend-group" aria-label="日程事件">
        <span className="month-legend-item">
          <span className="month-legend-swatch is-leave" aria-hidden="true" />
          休假
        </span>
        <span className="month-legend-item">
          <span className="month-legend-swatch is-trip" aria-hidden="true" />
          出差
        </span>
        <span className="month-legend-item">
          <span className="month-legend-swatch is-other" aria-hidden="true" />
          其他
        </span>
      </span>
    </footer>
  );
}
