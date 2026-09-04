/**
 * router.pure.test.ts — 移动路由纯函数（M-E：node 环境无 DOM 依赖）
 * 覆盖：路径匹配 / 参数解码 / 查询解析 / Tab 根映射 / matchRoute 命中与回退。
 */
import { describe, expect, it } from "vitest";
import type { MobileRoute } from "./router";
import {
  matchPattern,
  matchRoute,
  parseMobileQuery,
  stripMobileQuery,
  TAB_START_PATH,
} from "./router";

const FAKE_ROUTES: MobileRoute[] = [
  { pattern: "/today", tab: "today", render: () => null },
  { pattern: "/task/:id", tab: null, render: () => null },
  { pattern: "/task/:id/edit", tab: null, render: () => null },
  { pattern: "/list/:listId", tab: null, render: () => null },
];

describe("matchPattern", () => {
  it("字面段匹配", () => {
    expect(matchPattern("/today", "/today")).toEqual({});
  });
  it("参数段捕获并解码", () => {
    expect(matchPattern("/task/:id", "/task/abc123")).toEqual({
      id: "abc123",
    });
    expect(matchPattern("/tag/:tag", "/tag/%E6%A0%87%E7%AD%BE")).toEqual({
      tag: "标签",
    });
  });
  it("段数不一致与不匹配返回 null", () => {
    expect(matchPattern("/task/:id", "/task")).toBeNull();
    expect(matchPattern("/task/:id", "/task/1/2")).toBeNull();
    expect(matchPattern("/list/:listId", "/today")).toBeNull();
  });
  it("注册表顺序无关段数校验：三段的 edit 路由正确命中", () => {
    const hit = matchRoute(
      [
        { pattern: "/task/:id", tab: null, render: () => null },
        { pattern: "/task/:id/edit", tab: null, render: () => null },
      ],
      "/task/abc/edit",
    );
    expect(hit?.route.pattern).toBe("/task/:id/edit");
    expect(hit?.params).toEqual({ id: "abc" });
  });
});

describe("parseMobileQuery / stripMobileQuery", () => {
  it("解析 query 参数", () => {
    expect(parseMobileQuery("/new?listId=a&scheduledDate=2026-09-05")).toEqual({
      listId: "a",
      scheduledDate: "2026-09-05",
    });
  });
  it("无 query 返回空对象", () => {
    expect(parseMobileQuery("/today")).toEqual({});
  });
  it("剥离 query 前缀", () => {
    expect(stripMobileQuery("/new?x=1")).toBe("/new");
  });
});

describe("matchRoute", () => {
  it("命中已注册路由并返回参数", () => {
    const hit = matchRoute(FAKE_ROUTES, "/task/t-1?tab=1");
    expect(hit?.route.pattern).toBe("/task/:id");
    expect(hit?.params).toEqual({ id: "t-1" });
  });
  it("未命中返回 null", () => {
    expect(matchRoute(FAKE_ROUTES, "/missing")).toBeNull();
  });
});

describe("TAB_START_PATH", () => {
  it("四个主 Tab 均映射到起始路由", () => {
    expect(TAB_START_PATH).toEqual({
      today: "/today",
      browse: "/browse",
      calendar: "/calendar",
      me: "/me",
    });
  });
});
