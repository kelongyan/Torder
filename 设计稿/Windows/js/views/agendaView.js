/**
 * agendaView.js — “日历”布局（镜像 TaskCalendar）：按日期分组的滚动日程
 * 与月历/周视图互补，是密度最高的时间列表。
 */
import { h } from "../core/dom.js";
import { queryTasks, getState } from "../core/store.js";
import { parseKey, dateKey } from "../core/format.js";
import { taskRow } from "../components/taskRow.js";
import { emptyState } from "../components/common.js";

export function agendaView(route, ctx) {
  const rows = queryTasks().filter((t) => t.scheduledDate ?? (t.dueAt?.slice(0, 10)));
  if (!rows.length) return emptyState({ icon: "calendar-days", title: "没有排期任务", desc: "为任务设置计划日期或截止时间后，会按日期在这里分组。" });

  const groups = new Map();
  for (const t of rows) {
    const key = t.scheduledDate ?? t.dueAt.slice(0, 10);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const sortedKeys = [...groups.keys()].sort();
  const todayKey = dateKey(new Date());

  return h("div", { style: { maxWidth: 860 } }, sortedKeys.map((key) => {
    const d = parseKey(key);
    const diff = Math.round((d - new Date(todayKey + "T00:00")) / 86400000);
    const rel = diff === 0 ? "今天" : diff === 1 ? "明天" : diff === -1 ? "昨天" : diff < 0 ? `${-diff} 天前` : `${diff} 天后`;
    return h("div.agenda-group", {}, [
      h("div.agenda-date-head" + (diff === 0 ? ".today" : ""), {}, [
        h("h3", { text: `${d.getMonth() + 1}月${d.getDate()}日` }),
        h("span", { text: `周${"一二三四五六日"[(d.getDay() + 6) % 7]} · ${rel} · ${groups.get(key).length} 项` }),
      ]),
      h("div.group-card", {}, groups.get(key).map((t) =>
        taskRow(t, { ctx, onOpen: (x) => ctx?.openDetail(x) }))),
    ]);
  }));
}
