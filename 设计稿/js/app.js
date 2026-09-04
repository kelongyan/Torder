/**
 * app.js — 装配层：初始化数据、注册路由表、挂载外壳（状态栏/Tab栏）、
 * 订阅 store 变更以静默刷新当前屏幕。视图模块不互相直接依赖，全部经此组装。
 */
import { h } from "./core/dom.js";
import { createRouter } from "./core/router.js";
import * as store from "./core/store.js";
import { renderStatusBar, renderTabBar, setActiveTab } from "./components/chrome.js";

import { renderToday } from "./views/todayView.js";
import { renderBrowse } from "./views/browseView.js";
import { renderCalendar } from "./views/calendarView.js";
import { renderSettings } from "./views/settingsView.js";
import { renderTaskList } from "./views/taskListView.js";
import { renderTaskDetail } from "./views/taskDetailView.js";
import { renderTaskForm } from "./views/taskFormView.js";
import { renderSearch } from "./views/searchView.js";
import { renderRecurring } from "./views/recurringView.js";
import { renderFocus } from "./views/focusView.js";
import { renderReview } from "./views/reviewView.js";

export function bootstrap() {
  store.initStore();

  const phone = document.querySelector(".phone");
  const screenRoot = document.querySelector(".screen-root");

  /* 视图共享上下文：导航能力 + 静默重绘 */
  const ctx = { nav: null, rerender: () => router.rerenderCurrent() };

  /* 路由表：pattern + render + 所属主 Tab（次级页 tab=null，Tab 高亮保持不变） */
  const routes = [
    { pattern: "/today", tab: "today", render: (p, q) => renderToday(p, q, ctx) },
    { pattern: "/browse", tab: "browse", render: (p, q) => renderBrowse(p, q, ctx) },
    { pattern: "/calendar", tab: "calendar", render: (p, q) => renderCalendar(p, q, ctx) },
    { pattern: "/me", tab: "me", render: (p, q) => renderSettings(p, q, ctx) },

    { pattern: "/view/:view", tab: "browse", render: (p, q) => renderTaskList(p, q, ctx, "view") },
    { pattern: "/list/:listId", tab: "browse", render: (p, q) => renderTaskList(p, q, ctx, "list") },
    { pattern: "/tag/:tag", tab: "browse", render: (p, q) => renderTaskList(p, q, ctx, "tag") },

    { pattern: "/task/:id", tab: null, render: (p, q) => renderTaskDetail(p, q, ctx) },
    { pattern: "/task/:id/edit", tab: null, render: (p, q) => renderTaskForm(p, q, ctx, "edit") },
    { pattern: "/new", tab: null, render: (p, q) => renderTaskForm(p, q, ctx, "new") },
    { pattern: "/search", tab: null, render: (p, q) => renderSearch(p, q, ctx) },
    { pattern: "/recurring", tab: null, render: (p, q) => renderRecurring(p, q, ctx) },
    { pattern: "/focus", tab: null, render: (p, q) => renderFocus(p, q, ctx) },
    { pattern: "/review", tab: null, render: (p, q) => renderReview(p, q, ctx) },
  ];

  const router = createRouter(routes, screenRoot, {
    onNavigate: (route) => {
      // 主 Tab 页显示底部导航；次级全屏页（detail/form/search/focus…）隐藏
      phone.classList.toggle("is-subpage", !route.tab);
      if (route.tab) setActiveTab(tabBar, route.tab);
    },
  });
  ctx.nav = router;

  /* 外壳：状态栏（模拟） + 底部 Tab（持久） */
  renderStatusBar(phone);
  const tabBar = renderTabBar(phone, {
    active: "today",
    onTab: (path) => router.tab(path),
    onCreate: () => {
      // 在清单页新建时自动预选该清单
      const route = router.currentRoute();
      const params = router.currentParams();
      if (route?.pattern === "/list/:listId") router.push(`/new?listId=${params.listId}`);
      else router.push("/new");
    },
  });

  /* 数据变更 → 静默刷新当前屏（rAF 合帧，避免连续变更多次重绘） */
  let raf = 0;
  store.subscribe(() => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => router.rerenderCurrent());
  });

  router.start("/today");
}
