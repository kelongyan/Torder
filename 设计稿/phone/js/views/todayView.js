/**
 * todayView.js — 「今天」主屏幕（默认落地页）
 * 问候 + 今日节奏 + 逾期段 / 时间轴（now 线）/ 全天 / 今日已完成
 */
import { h } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { appbar } from "../components/chrome.js";
import { taskRow } from "../components/taskRow.js";
import { groupCard, paceCard, sectionHead, emptyState, screenShell } from "../components/common.js";
import { openTaskActionsFor } from "../components/sheets.js";
import * as store from "../core/store.js";
import { greeting, formatLongDate, formatTimeOfDay } from "../core/format.js";
import { VIEW_LABEL } from "../data/enums.js";

export function renderToday(_params, _query, ctx) {
  const { lists } = store.getState();
  const listsMap = new Map(lists.map((l) => [l.id, l]));
  const agenda = store.todayAgenda();
  const total = agenda.overdue.length + agenda.timed.length + agenda.allday.length;
  const done = agenda.completedToday.length;

  const bar = appbar({
    title: "Torder",
    sub: "今序 · 待办清单",
    lead: h("span", {
      style: {
        width: "40px", height: "40px", borderRadius: "13px", marginLeft: "4px",
        background: "var(--accent-soft)", color: "var(--accent)",
        display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "700",
      },
      text: "今",
    }),
    actions: [
      { icon: "search", label: "搜索", onClick: () => ctx.nav.push("/search") },
      { icon: "flame", label: "专注", onClick: () => ctx.nav.push("/focus") },
    ],
  });

  /* 快捷芯片：直达常用智能视图 */
  const quickChips = [
    { label: "计划中", view: "planned" },
    { label: `已逾期 ${agenda.overdue.length || ""}`, view: "overdue" },
    { label: "无日期", view: "no-date" },
    { label: "重要", view: "important" },
  ].map((c) =>
    h("button.chip", { onclick: () => ctx.nav.push(`/view/${c.view}`) }, [
      h("span", { text: c.label.trim() }),
      icon("chevron-right", "i-sm"),
    ]),
  );

  const body = [];
  body.push(h("div.hello", {}, [
    h("div.hello-date", { text: formatLongDate(new Date()) }),
    h("h1", { text: `${greeting()}，今天` }),
    h("div.hello-tip", {
      text: total ? `共 ${total} 项待推进，专注当下一件事` : "今天没有安排，享受留白",
    }),
  ]));
  body.push(h("div.chip-row", {}, quickChips));

  if (total === 0 && done === 0) {
    body.push(emptyState({
      icon: "calendar-check", title: "今天没有任务",
      body: "点击下方 ＋ 新建一项，或到「浏览」查看全部任务",
    }));
  } else {
    body.push(paceCard({ done, total: total + done, overdue: agenda.overdue.length }));
  }

  const rowCtx = {
    lists: listsMap,
    onOpen: (t) => ctx.nav.push(`/task/${t.id}`),
    onToggle: (t) => store.toggleTask(t.id),
    onDelete: (t) => store.softDeleteTask(t.id),
    onMore: (t) => openTaskActionsFor(t, ctx.nav),
  };

  /* 逾期段 */
  if (agenda.overdue.length) {
    body.push(groupCard("逾期", "var(--red)",
      agenda.overdue.map((t) => taskRow(t, rowCtx)),
      { count: agenda.overdue.length }));
    const card = body[body.length - 1];
    card.classList.add("danger");
  }

  /* 今日时间轴（含 now 指示线） */
  if (agenda.timed.length || agenda.allday.length) {
    const rows = [];
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    let inserted = false;
    agenda.timed.forEach((t) => {
      const d = new Date(t.dueAt);
      const min = d.getHours() * 60 + d.getMinutes();
      if (!inserted && min > nowMin) {
        rows.push(nowLine());
        inserted = true;
      }
      rows.push(taskRow(t, { ...rowCtx, timeGutter: formatTimeOfDay(d) }));
    });
    if (!inserted && agenda.timed.length) rows.push(nowLine());
    agenda.allday.forEach((t) => rows.push(taskRow(t, rowCtx)));
    body.push(groupCard("今天", "var(--accent)", rows, { count: agenda.timed.length + agenda.allday.length }));
  }

  /* 今日已完成 */
  if (agenda.completedToday.length) {
    body.push(sectionHead("今日已完成", agenda.completedToday.length));
    const card = h("div.group-card", {}, [
      h("div.group-card-body", {}, agenda.completedToday.map((t) => taskRow(t, rowCtx))),
    ]);
    card.style.setProperty("--group-accent", "var(--green)");
    body.push(card);
  }

  return screenShell({ bar, body });
}

function nowLine() {
  return h("div.now-line", {}, [
    h("span.now-time", { text: formatTimeOfDay(new Date()) }),
    h("span.now-track"),
  ]);
}
