/**
 * browseView.js — 「浏览」主 Tab：智能视图 / 我的清单 / 标签 / 工具
 * 桌面端 Sidebar 的移动原生形态（抽屉改为独立页，层级更清晰）。
 */
import { h } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { appbar } from "../components/chrome.js";
import { screenShell, emptyState } from "../components/common.js";
import { openListEditSheet } from "../components/sheets.js";
import * as store from "../core/store.js";
import { SYSTEM_VIEWS, DEFAULT_LIST_COLOR } from "../data/enums.js";

const VIEW_TINT = {
  all: "var(--accent)", today: "var(--accent)", planned: "var(--blue)",
  overdue: "var(--red)", "no-date": "var(--text-3)", important: "var(--amber)",
  completed: "var(--green)", deleted: "var(--text-3)",
};

export function renderBrowse(_p, _q, ctx) {
  const s = store.getState();
  const counts = store.buildCounts();
  const tags = store.allTags();
  const activeRules = s.recurringRules.filter((r) => r.enabled).length;

  const bar = appbar({
    title: "浏览",
    actions: [{ icon: "search", label: "搜索", onClick: () => ctx.nav.push("/search") }],
  });

  /* 概览 hero */
  const openTotal = counts.views.all;
  const overdueTotal = counts.views.overdue;
  const hero = h("div.browse-hero", {}, [
    h("div.hero-mark", { text: "序" }),
    h("div.grow", {}, [
      h("h2", { text: `${openTotal} 项进行中` }),
      h("p", { text: overdueTotal ? `${overdueTotal} 项已逾期，优先处理` : "节奏良好，继续保持" }),
    ]),
    h("button.icon-btn", { "aria-label": "每日回顾", onclick: () => ctx.nav.push("/review"), html: icon("trending-up") }),
  ]);

  /* 智能视图 */
  const smartGroup = h("div.group", {}, [
    h("div.group-title", { text: "智能视图" }),
    ...SYSTEM_VIEWS.map((v) => navRow({
      icon: v.icon,
      tint: VIEW_TINT[v.id],
      label: v.label,
      count: v.id === "deleted" ? undefined : counts.views[v.id],
      danger: v.danger && counts.views[v.id] > 0,
      onClick: () => ctx.nav.push(`/view/${v.id}`),
    })),
  ]);

  /* 我的清单 */
  const listGroup = h("div.group", {}, [
    h("div.group-title.row-between", { style: { display: "flex", "justify-content": "space-between", "align-items": "center" } }, [
      h("span", { text: "我的清单" }),
      h("button.mini-icon", { "aria-label": "新建清单", html: icon("plus", "i-sm"), onclick: () => openListEditSheet(null) }),
    ]),
    ...s.lists.map((l) =>
      h("div.list-edit-row", {}, [
        h("button.nav-row.grow", {
          onclick: () => ctx.nav.push(`/list/${l.id}`),
          oncontextmenu: (e) => { e.preventDefault(); if (!l.isDefault) openListEditSheet(l); },
        }, [
          h("span.nav-icon", {
            style: { background: `color-mix(in srgb, ${l.color ?? DEFAULT_LIST_COLOR} 16%, transparent)`, color: l.color ?? DEFAULT_LIST_COLOR },
            html: icon("folder", "i-sm"),
          }),
          h("span.nav-label", { text: l.name }),
          h("span.badge", { text: String(counts.lists[l.id] ?? 0) }),
          iconNode("chevron-right"),
        ]),
        !l.isDefault
          ? h("button.mini-icon", { "aria-label": "编辑清单", html: icon("pencil", "i-sm"), onclick: () => openListEditSheet(l) })
          : null,
      ]),
    ),
  ]);

  /* 标签 */
  const tagGroup = tags.length ? h("div.group", {}, [
    h("div.group-title", { text: "标签" }),
    ...tags.map(({ tag, count }) => navRow({
      icon: "hash", tint: "var(--teal)", label: tag, count,
      onClick: () => ctx.nav.push(`/tag/${encodeURIComponent(tag)}`),
    })),
  ]) : null;

  /* 工具 */
  const toolGroup = h("div.group", {}, [
    h("div.group-title", { text: "工具" }),
    navRow({ icon: "repeat-2", tint: "var(--accent)", label: "循环任务", count: activeRules, onClick: () => ctx.nav.push("/recurring") }),
    navRow({ icon: "flame", tint: "var(--amber)", label: "专注模式", onClick: () => ctx.nav.push("/focus") }),
    navRow({ icon: "trending-up", tint: "var(--green)", label: "每日回顾", onClick: () => ctx.nav.push("/review") }),
  ]);

  return screenShell({ bar, body: [hero, smartGroup, listGroup, tagGroup, toolGroup] });
}

function navRow({ icon: ic, tint, label, count, danger, onClick }) {
  return h("button.nav-row", { onclick: onClick }, [
    h("span.nav-icon", { style: { background: `color-mix(in srgb, ${tint} 15%, transparent)`, color: tint }, html: icon(ic, "i-sm") }),
    h("span.nav-label" + (danger ? ".t-danger" : ""), { text: label }),
    count != null ? h("span.badge" + (danger ? ".danger" : ""), { text: String(count) }) : null,
    iconNode("chevron-right"),
  ]);
}
function iconNode(name) {
  const wrap = h("span.i.chevron", { style: { display: "flex" } });
  wrap.innerHTML = icon(name, "i-sm");
  return wrap;
}
