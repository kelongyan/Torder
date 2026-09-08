/**
 * header.js — 主区顶部工具条（镜像 MainHeader）
 * 左：当前视图标题 + 元信息；中：5 布局分段（滑动拇指）；
 * 右：排序/筛选/批量/命令面板/专注/迷你窗/回顾 + 主题/同步/更多 + 新建
 */
import { h } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { LAYOUTS, VIEW_LABEL } from "../data/enums.js";
import { getState, setLayout, setTheme, getList, queryTasks } from "../core/store.js";
import { openSortMenu, openFilterMenu, openViewMenu } from "./menus.js";

function titleOf(scope) {
  if (scope.kind === "view") return VIEW_LABEL[scope.view] ?? "全部任务";
  if (scope.kind === "list") return getList(scope.listId)?.name ?? "清单";
  if (scope.kind === "tag") return `#${scope.tag}`;
  if (scope.kind === "search") return "搜索结果";
  if (scope.kind === "recurring") return "循环任务";
  return "Torder";
}

export function renderHeader(ctx = {}) {
  const s = getState();
  const isDeleted = s.ui.scope.kind === "view" && s.ui.scope.view === "deleted";
  const showLayout = ["view", "list", "tag"].includes(s.ui.scope.kind) && !isDeleted;
  const count = queryTasks().length;
  const layoutLabel = LAYOUTS.find((l) => l.id === s.ui.layout)?.label ?? "列表";

  /* 布局分段 + 滑动拇指 */
  const tabs = h("div.layout-tabs");
  const thumb = h("span.seg-thumb");
  tabs.append(thumb);
  for (const lay of LAYOUTS) {
    tabs.append(h("button" + (s.ui.layout === lay.id ? ".active" : ""), {
      title: lay.label,
      onclick: () => { setLayout(lay.id); },
    }, [icon(lay.icon, "i-sm"), h("span", { text: lay.label })]));
  }
  requestAnimationFrame(() => moveThumb(tabs, thumb));

  const iconBtn = (ic, title, onClick, extraClass = "") =>
    h("button.icon-btn " + extraClass, { title, html: icon(ic, "i-sm"), onclick: onClick });

  const header = h("header.main-header", {}, [
    h("div.header-copy", {}, [
      h("h1", { text: titleOf(s.ui.scope) }),
      h("p", { text: showLayout ? `${count} 项 · ${layoutLabel}` : ctx.meta ?? "" }),
    ]),
    h("div.header-spacer"),
    h("div.header-tools", {}, [
      showLayout ? tabs : null,
      showLayout ? iconBtn("arrow-down-up", "排序", (e) => openSortMenu(e.currentTarget)) : null,
      showLayout ? iconBtn("filter", "筛选", (e) => openFilterMenu(e.currentTarget), "filter-btn") : null,
      showLayout ? iconBtn("check-square", "批量选择 (B)", () => ctx.toastRef?.("批量选择（设计稿演示）")) : null,
      h("div.header-divider"),
      iconBtn("command", "命令面板 (Ctrl K)", () => ctx.openCommand?.()),
      iconBtn("flame", "专注模式", () => ctx.openFocus?.(), "focus-launch"),
      iconBtn("sparkles", "迷你速记窗 (Ctrl Shift M)", () => ctx.openMini?.()),
      iconBtn("trending-up", "每日回顾", () => ctx.openReview?.()),
      h("div.header-divider"),
      iconBtn(s.prefs.theme === "dark" ? "sun" : "moon", "切换主题", () =>
        setTheme(s.prefs.theme === "dark" ? "light" : "dark")),
      iconBtn("cloud", "同步正常", () => ctx.openSettings?.("sync")),
      iconBtn("more-horizontal", "更多", (e) => openViewMenu(e.currentTarget, ctx)),
      showLayout
        ? h("button.header-create", { onclick: () => ctx.openCreate?.() }, [icon("plus", "i-sm"), document.createTextNode("新建")])
        : null,
    ]),
  ]);
  return header;
}

function moveThumb(tabs, thumb) {
  const active = tabs.querySelector("button.active");
  if (!active) { thumb.style.opacity = "0"; return; }
  thumb.style.width = `${active.offsetWidth}px`;
  thumb.style.transform = `translateX(${active.offsetLeft - 3}px)`;
  thumb.style.opacity = "1";
}
