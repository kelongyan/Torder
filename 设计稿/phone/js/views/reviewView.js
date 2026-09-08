/**
 * reviewView.js — 每日回顾（纯前端聚合，移动端保留）
 */
import { h } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { appbar } from "../components/chrome.js";
import { taskRow } from "../components/taskRow.js";
import { screenShell, sectionHead } from "../components/common.js";
import { openTaskActionsFor } from "../components/sheets.js";
import * as store from "../core/store.js";
import { dateKey, isoToKey, relativeKey } from "../core/format.js";

export function renderReview(_p, _q, ctx) {
  const s = store.getState();
  const listsMap = new Map(s.lists.map((l) => [l.id, l]));
  const today = dateKey(new Date());
  const tomorrow = relativeKey(1);

  const doneToday = s.tasks.filter((t) => t.completedAt && isoToKey(t.completedAt) === today);
  const overdue = s.tasks.filter((t) => t.deletedAt == null && t.status !== "done" && t.dueAt && isoToKey(t.dueAt) < today);
  const createdToday = s.tasks.filter((t) => isoToKey(t.createdAt) === today);
  const tomorrowTasks = s.tasks.filter((t) => t.deletedAt == null && (t.scheduledDate === tomorrow || isoToKey(t.dueAt) === tomorrow));

  const bar = appbar({ back: true, onBack: () => ctx.nav.back(), title: "每日回顾" });

  const hero = h("div.review-hero", {}, [
    h("div.t-muted.fs-sm", { text: "今天完成" }),
    h("strong", { text: String(doneToday.length) }),
    h("div.t-muted.fs-xs", { text: "项任务，每一步都算数" }),
  ]);

  const stats = h("div.review-stat-grid", {}, [
    statTile("overdue", overdue.length, "逾期待处理", "var(--red)"),
    statTile("calendar-days", tomorrowTasks.length, "明日待办", "var(--blue)"),
    statTile("plus", createdToday.length, "今日新增", "var(--accent)"),
    statTile("repeat-2", s.recurringRules.filter((r) => r.enabled).length, "生效循环", "var(--green)"),
  ]);

  const rowCtx = {
    lists: listsMap,
    onOpen: (t) => ctx.nav.push(`/task/${t.id}`),
    onToggle: (t) => store.toggleTask(t.id),
    onDelete: (t) => store.softDeleteTask(t.id),
    onMore: (t) => openTaskActionsFor(t, ctx.nav),
  };

  const body = [
    hero, stats,
    sectionHead("今日完成", doneToday.length),
    doneToday.length
      ? h("div.group-card", { style: { "--group-accent": "var(--green)" } }, [
        h("div.group-card-body", {}, doneToday.map((t) => taskRow(t, rowCtx))),
      ])
      : h("p.t-muted.fs-sm", { style: { padding: "0 4px 16px" }, text: "还没有完成的任务，从最小的一步开始。" }),
    sectionHead("明日预览", tomorrowTasks.length),
    tomorrowTasks.length
      ? h("div.group-card", { style: { "--group-accent": "var(--blue)" } }, [
        h("div.group-card-body", {}, tomorrowTasks.map((t) => taskRow(t, rowCtx))),
      ])
      : h("p.t-muted.fs-sm", { style: { padding: "0 4px 16px" }, text: "明天暂无安排。" }),
    h("button.btn.btn-primary.btn-block", {
      style: { marginTop: "12px" },
      onclick: () => { toast("已记录今日回顾"); ctx.nav.back(); },
      text: "完成回顾",
    }),
  ];

  return screenShell({ bar, body, noTab: true });
}

function statTile(iconName, value, label, color) {
  return h("div.stat-tile", {}, [
    h("span", { style: { color }, html: icon(iconName, "i-sm") }),
    h("strong", { text: String(value) }),
    h("span", { text: label }),
  ]);
}
