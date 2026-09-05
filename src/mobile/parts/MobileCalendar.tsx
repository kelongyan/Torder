/**
 * mobile/parts/MobileCalendar.tsx — 移动端专属月历组件
 * 对齐 `设计稿/phone/js/views/calendarView.js`：
 *  - 顶部月份切换与回到今天快捷 Chip
 *  - 7 列紧凑月历卡片（42格，任务彩色圆点 + 日历事件下划色条）
 *  - 选中日 Agenda 议程区（事件色带 + 任务列表 + 空状态引导）
 */
import { useMemo, useState, type JSX } from "react";
import {
  CalendarCheck,
  CalendarDays,
  CalendarX2,
  ChevronLeft,
  ChevronRight,
  Palmtree,
  Plane,
  Plus,
} from "lucide-react";
import type { CalendarEvent, Task, TaskList } from "../../types/database";
import {
  WEEKDAY_LABELS,
  buildEventsByDate,
  buildTasksByDate,
  toDateKey,
} from "../../utils/calendarGrid";
import { MobileTaskRow } from "./MobileTaskRow";
import { EmptyView, SectionTitle } from "../ui";

interface CellData {
  key: string;
  day: number;
  outside: boolean;
  date: Date;
}

const EVENT_TYPE_META: Record<
  string,
  { label: string; icon: JSX.Element; color: string }
> = {
  trip: {
    label: "出差/行程",
    icon: <Plane aria-hidden="true" size={16} />,
    color: "var(--p-blue)",
  },
  leave: {
    label: "请假",
    icon: <Palmtree aria-hidden="true" size={16} />,
    color: "var(--green)",
  },
  other: {
    label: "日程事件",
    icon: <CalendarDays aria-hidden="true" size={16} />,
    color: "var(--amber)",
  },
};

