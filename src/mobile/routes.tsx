/**
 * mobile/routes.tsx — 移动端路由表（镜像 `设计稿/phone/js/app.js` 的页面清单）
 * tab 非空 = 主 Tab 根页（底部导航可见）；tab=null = 次级页（隐藏导航，顶栏出返回）。
 */
import type { JSX } from "react";
import type { MobileRoute } from "./router";
import {
  BrowseScreen,
  CalendarScreen,
  MeScreen,
  TodayScreen,
} from "./pages/tabs";
import { PlaceholderPage, TaskDetailPage, TaskListPage } from "./pages/sub";

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
    pattern: "/search",
    tab: null,
    render: () => <PlaceholderPage path="/search" />,
  },
  {
    pattern: "/recurring",
    tab: null,
    render: () => <PlaceholderPage path="/recurring" />,
  },
  {
    pattern: "/focus",
    tab: null,
    render: () => <PlaceholderPage path="/focus" />,
  },
  {
    pattern: "/review",
    tab: null,
    render: () => <PlaceholderPage path="/review" />,
  },
];
