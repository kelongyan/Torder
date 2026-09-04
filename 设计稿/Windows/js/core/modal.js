/**
 * modal.js — 桌面端浮层体系（替代移动端 Bottom Sheet）：
 *  - openDialog：居中模态对话框（设置/新建/专注/回顾/统计）
 *  - openPopover：锚点浮层菜单（排序/筛选/更多/右键菜单）
 *  - openConfirm：Promise<boolean> 确认框
 *  - openCommand：顶部居中命令面板
 * 统一创建、动画与回收；Esc 关闭、点外部关闭。
 */
import { h } from "./dom.js";
import { icon } from "./icons.js";

const DLG_MS = 180;
const POP_MS = 130;
let topZ = 900;

/* ============================ 居中对话框 ============================ */
/**
 * @returns {{close:()=>void, body:HTMLElement, footer:HTMLElement, el:HTMLElement}}
 */
export function openDialog({ title, icon: iconName, body, footer, width = 560, host = document.body }) {
  const scrim = h("div.dlg-scrim");
  const dlg = h("div.dialog", { style: { width: `${width}px` }, role: "dialog", "aria-modal": "true" }, [
    h("div.dialog-bar", {}, [
      h("div.dialog-title", {}, [
        iconName ? h("span.dialog-title-icon", { html: icon(iconName, "i-sm") }) : null,
        h("span", { text: title }),
      ]),
      h("button.icon-btn.dlg-close", { html: icon("x", "i-sm"), "aria-label": "关闭", onclick: () => ctrl.close() }),
    ]),
    h("div.dialog-body"),
    h("div.dialog-footer"),
  ]);
  const bodyEl = dlg.querySelector(".dialog-body");
  const footerEl = dlg.querySelector(".dialog-footer");
  if (body) bodyEl.append(body);
  if (footer) footerEl.append(footer);
  else footerEl.style.display = "none";
  scrim.append(dlg);
  host.append(scrim);
  dlg.style.zIndex = String(++topZ);
  requestAnimationFrame(() => scrim.classList.add("open"));

  let closed = false;
  const ctrl = {
    el: dlg,
    body: bodyEl,
    footer: footerEl,
    close() {
      if (closed) return;
      closed = true;
      scrim.classList.remove("open");
      setTimeout(() => scrim.remove(), DLG_MS);
    },
  };
  scrim.addEventListener("mousedown", (e) => { if (e.target === scrim) ctrl.close(); });
  escOnce(ctrl.close);
  return ctrl;
}

/* ============================ 锚点浮层 ============================ */
/**
 * @param {HTMLElement} anchor 触发按钮（决定定位）
 * @param {Array|HTMLElement} content 菜单项数组或自定义节点
 * @param {{align?:'left'|'right', width?:number}} opts
 */
export function openPopover(anchor, content, opts = {}) {
  const { align = "right", width = 224 } = opts;
  const pop = h("div.popover", { style: { width: typeof width === "number" ? `${width}px` : width } });
  if (content instanceof Node) {
    pop.append(content);
  } else {
    pop.append(...content.map(renderMenuRow));
    // 点击普通菜单项后自动收起（keepOpen 行除外）
    pop.addEventListener("click", (e) => {
      const row = e.target.closest(".menu-row");
      if (row && !row.dataset.keep) close();
    });
  }
  document.body.append(pop);

  const rect = anchor.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();
  let left = align === "right" ? rect.right - pr.width : rect.left;
  let top = rect.bottom + 6;
  left = Math.max(8, Math.min(left, window.innerWidth - pr.width - 8));
  if (top + pr.height > window.innerHeight - 8) top = rect.top - pr.height - 6;
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
  requestAnimationFrame(() => pop.classList.add("open"));

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    pop.classList.remove("open");
    setTimeout(() => pop.remove(), POP_MS);
    document.removeEventListener("mousedown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
  }
  function onDown(e) {
    if (!pop.contains(e.target) && !anchor.contains(e.target)) close();
  }
  function onKey(e) { if (e.key === "Escape") close(); }
  setTimeout(() => {
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
  }, 0);
  return { close, el: pop };
}

