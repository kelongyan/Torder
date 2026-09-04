/**
 * mobile/routes.tsx — 移动端路由表（镜像 `设计稿/phone/js/app.js`）
 * tab 非空 = 主 Tab 根页（底部导航可见）；tab=null = 次级页（隐藏导航）。
 * M-B 实装：/new、/task/:id/edit（表单页）、/task/:id（设计稿详情页）、
 *          /search（全库搜索）、/recurring（规则列表）；/focus /review 占位至 M-C。
 */
import type { JSX } from "react";
import type { MobileRoute } from "./router";
import {
  BrowseScreen,
  CalendarScreen,
  MeScreen,
  TodayScreen,
} from "./pages/tabs";
import { TaskListPage } from "./pages/sub";
import { TaskDetailPage } from "./pages/taskDetail";
import { TaskFormPage } from "./pages/form";
import { SearchScreen } from "./pages/search";
import { RecurringScreen } from "./pages/recurring";
import { FocusScreen, ReviewScreen } from "./pages/focusReview";

export const mobileRoutes: MobileRoute[] = [
  {
    pattern: "/today",
    tab: "today",
    render: () => (<TodayScreen />) as JSX.Element,
  },
  {
    pattern: "/browse",
    tab: "browse",
    render: () => (<BrowseScreen />) as JSX.Element,
  },
  {
    pattern: "/calendar",
    tab: "calendar",
    render: () => (<CalendarScreen />) as JSX.Element,
  },
  {
    pattern: "/me",
    tab: "me",
    render: () => (<MeScreen />) as JSX.Element,
  },

  // 次级页（页面栈 push 目标）
  {
    pattern: "/view/:view",
    tab: null,
    render: (_ctx, params) => (
      <TaskListPage key="view" kind="view" view={params.view} />
    ),
  },
  {
    pattern: "/list/:listId",
    tab: null,
    render: (_ctx, params) => (
      <TaskListPage key="list" kind="list" listId={params.listId} />
    ),
  },
  {
    pattern: "/tag/:tag",
    tab: null,
    render: (_ctx, params) => (
      <TaskListPage key="tag" kind="tag" tag={params.tag} />
    ),
  },
  {
    pattern: "/task/:id",
    tab: null,
    render: (_ctx, params) => <TaskDetailPage taskId={params.id} />,
  },
  {
    pattern: "/task/:id/edit",
    tab: null,
    render: (_ctx, params) => (
      <TaskFormPage key={`edit-${params.id}`} mode="edit" taskId={params.id} />
    ),
  },
  {
    pattern: "/new",
    tab: null,
    render: (_ctx, _params, query) => (
      <TaskFormPage key="new" mode="new" query={query} />
    ),
  },
  {
    pattern: "/search",
    tab: null,
    render: () => <SearchScreen />,
  },
  {
    pattern: "/recurring",
    tab: null,
    render: () => <RecurringScreen />,
  },
  {
    pattern: "/focus",
    tab: null,
    render: () => <FocusScreen />,
  },
  {
    pattern: "/review",
    tab: null,
    render: () => <ReviewScreen />,
  },
];
