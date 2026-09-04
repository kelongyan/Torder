/**
 * monthView.js — 月历布局（镜像 MonthCalendar）
 * 周一起头 6×7 网格：事件色带 + 任务圆点；下方列出选中日任务。
 */
import { h } from "../core/dom.js";
import { icon } from "../core/icons.js";
import {
  monthCells, calendarMap, eventsOn, getState, shiftMonth, selectDate,
} from "../core/store.js";
import { dateKey, WEEKDAY_LABELS, isoToKey } from "../core/format.js";
import { EVENT_TYPES } from "../data/enums.js";
import { taskRow } from "../components/taskRow.js";
import { emptyState } from "../components/common.js";

export function monthView(route, ctx) {
  const s = getState();
  const cmap = calendarMap();
  const todayKey = dateKey(new Date());
  const cells = monthCells(s.ui.calendarYear, s.ui.calendarMonth);
  const selected = s.ui.selectedDateKey ?? todayKey;

  const head = h("div.month-toolbar", {}, [
    h("h2", { text: `${s.ui.calendarYear} 年 ${s.ui.calendarMonth + 1} 月` }),
    h("button.icon-btn", { html: icon("chevron-left", "i-sm"), onclick: () => shiftMonth(-1) }),
    h("button.btn.btn-sm.btn-ghost", { text: "今天", onclick: () => {
      const n = new Date();
      s.ui.calendarMonth = n.getMonth(); s.ui.calendarYear = n.getFullYear();
      selectDate(dateKey(n));
    } }),
    h("button.icon-btn", { html: icon("chevron-right", "i-sm"), onclick: () => shiftMonth(1) }),
    h("span.flex1"),
    h("span.fs-xs.t-muted", { text: "色带=日历事件（休假/出差），圆点=任务" }),
  ]);

  const weekdayRow = h("div.month-grid", { style: { gridAutoRows: "28px", flex: "none", marginBottom: 4 } },
    WEEKDAY_LABELS.map((w) => h("div.month-weekday", { text: "周" + w })));

  const grid = h("div.month-grid", { style: { flex: "1 1 auto" } }, cells.map((cell) => {
    const tasks = cmap.get(cell.key) ?? [];
    const live = tasks.filter((t) => t.status !== "done");
    const events = eventsOn(cell.key);
    const isToday = cell.key === todayKey;
    const isSel = cell.key === selected;
    const cellEl = h("div.month-cell" +
      (cell.inMonth ? "" : ".outside") +
      (isToday ? ".today" : "") +
      (isSel ? ".selected" : ""), {
      onclick: () => selectDate(cell.key),
    }, [
      h("span.cell-num", { text: String(cell.date.getDate()) }),
      ...events.slice(0, 2).map((e) =>
        h("span.cell-event-band " + (e.eventType === "leave" ? "leave" : e.eventType === "other" ? "other" : ""), {
          text: `${EVENT_TYPES[e.eventType]?.label ?? ""} · ${e.title}`,
        })),
      h("div.cell-dots", {}, live.slice(0, 4).map((t) =>
        h("i", { style: { background: t.priority === 2 ? "var(--red)" : t.priority === 1 ? "var(--amber)" : "var(--accent)" } }))),
    ]);
    return cellEl;
  }));

  const dayTasks = cmap.get(selected) ?? [];
  const selDate = new Date(s.ui.calendarYear, s.ui.calendarMonth, 1);
  const dayPanel = h("div", { style: { flex: "none", height: "196px", marginTop: "12px", display: "flex", flexDirection: "column" } }, [
    h("div.fs-sm.fw-600", { style: { marginBottom: 6 }, text: `${selected} · ${dayTasks.length} 项` }),
    h("div.group-card.scroll", { style: { flex: 1 } }, dayTasks.length
      ? dayTasks.map((t) => taskRow(t, { ctx, onOpen: (x) => ctx?.openDetail(x) }))
      : [emptyState({ title: "当天没有任务", desc: "" })]),
  ]);

  return h("div.month-wrap", {}, [head, weekdayRow, grid, dayPanel]);
}
