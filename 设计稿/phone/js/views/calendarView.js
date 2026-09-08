/**
 * calendarView.js — 月历主 Tab
 * 上半：月网格（任务圆点 + 日历事件色带）；下半：选中日的事件与任务。
 * 桌面端的 week/看板/拖拽排期在移动端不做（单手浏览 + 点选为主）。
 */
import { h } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { appbar } from "../components/chrome.js";
import { taskRow } from "../components/taskRow.js";
import { screenShell, sectionHead, emptyState } from "../components/common.js";
import { openTaskActionsFor } from "../components/sheets.js";
import * as store from "../core/store.js";
import { dateKey, parseKey, WEEKDAY_LABELS } from "../core/format.js";
import { EVENT_TYPES } from "../data/enums.js";

export function renderCalendar(_p, _q, ctx) {
  const s = store.getState();
  const listsMap = new Map(s.lists.map((l) => [l.id, l]));
  const map = store.calendarMap();
  const year = s.ui.calendarYear;
  const month = s.ui.calendarMonth;
  const selected = s.ui.selectedDateKey ?? dateKey(new Date());
  const todayKey = dateKey(new Date());

  const bar = appbar({
    title: `${year} 年 ${month + 1} 月`,
    actions: [
      { icon: "chevron-left", label: "上个月", onClick: () => shiftMonth(-1) },
      { icon: "chevron-right", label: "下个月", onClick: () => shiftMonth(1) },
    ],
  });
  // 「今天」快捷按钮
  const goToday = h("button.chip", {
    onclick: () => {
      const d = new Date();
      store.setCalendarCursor(d.getMonth(), d.getFullYear());
      store.selectDate(dateKey(d));
    },
  }, [icon("calendar-check", "i-sm"), h("span", { text: "回到今天" })]);

  const cells = buildGrid(year, month);
  const gridEl = h("div.cal-card", {}, [
    h("div.cal-weekrow", {}, WEEKDAY_LABELS.map((w) => h("span", { text: w }))),
    h("div.cal-grid", {}, cells.map((cell) => {
      const tasks = map.get(cell.key) ?? [];
      const events = store.eventsOn(cell.key);
      const el = h("button.cal-cell", {
        onclick: () => store.selectDate(cell.key),
      }, [
        h("span.cal-num" + (cell.key === todayKey ? ".today" : ""), { text: String(cell.day) }),
        h("span.cal-dots", {}, tasks.slice(0, 3).map((t) =>
          h("i", { style: { background: dotColor(t, listsMap) } }))),
      ]);
      if (cell.outside) el.classList.add("outside");
      if (cell.key === selected) el.classList.add("selected");
      if (events.length) el.classList.add("has-event-band");
      return el;
    })),
  ]);

  /* 选中日内容 */
  const dayTasks = (map.get(selected) ?? []).filter((t) => t.status !== "done");
  const dayDone = (map.get(selected) ?? []).filter((t) => t.status === "done");
  const dayEvents = store.eventsOn(selected);
  const selDate = parseKey(selected);

  const detail = [];
  detail.push(sectionHead(
    selDate ? `${selDate.getMonth() + 1}月${selDate.getDate()}日` : "未安排",
    dayTasks.length + dayDone.length,
  ));
  for (const evt of dayEvents) {
    const cfg = EVENT_TYPES[evt.eventType];
    detail.push(h("div.event-band", {
      style: { "--band-color": `var(--${evt.eventType === "trip" ? "blue" : evt.eventType === "leave" ? "green" : "amber"})` },
    }, [
      icon(cfg.icon, "i-sm"),
      h("div.grow", {}, [
        h("strong.fs-sm", { text: evt.title, style: { display: "block" } }),
        evt.note ? h("span.fs-xs.t-muted", { text: evt.note }) : null,
      ]),
      h("span.fs-xs.t-muted", { text: cfg.label }),
    ]));
  }
  const rowCtx = {
    lists: listsMap,
    onOpen: (t) => ctx.nav.push(`/task/${t.id}`),
    onToggle: (t) => store.toggleTask(t.id),
    onDelete: (t) => store.softDeleteTask(t.id),
    onMore: (t) => openTaskActionsFor(t, ctx.nav),
  };
  if (!dayTasks.length && !dayDone.length && !dayEvents.length) {
    detail.push(emptyState({ icon: "calendar-x-2", title: "这一天没有安排", body: "点击下方 ＋ 添加任务" }));
  } else {
    if (dayTasks.length) detail.push(...dayTasks.map((t) => taskRow(t, rowCtx)));
    if (dayDone.length) {
      detail.push(sectionHead("已完成", dayDone.length));
      detail.push(...dayDone.map((t) => taskRow(t, rowCtx)));
    }
  }

  return screenShell({
    bar,
    body: [h("div.chip-row", {}, [goToday]), gridEl, ...detail],
  });
}

function shiftMonth(delta) {
  const s = store.getState();
  const d = new Date(s.ui.calendarYear, s.ui.calendarMonth + delta, 1);
  store.setCalendarCursor(d.getMonth(), d.getFullYear());
}

/** 生成 6×7 月网格（周一开头） */
function buildGrid(year, month) {
  const first = new Date(year, month, 1);
  const startWeekday = (first.getDay() + 6) % 7; // 周一=0
  const start = new Date(year, month, 1 - startWeekday);
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push({
      key: dateKey(d),
      day: d.getDate(),
      outside: d.getMonth() !== month,
    });
  }
  return cells;
}

function dotColor(task, listsMap) {
  if (task.priority === 2) return "var(--red)";
  const l = listsMap.get(task.listId);
  return l?.color ?? "var(--accent)";
}
