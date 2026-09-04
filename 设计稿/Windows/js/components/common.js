/**
 * common.js — 跨视图复用的纯展示组件
 */
import { h } from "../core/dom.js";
import { icon } from "../core/icons.js";

/** 分组卡片：标题 + 计数 + 可选进度 + 任务行容器 */
export function groupCard({ title, count, tone = "accent", progress, actions, children }) {
  const toneClass = tone === "danger" ? "tone-danger" : tone === "muted" ? "tone-muted" : "";
  const done = progress?.done ?? 0;
  const total = progress?.total ?? 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return h("div.group-card " + toneClass, {}, [
    h("div.group-head", {}, [
      h("span.group-dot"),
      h("h2", { text: title }),
      h("span.group-count", { text: String(count) }),
      total ? h("div.group-progress", {}, [
        h("span.bar", {}, [h("i", { style: { width: `${pct}%` } })]),
        h("span", { text: `${done}/${total} · ${pct}%` }),
      ]) : null,
      actions ? h("div", { style: { marginLeft: "auto", display: "flex", gap: 4 } }, actions) : null,
    ]),
    h("div.group-body", {}, Array.isArray(children) ? children : [children]),
  ]);
}

export function emptyState({ icon: iconName = "inbox", title, desc, action }) {
  return h("div.empty-state", {}, [
    h("div.empty-icon", { html: icon(iconName, "i-lg") }),
    h("h3", { text: title }),
    desc ? h("p", { text: desc }) : null,
    action ?? null,
  ]);
}

/** SVG 进度环 */
export function progressRing(percent, size = 44, stroke = 4) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.min(1, Math.max(0, percent)));
  const wrap = h("div.progress-ring", { style: { width: `${size}px`, height: `${size}px` } }, [
    h("svg", { width: size, height: size, viewBox: `0 0 ${size} ${size}` }, [
      h("circle.ring-bg", { cx: size / 2, cy: size / 2, r, fill: "none", "stroke-width": stroke }),
      h("circle.ring-fg", {
        cx: size / 2, cy: size / 2, r, fill: "none", "stroke-width": stroke,
        "stroke-dasharray": c, "stroke-dashoffset": offset,
      }),
    ]),
    h("span.ring-text", { style: { fontSize: `${Math.max(9, size * 0.24)}px` }, text: `${Math.round(percent * 100)}%` }),
  ]);
  return wrap;
}

/** 列表顶部快速新建输入条 */
export function quickComposer(placeholder, onSubmit) {
  const input = h("input", { type: "text", placeholder });
  const bar = h("div.quick-composer", {
    onclick: () => input.focus(),
  }, [
    h("span", { html: icon("plus", "i-sm") }),
    input,
    h("span.qc-hint", { text: "Enter 创建" }),
  ]);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && input.value.trim()) {
      onSubmit?.(input.value.trim());
      input.value = "";
    }
  });
  return bar;
}

/** 简单的区块标题 */
export function sectionTitle(text, extra) {
  return h("div.search-section-title", { style: { display: "flex", alignItems: "center" } }, [
    h("span", { text }),
    extra ? h("span", { style: { marginLeft: "auto" } }, [extra]) : null,
  ]);
}
