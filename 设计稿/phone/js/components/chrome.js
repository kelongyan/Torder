/**
 * chrome.js — 应用外壳组件：模拟状态栏 / 顶部应用栏 / 底部 Tab 栏
 * 这些结构在所有屏幕间持久存在（不随页面栈重建）。
 */
import { h, mount } from "../core/dom.js";
import { icon } from "../core/icons.js";

/* ---------------- 模拟安卓状态栏 ---------------- */
export function renderStatusBar(host) {
  const bar = h("div.statusbar", {}, [
    h("span.sb-time", { text: nowLabel() }),
    h("span.sb-icons", { html: `${icon("signal")}${icon("wifi")}${batteryIcon()}` }),
  ]);
  host.append(bar);
  setInterval(() => {
    bar.querySelector(".sb-time").textContent = nowLabel();
  }, 15_000);
}
function nowLabel() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function batteryIcon() {
  // 电池图标微调高度，与 signal/wifi 视觉对齐
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round">
    <rect x="2" y="7" width="18" height="10" rx="2"/><line x1="22" x2="22" y1="10" y2="14"/>
    <rect x="4" y="9" width="11" height="6" rx="1" fill="currentColor" stroke="none"/></svg>`;
}

/* ---------------- 顶部应用栏 ---------------- */
/**
 * @param {object} o
 * @param {boolean} [o.back]     显示返回箭头（次级页）
 * @param {Function} [o.onBack]
 * @param {string} o.title
 * @param {string} [o.sub]
 * @param {Array}  [o.actions]  [{icon, label?, onClick, accent?}]
 * @param {boolean}[o.glass]    磨砂底（滚动时）
 */
export function appbar(o) {
  return h("header.appbar" + (o.glass ? ".glass" : ""), {}, [
    o.back
      ? h("button.icon-btn", { "aria-label": "返回", onclick: o.onBack }, [iconWrap("arrow-left")])
      : (o.lead ?? null),
    h("div.appbar-title", {}, [
      h("h1.ellipsis", { text: o.title }),
      o.sub ? h("div.appbar-sub.ellipsis", { text: o.sub }) : null,
    ]),
    ...(o.actions ?? []).map((a) =>
      h("button.icon-btn" + (a.accent ? ".accent" : ""), {
        "aria-label": a.label ?? a.icon, onclick: a.onClick,
      }, [iconWrap(a.icon)]),
    ),
  ]);
}
function iconWrap(name) {
  const span = h("span");
  span.innerHTML = icon(name);
  return span.firstElementChild;
}

/* ---------------- 底部 Tab 栏 ---------------- */
const TABS = [
  { key: "today", label: "今天", icon: "calendar", path: "/today" },
  { key: "browse", label: "浏览", icon: "layers", path: "/browse" },
  { key: "fab", label: "新建" },
  { key: "calendar", label: "日历", icon: "calendar-range", path: "/calendar" },
  { key: "me", label: "我的", icon: "settings", path: "/me" },
];

export function renderTabBar(host, { active, onTab, onCreate }) {
  const bar = h("nav.tabbar", { "aria-label": "主导航" });
  for (const tab of TABS) {
    if (tab.key === "fab") {
      bar.append(h("div.tab-fab-slot", {}, [
        h("button.fab.pressable", { "aria-label": "新建任务", onclick: onCreate }, [iconWrap("plus")]),
      ]));
      continue;
    }
    const btn = h("button.tab" + (active === tab.key ? ".active" : ""), {
      "aria-label": tab.label,
      onclick: () => onTab(tab.path, tab.key),
    }, [
      h("span.tab-pill", { html: icon(tab.icon) }),
      h("span", { text: tab.label }),
    ]);
    bar.append(btn);
  }
  host.append(bar);
  return bar;
}

export function setActiveTab(barEl, key) {
  [...barEl.children].forEach((child, i) => {
    const tab = TABS[i];
    if (!tab || tab.key === "fab") return;
    child.classList.toggle("active", tab.key === key);
  });
}

/** 路由 → 所属主 Tab（用于 Tab 高亮） */
export function tabOfRoute(route) {
  return route?.tab ?? null;
}
