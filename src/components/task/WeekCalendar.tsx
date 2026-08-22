import { useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plane,
  Sun,
} from "lucide-react";
import type { CalendarEvent, Task } from "../../types/database";
import { priorityCopy } from "../../constants/taskConfig";
import { calendarEventTypeCopy } from "../../constants/calendarEventConfig";

const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

function toDateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function startOfWeek(anchor: Date): Date {
  const date = new Date(
    anchor.getFullYear(),
    anchor.getMonth(),
    anchor.getDate(),
  );
  const leading = (date.getDay() + 6) % 7; // 周一开头
  date.setDate(date.getDate() - leading);
  return date;
}

export function WeekCalendar({
  tasks,
  events,
  showCompleted,
  onOpenTask,
  onCreateEvent,
  onEditEvent,
}: {
  tasks: Task[];
  events: CalendarEvent[];
  showCompleted: boolean;
  onOpenTask: (task: Task) => void;
  onCreateEvent: (date: string) => void;
  onEditEvent: (event: CalendarEvent) => void;
}) {
  const today = new Date();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(today));

  const tasksByDate = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of tasks) {
      if (
        !task.dueAt ||
        task.status === "archived" ||
        (!showCompleted && task.status === "done")
      ) {
        continue;
      }
      const key = toDateKey(new Date(task.dueAt));
      const bucket = map.get(key) ?? [];
      bucket.push(task);
      map.set(key, bucket);
    }
    return map;
  }, [showCompleted, tasks]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      const start = new Date(`${event.startDate}T00:00:00`);
      const end = new Date(`${event.endDate}T00:00:00`);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const key = toDateKey(d);
        const bucket = map.get(key) ?? [];
        bucket.push(event);
        map.set(key, bucket);
      }
    }
    return map;
  }, [events]);

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + index);
      return date;
    });
  }, [weekStart]);

  const todayKey = toDateKey(today);
  const weekTitle = useMemo(() => {
    const start = weekDays[0];
    const end = weekDays[6];
    const sameMonth = start.getMonth() === end.getMonth();
    if (sameMonth && start.getFullYear() === end.getFullYear()) {
      return `${start.getFullYear()}年${start.getMonth() + 1}月${start.getDate()}日 - ${end.getDate()}日`;
    }
    return `${start.getMonth() + 1}月${start.getDate()}日 - ${end.getMonth() + 1}月${end.getDate()}日`;
  }, [weekDays]);

  const moveWeek = (delta: number) => {
    setWeekStart((current) => {
      const next = new Date(current);
      next.setDate(current.getDate() + delta * 7);
      return next;
    });
  };

  return (
    <div className="month-view week-view">
      <header className="month-header">
        <div className="month-nav">
          <button
            type="button"
            className="icon-button"
            onClick={() => moveWeek(-1)}
            aria-label="上一周"
          >
            <ChevronLeft aria-hidden="true" />
          </button>
          <h2 className="month-title">{weekTitle}</h2>
          <button
            type="button"
            className="icon-button"
            onClick={() => moveWeek(1)}
            aria-label="下一周"
          >
            <ChevronRight aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn-secondary month-today"
            onClick={() => setWeekStart(startOfWeek(today))}
          >
            今天
          </button>
        </div>
        <button
          type="button"
          className="btn-primary month-add-event"
          onClick={() => onCreateEvent(todayKey)}
        >
          <CalendarDays aria-hidden="true" className="icon-sm" />
          新建事件
        </button>
      </header>

      <div className="month-weekdays" role="row">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="month-weekday" role="columnheader">
            周{label}
          </div>
        ))}
      </div>

      <div className="month-grid week-grid" role="grid">
        {weekDays.map((date) => {
          const key = toDateKey(date);
          const dayTasks = tasksByDate.get(key) ?? [];
          const dayEvents = eventsByDate.get(key) ?? [];
          const isToday = key === todayKey;
          return (
            <div
              key={key}
              className={`month-cell week-cell ${isToday ? "is-today" : ""}`}
              role="gridcell"
            >
              <div className="month-cell-top">
                <span className="month-cell-date">
                  {date.getMonth() + 1}/{date.getDate()}
                </span>
                <button
                  type="button"
                  className="month-cell-add"
                  onClick={() => onCreateEvent(key)}
                  aria-label={`${key} 新建事件`}
                  title="新建日程事件"
                >
                  +
                </button>
              </div>
              <div className="week-cell-body">
                {dayEvents.map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    className={`month-event month-event-${event.eventType}`}
                    onClick={() => onEditEvent(event)}
                    title={`${calendarEventTypeCopy[event.eventType].label}：${event.title}`}
                  >
                    {event.title}
                  </button>
                ))}
                {dayTasks.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    className="month-task"
                    onClick={() => onOpenTask(task)}
                    title={task.title}
                  >
                    <span
                      className={`month-task-dot ${priorityCopy[task.priority].className}`}
                      aria-hidden="true"
                    />
                    <span className="month-task-title">{task.title}</span>
                  </button>
                ))}
                {dayTasks.length === 0 && dayEvents.length === 0 && (
                  <span className="week-cell-empty" aria-hidden="true" />
                )}
              </div>
            </div>
          );
        })}
      </div>

      <footer className="month-legend">
        <span className="month-legend-item">
          <Sun aria-hidden="true" className="month-legend-icon leave" />
          休假
        </span>
        <span className="month-legend-item">
          <Plane aria-hidden="true" className="month-legend-icon trip" />
          出差
        </span>
      </footer>
    </div>
  );
}
