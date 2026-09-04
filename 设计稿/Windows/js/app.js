/**
 * app.js — 主窗装配：外壳（标题栏/侧栏/头部/内容/详情抽屉）+ 视图分发 + 快捷键
 * 视图签名：render(route, ctx)；store 变更经 rAF 合帧后整体重渲染（设计稿规模足够）。
 */
import { h, mount } from "./core/dom.js";
import {
  initStore, subscribe, getState, selectTask, setScope, toggleSidebar,
  setLayout, setSearchQuery, createList,
} from "./core/store.js";
import { go, currentRoute } from "./core/router.js";
import { toast } from "./core/toast.js";

import { renderTitleBar } from "./components/titleBar.js";
import { renderSidebar } from "./components/sidebar.js";
import { renderHeader } from "./components/header.js";
import { renderDetailDrawer } from "./components/detailDrawer.js";

import { listView } from "./views/listView.js";
import { boardView } from "./views/boardView.js";
import { agendaView } from "./views/agendaView.js";
import { monthView } from "./views/monthView.js";
import { weekView } from "./views/weekView.js";
import { searchView } from "./views/searchView.js";
import { recurringView } from "./views/recurringView.js";
import { miniWindow } from "./views/miniWindow.js";
import { noteWidget } from "./views/noteWidget.js";

import { openTaskDialog } from "./views/taskDialog.js";
import { openSettingsDialog } from "./views/settingsDialog.js";
import { openFocusDialog } from "./views/focusDialog.js";
import { openReviewDialog } from "./views/reviewDialog.js";
import { openStatsDialog } from "./views/statsDialog.js";
import { openCommandPalette } from "./views/commandPalette.js";
import { openDialog } from "./core/modal.js";
import { icon } from "./core/icons.js";


/* ---------------- 视图分发 ---------------- */
function renderContent(route, ctx) {
  const s = getState();
  const scope = s.ui.scope;
  if (scope.kind === "search") return searchView(route, ctx);
  if (scope.kind === "recurring") return recurringView(route, ctx);
  if (scope.kind === "view" && scope.view === "deleted") return listView(route, ctx);

  switch (s.ui.layout) {
    case "board": return boardView(route, ctx);
    case "agenda": return agendaView(route, ctx);
    case "month": return monthView(route, ctx);
    case "week": return weekView(route, ctx);
    default: return listView(route, ctx);
  }
}

/* ---------------- 小弹层：新建清单 / 循环规则 ---------------- */
function openListDialog() {
  const input = h("input.input", { type: "text", placeholder: "清单名称", style: { marginBottom: 12 } });
  const colors = ["#6366f1", "#10b981", "#06b6d4", "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6", "#64748b"];
  let color = colors[0];
  const swatches = h("div.swatch-row", {}, colors.map((c) =>
    h("button.swatch" + (c === color ? ".selected" : ""), {
      style: { background: c },
      onclick: () => { color = c; swatches.querySelectorAll(".swatch").forEach((el, i) => el.classList.toggle("selected", colors[i] === c)); },
    })));
  const body = h("div", {}, [input, h("label.field-label", { text: "颜色" }), swatches]);
  const ctrl = openDialog({
    title: "新建清单", icon: "folder", body, width: 420,
    footer: h("div.dialog-footer-row", {}, [
      h("button.btn.btn-ghost", { text: "取消", onclick: () => ctrl.close() }),
      h("button.btn.btn-primary", {
        text: "创建",
        onclick: () => {
          if (!input.value.trim()) return;
          const l = createList({ name: input.value, color });
          ctrl.close();
          setScope({ kind: "list", listId: l.id });
          go(`/list/${l.id}`);
        },
      }),
    ]),
  });
  requestAnimationFrame(() => input.focus());
}

/* ---------------- 主窗渲染 ---------------- */
function renderMain(root, route, ctx) {
  const s = getState();
  root.className = "desktop-stage";
  root.replaceChildren(
    h("div.app-window" + (s.ui.sidebarCollapsed ? ".sidebar-collapsed" : ""), {}, [
      renderTitleBar(),
      h("div.window-body", {}, [
        renderSidebar(ctx),
        h("main.main-area", {}, [
          renderHeader(ctx),
          h("div.content-scroll.scroll", {}, [renderContent(route, ctx)]),
        ]),
        renderDetailDrawer(ctx),
      ]),
    ]),
  );
}

function renderIndependent(root, route, ctx) {
  root.className = "desktop-stage independent";
  if (route.mode === "mini") root.replaceChildren(miniWindow(ctx));
  else root.replaceChildren(noteWidget(ctx));
}

/* ---------------- 启动 ---------------- */
export function startApp(root) {
  initStore();

  const ctx = {
    openDetail: (task) => selectTask(task.id),
    openEditor: (task) => openTaskDialog({ task }, ctx),
    openCreate: (listId, priority) => openTaskDialog({ presetListId: listId, presetPriority: priority }, ctx),
    openSettings: (tab) => openSettingsDialog(tab ?? "general"),
    openFocus: () => openFocusDialog(),
    openReview: () => openReviewDialog(ctx),
    openStats: () => openStatsDialog(),
    openCommand: () => openCommandPalette(ctx),
    openMini: () => go("/mini"),
    openRecurringEditor: () => toast("循环规则编辑器（设计稿演示）"),
    onAddList: () => openListDialog(),
    onSearch: (q) => { setSearchQuery(q); setScope({ kind: "search" }); },
    toastRef: (msg) => toast(msg),
  };

  function rerender() {
    const route = currentRoute();
    if (route.mode === "main") renderMain(root, route, ctx);
    else renderIndependent(root, route, ctx);
  }

  // setTimeout 合帧（rAF 在后台标签/最小化窗口会被暂停，设计稿需要始终可重渲染）
  let queued = false;
  subscribe(() => {
    if (queued) return;
    queued = true;
    setTimeout(() => { queued = false; rerender(); }, 16);
  });

  rerender();
  bindShortcuts(ctx);
}

/* ---------------- 全局快捷键（镜像桌面注册） ---------------- */
function bindShortcuts(ctx) {
  window.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); ctx.openCommand(); }
    else if (mod && e.key.toLowerCase() === "n") { e.preventDefault(); ctx.openCreate(); }
    else if (mod && e.key.toLowerCase() === "b") { e.preventDefault(); toggleSidebar(); }
    else if (mod && e.key === ",") { e.preventDefault(); ctx.openSettings(); }
    else if (mod && e.shiftKey && e.key.toLowerCase() === "m") { e.preventDefault(); ctx.openMini(); }
    else if (e.key === "Escape") document.dispatchEvent(new KeyboardEvent("torder-escape"));
  });
}
