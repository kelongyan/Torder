/**
 * weekView.js — 周视图（镜像 WeekCalendar）
 * 左列 8:00–20:00 时刻，7 天列；有时刻的任务按小时绝对定位为事件块。
 */
import { h } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { weekDays, shiftWeek, getState, calendarMap, eventsOn } from "../core/store.js";
import { dateKey, isoToKey } from "../core/format.js";
import { EVENT_TYPES } from "../data/enums.js";

const START_HOUR = 8;
const HOURS = 13; // 8:00–20:00

export function weekView(route, ctx) {
  const s = getState();
  const days = weekDays();
  const cmap = calendarMap();
  const todayKey = dateKey(new Date());

  const head = h("div.week-toolbar", {}, [
    h("h2.fs-lg.fw-600", {
      text: `${days[0].date.getMonth() + 1}月${days[0].date.getDate()}日 – ${days[6].date.getMonth() + 1}月${days[6].date.getDate()}日`,
      style: { minWidth: 200 },
    }),
    h("button.icon-btn", { html: icon("chevron-left", "i-sm"), onclick: () => shiftWeek(-1) }),
    h("button.btn.btn-sm.btn-ghost", {
      text: "本周",
      onclick: () => { s.ui.weekAnchorKey = todayKey; shiftWeek(0); },
    }),
    h("button.icon-btn", { html: icon("chevron-right", "i-sm"), onclick: () => shiftWeek(1) }),
  ]);

  const hourCol = h("div.week-time-col", {},
    Array.from({ length: HOURS }, (_, i) => h("div.week-hour-label", { text: `${START_HOUR + i}:00` })));

  const dayCols = days.map((d) => {
    const tasks = (cmap.get(d.key) ?? []).filter((t) => t.dueAt && isoToKey(t.dueAt) === d.key && t.status !== "done");
    const events = eventsOn(d.key);
    const blocks = tasks.map((t) => {
      const dt = new Date(t.dueAt);
      const start = dt.getHours() + dt.getMinutes() / 60 - START_HOUR;
      if (start < 0 || start > HOURS) return null;
      const top = (start / HOURS) * 100;
      return h("div.week-event" + (t.priority === 2 ? ".high" : ""), {
        style: { top: `${top}%`, height: `${(1 / HOURS) * 100 * 1.15}%`, cursor: "pointer" },
        onclick: () => ctx?.openDetail(t),
      }, [h("div.ellipsis", { text: t.title })]);
    });
    const eventBands = events.map((e) =>
      h("div.week-event", {
        style: { top: "2%", background: "var(--green-soft)", borderLeftColor: "var(--green)", position: "absolute" },
        text: EVENT_TYPES[e.eventType]?.label + " · " + e.title,
      }));
    return h("div.week-day-col", {}, [
      ...Array.from({ length: HOURS }, () => h("div.week-hour-cell")),
      ...blocks.filter(Boolean),
    ]);
  });

  const grid = h("div.week-grid.scroll", { style: { overflow: "auto" } }, [
    h("div.week-corner"),
    ...days.map((d) => h("div.week-day-head" + (d.key === todayKey ? ".today" : ""), {}, [
      h("div.wd-weekday", { text: "周" + d.weekday }),
      h("div.wd-date", { text: String(d.date.getDate()) }),
    ])),
    hourCol,
    ...dayCols,
  ]);

  return h("div.week-wrap", {}, [head, grid]);
}
