import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { CalendarEvent, Task, TaskList } from "../../types/database";
import { calendarEventTypeCopy } from "../../constants/calendarEventConfig";
import {
  WEEKDAY_LABELS,
  buildEventsByDate,
  buildTasksByDate,
  buildUnscheduledTasks,
  toDateKey,
} from "../../utils/calendarGrid";
import { CalendarLegend } from "./CalendarLegend";
import {
  CalendarDateDropZone,
  CalendarTaskDndProvider,
  DraggableCalendarTask,
} from "./CalendarTaskDnd";

function startOfMonth(year: number, month: number): Date {
  return new Date(year, month, 1);
}

function monthTitle(year: number, month: number): string {
  return `${year}年${month + 1}月`;
}

export function MonthCalendar({
  tasks,
  lists,
  events,
  showCompleted,
  onOpenTask,
  onCreateTask,
  onCreateEvent,
  onEditEvent,
  onMoveTaskDate,
}: {
  tasks: Task[];
  lists: TaskList[];
  events: CalendarEvent[];
  showCompleted: boolean;
  onOpenTask: (task: Task) => void;
  onCreateTask: (date: string) => void;
  onCreateEvent: (date: string) => void;
  onEditEvent: (event: CalendarEvent) => void;
  onMoveTaskDate: (taskId: string, date: string) => Promise<void>;
}) {
  const today = new Date();
  const [cursor, setCursor] = useState({
    year: today.getFullYear(),
    month: today.getMonth(),
  });
  // R5 当日面板：默认选中今天，点格切换
  const [selectedKey, setSelectedKey] = useState(() => toDateKey(today));
  const tasksByDate = useMemo(
    () => buildTasksByDate(tasks, showCompleted),
    [showCompleted, tasks],
  );
  const unscheduledTasks = useMemo(
    () => buildUnscheduledTasks(tasks, showCompleted),
    [showCompleted, tasks],
  );

  const eventsByDate = useMemo(() => buildEventsByDate(events), [events]);

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

  // R5 当日面板数据：选中日的事件 + 任务（按时刻排序）
  const selectedDate = useMemo(() => {
    if (!selectedKey) return null;
    const [y, m, d] = selectedKey.split("-").map(Number);
    return new Date(y, (m ?? 1) - 1, d ?? 1);
  }, [selectedKey]);
  const selectedTasks = selectedKey ? (tasksByDate.get(selectedKey) ?? []) : [];
  const selectedEvents = selectedKey ? (eventsByDate.get(selectedKey) ?? []) : [];
  const selectedLabel = selectedDate
    ? `${selectedDate.getMonth() + 1}月${selectedDate.getDate()}日`
    : "";

  const moveMonth = (delta: number) => {
    setCursor((current) => {
      const total = current.year * 12 + current.month + delta;
      return { year: Math.floor(total / 12), month: total % 12 };
    });
  };

  return (
    <CalendarTaskDndProvider onMoveTaskDate={onMoveTaskDate}>
      <div className="month-view">
        <div className="month-layout">
          <div className="month-main">
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
                setCursor({
                  year: today.getFullYear(),
                  month: today.getMonth(),
                })
              }
            >
              今天
            </button>
          </div>
          <button
            type="button"
            className="btn-primary"
            onClick={() => onCreateEvent(todayKey)}
          >
            <CalendarDays aria-hidden="true" className="icon-sm" />
            新建事件
          </button>
        </header>

        {unscheduledTasks.length > 0 && (
          <section className="month-unscheduled" aria-label="待安排任务">
            <header>
              <strong>待安排</strong>
              <span>{unscheduledTasks.length} 项</span>
            </header>
            <div className="month-unscheduled-list">
              {unscheduledTasks.map((task) => (
                <DraggableCalendarTask
                  key={task.id}
                  task={task}
                  className="month-unscheduled-task"
                  onOpen={onOpenTask}
                />
              ))}
            </div>
          </section>
        )}

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
            // R5 对齐设计稿：任务/事件条最多 3 条，超出折叠为「+N」
            const visibleTaskCount = Math.max(0, 3 - dayEvents.length);
            const overflowCount =
              dayEvents.length + dayTasks.length - 3 > 0
                ? dayEvents.length + dayTasks.length - 3
                : 0;
            return (
              <CalendarDateDropZone
                key={key}
                dateKey={key}
                className={`month-cell ${inMonth ? "" : "is-outside"} ${key === todayKey ? "is-today" : ""} ${key === selectedKey ? "is-sel" : ""}`}
                role="gridcell"
              >
                <div
                  className="month-cell-top"
                  onClick={() => setSelectedKey(key)}
                >
                  <span className="month-cell-date">{date.getDate()}</span>
                  <button
                    type="button"
                    className="month-cell-add"
                    onClick={(event) => {
                      event.stopPropagation();
                      onCreateTask(key);
                    }}
                    aria-label={`${key} 新建任务`}
                    title="新建任务"
                  >
                    <Plus aria-hidden="true" />
                  </button>
                </div>
                <div
                  className="month-cell-body"
                  onClick={() => setSelectedKey(key)}
                >
                  {dayEvents.map((event) => (
                    <button
                      key={event.id}
                      type="button"
                      className={`month-event month-event-${event.eventType}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditEvent(event);
                      }}
                      title={`${calendarEventTypeCopy[event.eventType].label}：${event.title}`}
                    >
                      {event.title}
                    </button>
                  ))}
                  {dayTasks
                    .slice(0, visibleTaskCount)
                    .map((task) => (
                      <DraggableCalendarTask
                        key={task.id}
                        task={task}
                        onOpen={onOpenTask}
                      />
                    ))}
                  {overflowCount > 0 && (
                    <span className="month-cell-more">+{overflowCount} 更多</span>
                  )}
                </div>
              </CalendarDateDropZone>
            );
          })}
        </div>
          </div>

          {/* R5 当日面板（设计稿 .month__side 264px）：展示选中日的事件与任务 */}
          <aside className="month-side" aria-label="当日事项">
            <header className="month-side-head">
              <strong>{selectedLabel}</strong>
              <span>{selectedTasks.length + selectedEvents.length} 项</span>
            </header>
            {selectedTasks.length + selectedEvents.length === 0 ? (
              <p className="month-side-empty">当天暂无事项</p>
            ) : (
              <div className="month-side-list">
                {selectedEvents.map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    className="month-side-item"
                    onClick={() => onEditEvent(event)}
                  >
                    <span className="month-side-time">
                      {event.startDate
                        ? new Date(event.startDate).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
                        : "全天"}
                    </span>
                    <span className="month-side-title">{event.title}</span>
                  </button>
                ))}
                {selectedTasks.map((task) => {
                  const list = lists.find((item) => item.id === task.listId);
                  const time = task.dueAt
                    ? new Date(task.dueAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
                    : null;
                  return (
                    <button
                      key={task.id}
                      type="button"
                      className={`month-side-item ${task.status === "done" ? "is-done" : ""}`}
                      onClick={() => onOpenTask(task)}
                    >
                      <span className="month-side-time">
                        {time ?? "全天"}
                      </span>
                      <span
                        className="list-dot"
                        style={{
                          backgroundColor: list?.color ?? "#6e9bff",
                          color: list?.color ?? "#6e9bff",
                        }}
                        aria-hidden="true"
                      />
                      <span className="month-side-title">{task.title}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </aside>
        </div>

        <CalendarLegend />
      </div>
    </CalendarTaskDndProvider>
  );
}