export function MobileCalendar({
  tasks,
  lists,
  events,
  showCompleted,
  onOpenTask,
  onCreateTask,
  onToggleTask,
  onDeleteTask,
  onMoreTask,
}: {
  tasks: Task[];
  lists: TaskList[];
  events: CalendarEvent[];
  showCompleted: boolean;
  onOpenTask: (task: Task) => void;
  onCreateTask: (dateKey: string) => void;
  onToggleTask: (task: Task) => void;
  onDeleteTask: (task: Task) => void;
  onMoreTask?: (task: Task) => void;
}): JSX.Element {
  const today = useMemo(() => new Date(), []);
  const todayKey = useMemo(() => toDateKey(today), [today]);

  const [cursor, setCursor] = useState({
    year: today.getFullYear(),
    month: today.getMonth(),
  });
  const [selectedKey, setSelectedKey] = useState<string>(todayKey);

  const listsMap = useMemo(() => {
    const map = new Map<string, TaskList>();
    for (const l of lists) map.set(l.id, l);
    return map;
  }, [lists]);

  const tasksByDate = useMemo(
    () => buildTasksByDate(tasks, showCompleted),
    [tasks, showCompleted],
  );

  const eventsByDate = useMemo(() => buildEventsByDate(events), [events]);

  // 切月
  const shiftMonth = (delta: number) => {
    const d = new Date(cursor.year, cursor.month + delta, 1);
    setCursor({ year: d.getFullYear(), month: d.getMonth() });
  };

  // 回到今天
  const goToday = () => {
    const d = new Date();
    setCursor({ year: d.getFullYear(), month: d.getMonth() });
    setSelectedKey(toDateKey(d));
  };

  // 生成 6×7 = 42 单元格
  const cells: CellData[] = useMemo(() => {
    const first = new Date(cursor.year, cursor.month, 1);
    const startWeekday = (first.getDay() + 6) % 7; // 周一为 0
    const start = new Date(cursor.year, cursor.month, 1 - startWeekday);
    const result: CellData[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      result.push({
        key: toDateKey(d),
        day: d.getDate(),
        outside: d.getMonth() !== cursor.month,
        date: d,
      });
    }
    return result;
  }, [cursor.year, cursor.month]);

  // 选中日内容过滤
  const dayAllTasks = useMemo(
    () => tasksByDate.get(selectedKey) ?? [],
    [tasksByDate, selectedKey],
  );
  const dayPendingTasks = useMemo(
    () => dayAllTasks.filter((t) => t.status !== "done"),
    [dayAllTasks],
  );
  const dayDoneTasks = useMemo(
    () => dayAllTasks.filter((t) => t.status === "done"),
    [dayAllTasks],
  );
  const dayEvents = useMemo(
    () => eventsByDate.get(selectedKey) ?? [],
    [eventsByDate, selectedKey],
  );

  // 选中日中文标题
  const selectedLabel = useMemo(() => {
    const [y, m, d] = selectedKey.split("-").map(Number);
    if (!y || !m || !d) return "日程详情";
    const dateObj = new Date(y, m - 1, d);
    const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    return `${m}月${d}日 · ${weekdays[dateObj.getDay()]}`;
  }, [selectedKey]);

  return (
    <div className="m-calendar-view">
      {/* 顶部切月栏 */}
      <div className="m-cal-header">
        <div className="m-cal-month-title">
          {cursor.year} 年 {cursor.month + 1} 月
        </div>
        <div className="m-cal-header-actions">
          <button
            type="button"
            className="m-cal-nav-btn"
            aria-label="上个月"
            onClick={() => shiftMonth(-1)}
          >
            <ChevronLeft size={20} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="m-cal-nav-btn"
            aria-label="下个月"
            onClick={() => shiftMonth(1)}
          >
            <ChevronRight size={20} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`m-cal-today-btn ${selectedKey === todayKey ? "active" : ""}`}
            onClick={goToday}
          >
            <CalendarCheck size={14} aria-hidden="true" />
            <span>今天</span>
          </button>
        </div>
      </div>

      {/* 7 列月历卡片 */}
      <div className="m-cal-card">
        <div className="m-cal-weekrow">
          {WEEKDAY_LABELS.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>
        <div className="m-cal-grid">
          {cells.map((cell) => {
            const cellTasks = tasksByDate.get(cell.key) ?? [];
            const cellEvents = eventsByDate.get(cell.key) ?? [];
            const isToday = cell.key === todayKey;
            const isSelected = cell.key === selectedKey;
            const hasEvents = cellEvents.length > 0;

            return (
              <button
                key={cell.key}
                type="button"
                className={[
                  "m-cal-cell",
                  cell.outside ? "outside" : "",
                  isToday ? "today" : "",
                  isSelected ? "selected" : "",
                  hasEvents ? "has-event-band" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => setSelectedKey(cell.key)}
              >
                <span className="m-cal-num">{cell.day}</span>
                <span className="m-cal-dots">
                  {cellTasks.slice(0, 3).map((t, idx) => {
                    const dotColor =
                      t.priority === 2
                        ? "var(--red)"
                        : (listsMap.get(t.listId)?.color ?? "var(--accent)");
                    return (
                      <i
                        key={t.id ?? idx}
                        style={{ background: dotColor }}
                        aria-hidden="true"
                      />
                    );
                  })}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 选中日 Agenda 议程 */}
      <div className="m-cal-agenda">
        <SectionTitle
          right={
            <button
              type="button"
              className="m-cal-add-btn"
              onClick={() => onCreateTask(selectedKey)}
            >
              <Plus size={14} aria-hidden="true" />
              <span>添加任务</span>
            </button>
          }
        >
          {selectedLabel}
          <span className="m-cal-count-badge">
            {dayPendingTasks.length + dayDoneTasks.length + dayEvents.length}
          </span>
        </SectionTitle>

        {/* 日历事件横条 */}
        {dayEvents.map((evt) => {
          const meta =
            EVENT_TYPE_META[evt.eventType] ?? EVENT_TYPE_META.other;
          return (
            <div
              key={evt.id}
              className="m-event-band"
              style={
                {
                  "--band-color": meta.color,
                } as React.CSSProperties
              }
            >
              <span className="m-event-icon">{meta.icon}</span>
              <div className="m-event-info">
                <strong className="m-event-title">{evt.title}</strong>
                {evt.note ? (
                  <span className="m-event-note">{evt.note}</span>
                ) : null}
              </div>
              <span className="m-event-badge">{meta.label}</span>
            </div>
          );
        })}

        {/* 当日待办任务 */}
        {dayPendingTasks.map((task) => (
          <MobileTaskRow
            key={task.id}
            task={task}
            listColor={listsMap.get(task.listId)?.color ?? undefined}
            onOpen={onOpenTask}
            onToggle={onToggleTask}
            onDelete={onDeleteTask}
            onMore={onMoreTask}
          />
        ))}

        {/* 当日已完成任务 */}
        {dayDoneTasks.length > 0 && (
          <div className="m-cal-done-group">
            <div className="m-cal-done-header">
              <span>已完成 ({dayDoneTasks.length})</span>
            </div>
            {dayDoneTasks.map((task) => (
              <MobileTaskRow
                key={task.id}
                task={task}
                listColor={listsMap.get(task.listId)?.color ?? undefined}
                onOpen={onOpenTask}
                onToggle={onToggleTask}
                onDelete={onDeleteTask}
                onMore={onMoreTask}
              />
            ))}
          </div>
        )}

        {/* 当天无任何安排时的空状态 */}
        {dayPendingTasks.length === 0 &&
          dayDoneTasks.length === 0 &&
          dayEvents.length === 0 && (
            <EmptyView
              icon={<CalendarX2 size={40} />}
              title="这一天没有安排"
              body="点击右上角「添加任务」或底部 ＋ 安排待办"
            />
          )}
      </div>
    </div>
  );
}
