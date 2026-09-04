/**
 * common.js — 跨视图复用的小构造块：章节头 / 分组卡片 / 空态 / 搜索高亮
 */
import { h, esc } from "../core/dom.js";
import { icon } from "../core/icons.js";

export function sectionHead(title, count, { danger = false, action } = {}) {
  return h("div.section-head" + (danger ? ".danger" : ""), {}, [
    h("h2", { text: count != null ? `${title} · ${count}` : title }),
    action ?? null,
  ]);
}

/**
 * 分组卡片（对齐桌面 task-group-card：顶部 2px 色条）
 * @param {string} title
 * @param {string} color  CSS 颜色（--group-accent）
 * @param {HTMLElement[]} rows
 */
export function groupCard(title, color, rows, { count } = {}) {
  return h("div.group-card", { style: color ? { "--group-accent": color } : {} }, [
    h("div.group-card-head", {}, [
      h("h3", {}, [
        h("span.head-dot"),
        h("span", { text: count != null ? `${title} · ${count}` : title }),
      ]),
    ]),
    h("div.group-card-body", {}, rows),
  ]);
}

export function emptyState({ icon: iconName = "inbox", title, body, action } = {}) {
  return h("div.empty", {}, [
    h("div.empty-icon", { html: icon(iconName, "i-xl") }),
    h("h3", { text: title }),
    body ? h("p", { text: body }) : null,
    action ?? null,
  ]);
}

/** 搜索关键字高亮（先转义再包 mark，防注入） */
export function highlight(text, query) {
  const safe = esc(text);
  if (!query) return safe;
  const q = esc(query.trim());
  if (!q) return safe;
  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig");
  return safe.replace(re, "<mark>$1</mark>");
}

/** 屏幕骨架：appbar + 可滚动 body（根节点由 router 加 .screen，自身为 flex 列） */
export function screenShell({ bar, body, noTab = false, cls = "" }) {
  const bodyEl = h("div.screen-body" + (noTab ? ".no-tab" : "") + (cls ? `.${cls}` : ""));
  const list = Array.isArray(body) ? body.filter(Boolean) : body ? [body] : [];
  bodyEl.append(...list);
  return h("div.screen-inner.col", {}, [bar, bodyEl]);
}

/** 今日节奏卡 */
export function paceCard({ done, total, overdue }) {
  const remain = Math.max(0, total - done);
  const pct = total ? Math.round((done / total) * 100) : 0;
  return h("div.pace-card", {}, [
    h("div.pace-top", {}, [
      h("strong", { text: String(done) }),
      h("span", { text: `/ ${total} 项已完成` }),
    ]),
    h("div.progress", {}, [h("i", { style: { width: `${pct}%` } })]),
    h("div.pace-foot", {}, [
      h("span", { text: remain > 0 ? `还有 ${remain} 项待推进` : "今天已清空，辛苦了" }),
      overdue > 0 ? h("span.overdue", { text: `逾期 ${overdue}` }) : h("span", { text: `${pct}%` }),
    ]),
  ]);
}
