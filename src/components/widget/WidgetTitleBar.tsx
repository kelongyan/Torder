import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { parseDateKey as parseStrictDateKey } from "../../utils/taskDates";

const weekdayNames = ["日", "一", "二", "三", "四", "五", "六"];

// dateKey 恒为 toDateKey 生成的 YYYY-MM-DD；兜底的无效日期与旧实现
// 对非法输入的结果一致。
function parseDateKey(dateKey: string): Date {
  return parseStrictDateKey(dateKey) ?? new Date(NaN);
}

/** 抬头大标题：今天 / 明天 / 8月27日 */
function formatDateHeadline(dateKey: string, todayKey: string): string {
  if (dateKey === todayKey) return "今天";
  const date = parseDateKey(dateKey);
  const tomorrow = parseDateKey(todayKey);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (date.getTime() === tomorrow.getTime()) return "明天";
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatWeekdayLabel(dateKey: string): string {
  const date = parseDateKey(dateKey);
  return `周${weekdayNames[date.getDay()]}`;
}

/**
 * 竖版便签的抬头：日期升格成大标题（窄版放不下「标题 + 日期」两段文字），
 * 星期与完成进度退到第二行。
 */
export function WidgetTitleBar({
  onAdd,
  adding,
  onClose,
  dateKey,
  todayKey,
  isAnchored,
  progressLabel,
  onPrev,
  onNext,
  onBackToToday,
}: {
  /** 顶部 + 按钮：展开快速新增输入条 */
  onAdd: () => void;
  /** + 按钮处于激活态（输入条已展开）时视觉上高亮 */
  adding: boolean;
  /**
   * 关闭按钮点击回调。父组件 `WidgetApp` 负责播淡出动效
   * 然后再调 Rust 关闭（被 Rust 拦截为 hide）。
   */
  onClose: () => void;
  dateKey: string;
  todayKey: string;
  isAnchored: boolean;
  /** 第二行的进度文案；无任务时传 null，只留星期 */
  progressLabel: string | null;
  onPrev: () => void;
  onNext: () => void;
  onBackToToday: () => void;
}) {
  const meta = progressLabel
    ? `${formatWeekdayLabel(dateKey)} · ${progressLabel}`
    : formatWeekdayLabel(dateKey);

  return (
    <header className="widget-titlebar">
      <div className="widget-titlebar-row">
        <button
          type="button"
          className="widget-date-nav"
          aria-label="上一天"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onPrev}
        >
          <ChevronLeft aria-hidden="true" />
        </button>
        <h1 className="widget-title">
          {formatDateHeadline(dateKey, todayKey)}
        </h1>
        <button
          type="button"
          className="widget-date-nav"
          aria-label="下一天"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onNext}
        >
          <ChevronRight aria-hidden="true" />
        </button>
        <div className="widget-titlebar-actions">
          <button
            type="button"
            className={`widget-control widget-control-add ${adding ? "is-active" : ""}`.trim()}
            aria-label={adding ? "取消新增" : "新增任务"}
            aria-pressed={adding}
            onMouseDown={(event) => event.preventDefault()}
            onClick={onAdd}
          >
            <Plus aria-hidden="true" />
          </button>
          <button
            type="button"
            className="widget-close-btn"
            aria-label="隐藏小窗"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onClose}
          >
            <X aria-hidden="true" strokeWidth={2.2} />
          </button>
        </div>
      </div>
      <div className="widget-meta-row">
        <span className="widget-meta">{meta}</span>
        {isAnchored && (
          <button
            type="button"
            className="widget-date-today-btn"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onBackToToday}
          >
            回今天
          </button>
        )}
      </div>
    </header>
  );
}