/* ============================ 坐标右键菜单 ============================ */
export function openContextMenu(x, y, items) {
  const anchor = document.createElement("span");
  anchor.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:1px;height:1px;`;
  document.body.append(anchor);
  const ctrl = openPopover(anchor, items, { align: "left", width: 208 });
  const origClose = ctrl.close;
  ctrl.close = function () { origClose.call(this); setTimeout(() => anchor.remove(), 200); };
  return ctrl;
}

function renderMenuRow(item) {
  if (item.divider) return h("div.menu-divider");
  if (item.header) return h("div.menu-header", { text: item.header });
  const row = h("button.menu-row" + (item.danger ? ".danger" : "") + (item.active ? ".active" : ""), {
    dataset: item.keepOpen ? { keep: "1" } : {},
    onclick: () => item.onClick?.(),
  }, [
    item.icon ? h("span.menu-row-icon", { html: icon(item.icon, "i-sm") }) : h("span.menu-row-icon"),
    h("span.menu-row-label", { text: item.label }),
    item.hint ? h("kbd.menu-kbd", { text: item.hint }) : null,
    item.checked ? h("span.menu-row-check", { html: icon("check", "i-sm") }) : null,
  ]);
  return row;
}

/* ============================ 确认框 ============================ */
export function openConfirm({ title, body, confirmText = "确定", cancelText = "取消", danger = false }) {
  return new Promise((resolve) => {
    const ctrl = openDialog({
      title, width: 400,
      body: h("p.confirm-body", { text: body }),
      footer: h("div.dialog-footer-row", {}, [
        h("button.btn.btn-ghost", { text: cancelText, onclick: () => done(false) }),
        h("button.btn" + (danger ? ".btn-danger" : ".btn-primary"), { text: confirmText, onclick: () => done(true) }),
      ]),
    });
    function done(val) { ctrl.close(); resolve(val); }
  });
}

/* ============================ 命令面板 ============================ */
export function openCommand({ onPick, onQuery, host = document.body }) {
  const input = h("input.command-input", { type: "text", placeholder: "搜索任务、跳转视图或执行命令…", autocomplete: "off" });
  const resultBox = h("div.command-results");
  const panel = h("div.command-panel", {}, [
    h("div.command-search", {}, [h("span.command-search-icon", { html: icon("search", "i-sm") }), input]),
    resultBox,
  ]);
  const scrim = h("div.command-scrim");
  scrim.append(panel);
  host.append(scrim);
  requestAnimationFrame(() => { scrim.classList.add("open"); input.focus(); });

  function render(list) {
    resultBox.replaceChildren(...list.map((item) =>
      item.header
        ? h("div.command-group-label", { text: item.label })
        : h("button.command-item", {
          onclick: () => { close(); onPick?.(item); },
        }, [
          h("span.command-item-icon", { html: icon(item.icon ?? "circle-dot", "i-sm") }),
          h("span.command-item-label", { text: item.label }),
          item.meta ? h("span.command-item-meta", { text: item.meta }) : null,
        ]),
    ));
  }
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    scrim.classList.remove("open");
    setTimeout(() => scrim.remove(), 150);
  }
  input.addEventListener("input", () => onQuery?.(input.value, render));
  input.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); if (e.key === "Enter") resultBox.querySelector("button")?.click(); });
  scrim.addEventListener("mousedown", (e) => { if (e.target === scrim) close(); });
  escOnce(close);
  onQuery?.("", render);
  return { close, setResults: render, input, el: scrim };
}

/* Esc 只绑定一次，关闭后解绑 */
function escOnce(fn) {
  const handler = (e) => {
    if (e.key !== "Escape") return;
    fn();
    document.removeEventListener("keydown", handler, true);
  };
  setTimeout(() => document.addEventListener("keydown", handler, true), 0);
}
