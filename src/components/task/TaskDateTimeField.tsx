import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  X,
} from "lucide-react";
import { toLocalDateTimeValue } from "../../app/taskDates";

const weekdayLabels = ["一", "二", "三", "四", "五", "六", "日"];
const quickTimes = ["09:00", "14:00", "18:00", "21:00"];
const hours = Array.from({ length: 24 }, (_, index) => index);
const minutes = Array.from({ length: 60 }, (_, index) => index);

export function TaskDateTimeField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedDate = useMemo(() => getSafeDate(value), [value]);
  const [open, setOpen] = useState(false);
  const [viewDate, setViewDate] = useState(
    () => new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1),
  );

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  const days = useMemo(() => buildMonthGrid(viewDate), [viewDate]);
  const selectedKey = value ? getDateKey(selectedDate) : "";

  function togglePicker() {
    if (open) {
      setOpen(false);
      return;
    }

    setViewDate(
      new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1),
    );
    setOpen(true);
  }

  function selectDate(date: Date) {
    const next = new Date(date);
    next.setHours(selectedDate.getHours(), selectedDate.getMinutes(), 0, 0);
    setViewDate(new Date(next.getFullYear(), next.getMonth(), 1));
    onChange(toLocalDateTimeValue(next));
  }

  function selectTime(hour: number, minute: number) {
    const next = new Date(selectedDate);
    next.setHours(hour, minute, 0, 0);
    onChange(toLocalDateTimeValue(next));
  }

  function moveMonth(offset: number) {
    setViewDate(
      (current) =>
        new Date(current.getFullYear(), current.getMonth() + offset, 1),
    );
  }

  function pickToday() {
    const today = new Date();
    today.setHours(selectedDate.getHours(), selectedDate.getMinutes(), 0, 0);
    setViewDate(new Date(today.getFullYear(), today.getMonth(), 1));
    onChange(toLocalDateTimeValue(today));
  }

  return (
    <div
      ref={containerRef}
      className="form-field date-time-field"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <span>截止日期时间</span>
      <div className="date-time-control">
        <button
          type="button"
          className={`date-time-trigger ${open ? "active" : ""}`}
          onClick={togglePicker}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <CalendarDays aria-hidden="true" className="icon-sm" />
          <span>
            <strong>{formatDateTimeLabel(value)}</strong>
            <small>{formatMonthHint(value)}</small>
          </span>
        </button>
        {value && (
          <button
            type="button"
            className="date-time-clear"
            onClick={() => onChange("")}
            aria-label="清除截止日期"
          >
            <X aria-hidden="true" />
          </button>
        )}
      </div>

      {open && (
        <div
          className="date-picker-panel"
          role="dialog"
          aria-label="选择截止日期时间"
        >
          <div className="date-picker-calendar">
            <div className="date-picker-toolbar">
              <button
                type="button"
                className="date-picker-nav"
                onClick={() => moveMonth(-1)}
                aria-label="上个月"
              >
                <ChevronLeft aria-hidden="true" />
              </button>
              <strong>{formatMonthTitle(viewDate)}</strong>
              <button
                type="button"
                className="date-picker-nav"
                onClick={() => moveMonth(1)}
                aria-label="下个月"
              >
                <ChevronRight aria-hidden="true" />
              </button>
            </div>

            <div className="date-picker-grid" aria-label="日期">
              {weekdayLabels.map((label) => (
                <span key={label} className="date-picker-weekday">
                  {label}
                </span>
              ))}
              {days.map((day) => (
                <button
                  key={day.key}
                  type="button"
                  className={[
                    "date-picker-day",
                    day.inMonth ? "" : "muted",
                    day.isToday ? "today" : "",
                    day.key === selectedKey ? "selected" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => selectDate(day.date)}
                >
                  {day.date.getDate()}
                </button>
              ))}
            </div>
          </div>

          <div className="date-picker-time">
            <div className="date-picker-time-title">
              <Clock3 aria-hidden="true" className="icon-sm" />
              <span>时间</span>
            </div>
            <div className="time-select-row">
              <label>
                <span>时</span>
                <select
                  value={String(selectedDate.getHours())}
                  onChange={(event) =>
                    selectTime(
                      Number(event.target.value),
                      selectedDate.getMinutes(),
                    )
                  }
                >
                  {hours.map((hour) => (
                    <option key={hour} value={hour}>
                      {pad(hour)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>分</span>
                <select
                  value={String(selectedDate.getMinutes())}
                  onChange={(event) =>
                    selectTime(
                      selectedDate.getHours(),
                      Number(event.target.value),
                    )
                  }
                >
                  {minutes.map((minute) => (
                    <option key={minute} value={minute}>
                      {pad(minute)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="quick-time-row">
              {quickTimes.map((time) => {
                const [hour, minute] = time.split(":").map(Number);
                const active =
                  selectedDate.getHours() === hour &&
                  selectedDate.getMinutes() === minute;
                return (
                  <button
                    key={time}
                    type="button"
                    className={active ? "active" : ""}
                    onClick={() => selectTime(hour, minute)}
                  >
                    {time}
                  </button>
                );
              })}
            </div>
            <div className="date-picker-actions">
              <button type="button" onClick={() => onChange("")}>
                清除
              </button>
              <button type="button" onClick={pickToday}>
                今天
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => setOpen(false)}
              >
                完成
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function buildMonthGrid(month: Date) {
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const gridStart = new Date(firstDay);
  gridStart.setDate(firstDay.getDate() - mondayOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return {
      date,
      key: getDateKey(date),
      inMonth: date.getMonth() === month.getMonth(),
      isToday: isSameDate(date, new Date()),
    };
  });
}

function getSafeDate(value: string): Date {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function formatDateTimeLabel(value: string): string {
  if (!value) return "选择截止日期时间";
  const date = getSafeDate(value);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  const dateLabel = isSameDate(date, today)
    ? "今天"
    : isSameDate(date, tomorrow)
      ? "明天"
      : `${date.getFullYear()}年${pad(date.getMonth() + 1)}月${pad(date.getDate())}日`;

  return `${dateLabel} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatMonthHint(value: string): string {
  if (!value) return "未设置截止时间";
  const date = getSafeDate(value);
  return formatMonthTitle(date);
}

function formatMonthTitle(date: Date): string {
  return `${date.getFullYear()}年${pad(date.getMonth() + 1)}月`;
}

function getDateKey(date: Date): string {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-");
}

function isSameDate(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
