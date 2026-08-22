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

function startOfMonth(year: number, month: number): Date {
  return new Date(year, month, 1);
}

function toDateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function monthTitle(year: number, month: number): string {
  return `${year}年${month + 1}月`;
}

export function MonthCalendar({
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
  const [cursor, setCursor] = useState({
    year: today.getFullYear(),
    month: today.getMonth(),
  });

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

  const cells = useMemo(() => {
    const first = startOfMonth(cursor.year, cursor.month);
    const gridStart = new Date(first);
    const leading = (first.getDay() + 6) % 7; // 周一开头
    gridStart.setDate(first.getDate() - leading);
    const result: Date[] = [];
    for (let index = 0; index < 42; index += 1) {
      const date = new Date(gridStart);
      date.setDate(gridStart.getDate() + index);
      result.push(date);
    }
    return result;
  }, [cursor]);

  const todayKey = toDateKey(today);

  const moveMonth = (delta: number) => {
    setCursor((current) => {
      const total = current.year * 12 + current.month + delta;
      return { year: Math.floor(total / 12), month: total % 12 };
    });
  };

  return (
    <div className="month-view">
      <header className="month-header">
        <div className="month-nav">
          <button
            type="button"
            className="icon-button"
            onClick={() => moveMonth(-1)}
            aria-label="上个月"
          >
            <ChevronLeft aria-hidden="true" />
          </button>
          <h2 className="month-title">
            {monthTitle(cursor.year, cursor.month)}
          </h2>
          <button
            type="button"
            className="icon-button"
            onClick={() => moveMonth(1)}
            aria-label="下个月"
          >
            <ChevronRight aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn-secondary month-today"
            onClick={() =>
              setCursor({ year: today.getFullYear(), month: today.getMonth() })
            }
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

      <div className="month-grid" role="grid">
        {cells.map((date) => {
          const key = toDateKey(date);
          const inMonth = date.getMonth() === cursor.month;
          const dayTasks = tasksByDate.get(key) ?? [];
          const dayEvents = eventsByDate.get(key) ?? [];
          const visibleTasks = dayTasks.slice(0, 2);
          const overflow = dayTasks.length - visibleTasks.length;
          return (
            <div
              key={key}
              className={`month-cell ${inMonth ? "" : "is-outside"} ${key === todayKey ? "is-today" : ""}`}
              role="gridcell"
            >
              <div className="month-cell-top">
                <span className="month-cell-date">{date.getDate()}</span>
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
              {visibleTasks.map((task) => (
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
              {overflow > 0 && (
                <span className="month-cell-more">+{overflow} 项任务</span>
              )}
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
