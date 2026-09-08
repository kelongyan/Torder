/**
 * main.js — 入口：路由 ↔ store 同步、开发导览面板（showcase-nav，非产品 UI）、挂载 app
 */
import { h } from "./core/dom.js";
import { startApp } from "./app.js";
import { startRouter, go } from "./core/router.js";
import { getState, setScope, setLayout, setTheme, setAccent, setFontSize, applyTheme } from "./core/store.js";
import { ACCENTS, LAYOUTS } from "./data/enums.js";

const root = document.getElementById("app");

/* hash 变化 → 同步 store scope（setScope 会触发重渲染） */
function syncScopeFromRoute(route) {
  const s = getState();
  // 查询参数：?layout=board|month|week|agenda|list
  const q = location.hash.split("?")[1] ?? "";
  const layout = new URLSearchParams(q).get("layout");
  if (layout && LAYOUTS.some((l) => l.id === layout) && s.ui.layout !== layout) setLayout(layout);
  if (route.mode !== "main") return;
  const want = route.scope;
  const cur = s.ui.scope;
  const same = want.kind === cur.kind &&
    want.view === cur.view && want.listId === cur.listId && want.tag === cur.tag;
  if (!same) setScope(want);
}

startRouter((route) => syncScopeFromRoute(route));
startApp(root);

/* 查询参数预览：?theme=light&accent=emerald&font=large（设计稿走查用） */
{
  const q = new URLSearchParams(location.search);
  const theme = q.get("theme");
  if (theme === "light" || theme === "dark") setTheme(theme);
  const accent = q.get("accent");
  if (ACCENTS.some((a) => a.id === accent)) setAccent(accent);
  const font = q.get("font");
  if (["small", "standard", "large"].includes(font)) setFontSize(font);
}

/* ---------------- 开发导览面板 ---------------- */
function navGroup(title, items) {
  return h("div.showcase-group", {}, [
    h("div.showcase-group-title", { text: title }),
    ...items.map((it) =>
      h("a.showcase-link" + (it.active?.() ? ".active" : ""), {
        href: it.hash ?? "javascript:void(0)",
        onclick: it.onClick,
      }, [it.icon ? h("span", { class: "i-sm" }) : null, document.createTextNode(it.label)])),
  ]);
}
function buildShowcase() {
  const s = getState();
  const nav = h("nav.showcase-nav", {}, [
    h("div.showcase-brand", {}, [
      h("strong", { text: "Torder · Windows" }),
      h("span", { text: "桌面端 UI 设计稿（纯静态）" }),
    ]),
    h("div.showcase-scroll.scroll", {}, [
      navGroup("系统视图", [
        { label: "今天", hash: "#/view/today" },
        { label: "全部任务", hash: "#/view/all" },
        { label: "计划", hash: "#/view/planned" },
        { label: "逾期", hash: "#/view/overdue" },
        { label: "无日期", hash: "#/view/no-date" },
        { label: "重要", hash: "#/view/important" },
        { label: "已完成", hash: "#/view/completed" },
        { label: "回收站", hash: "#/view/deleted" },
      ].map((it) => ({ ...it, active: () => getState().ui.scope.kind === "view" && getState().ui.scope.view === it.hash.split("/").pop() }))),
      navGroup("清单 / 标签 / 其他", [
        { label: "清单：工作", hash: "#/list/list-work" },
        { label: "清单：个人", hash: "#/list/list-life" },
        { label: "标签：工作", hash: "#/tag/" + encodeURIComponent("工作") },
        { label: "全库搜索", hash: "#/search" },
        { label: "循环任务", hash: "#/recurring" },
      ]),
      navGroup("五种布局（当前视图内切换）", LAYOUTS.map((l) => ({
        label: l.label,
        onClick: () => setLayout(l.id),
        active: () => getState().ui.layout === l.id,
      }))),
      navGroup("弹层状态", [
        { label: "设置（8 Tab）", onClick: () => import("./views/settingsDialog.js").then((m) => m.openSettingsDialog()) },
        { label: "命令面板 Ctrl K", onClick: () => import("./views/commandPalette.js").then((m) => m.openCommandPalette({ openDetail: (t) => import("./core/store.js").then((x) => x.selectTask(t.id)) })) },
        { label: "新建任务", onClick: () => import("./views/taskDialog.js").then((m) => m.openTaskDialog({}, {})) },
        { label: "专注模式", onClick: () => import("./views/focusDialog.js").then((m) => m.openFocusDialog()) },
        { label: "每日回顾", onClick: () => import("./views/reviewDialog.js").then((m) => m.openReviewDialog({ openDetail: () => {} })) },
        { label: "统计概览", onClick: () => import("./views/statsDialog.js").then((m) => m.openStatsDialog()) },
      ]),
      navGroup("独立窗口", [
        { label: "迷你速记窗", hash: "#/mini" },
        { label: "桌面便签", hash: "#/widget" },
        { label: "返回主窗", hash: "#/today" },
      ]),
      h("div.showcase-group", {}, [
        h("div.showcase-group-title", { text: "主题" }),
        h("div.row.gap-2", { style: { padding: "0 12px 8px" } }, [
          h("button.chip", { text: "深色", onclick: () => setTheme("dark") }),
          h("button.chip", { text: "浅色", onclick: () => setTheme("light") }),
        ]),
        h("div.swatch-row", { style: { padding: "0 12px 10px" } }, ACCENTS.map((a) =>
          h("button.swatch", { style: { background: a.color, width: 18, height: 18 }, title: a.label, onclick: () => setAccent(a.id) }))),
      ]),
    ]),
  ]);
  document.body.classList.add("with-showcase");
  document.getElementById("showcase").replaceChildren(nav);
}
buildShowcase();
import("./core/store.js").then(({ subscribe }) => subscribe(() => buildShowcase()));
