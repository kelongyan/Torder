import { ChevronLeft, ChevronRight } from "lucide-react";

const weekdayNames = ["日", "一", "二", "三", "四", "五", "六"];

function parseDateKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDateLabel(dateKey: string, todayKey: string): string {
  if (dateKey === todayKey) return "今天";
  const date = parseDateKey(dateKey);
  const tomorrow = parseDateKey(todayKey);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (date.getTime() === tomorrow.getTime()) return "明天";
  return `${date.getMonth() + 1}月${date.getDate()}日 周${
    weekdayNames[date.getDay()]
  }`;
}

export function WidgetDateBar({
  dateKey,
  todayKey,
  isAnchored,
  onPrev,
  onNext,
  onBackToToday,
}: {
  dateKey: string;
  todayKey: string;
  isAnchored: boolean;
  onPrev: () => void;
  onNext: () => void;
  onBackToToday: () => void;
}) {
  return (
    <div className="widget-datebar">
      <button
        type="button"
        className="widget-date-nav"
        aria-label="上一天"
        onClick={onPrev}
      >
        <ChevronLeft aria-hidden="true" />
      </button>
      <span className="widget-date-label">{formatDateLabel(dateKey, todayKey)}</span>
      <button
        type="button"
        className="widget-date-nav"
        aria-label="下一天"
        onClick={onNext}
      >
        <ChevronRight aria-hidden="true" />
      </button>
      {isAnchored && (
        <button type="button" className="widget-date-today-btn" onClick={onBackToToday}>
          回到今天
        </button>
      )}
    </div>
  );
}
