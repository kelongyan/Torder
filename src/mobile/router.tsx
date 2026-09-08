/**
 * mobile/router.tsx — 移动端页面栈路由（M-A）
 *
 * 语义镜像 `设计稿/phone/js/core/router.js`：
 *  - push(path)  进入下一级（pushState，历史+1）
 *  - replace     替换栈顶（新建成功后进详情等场景）
 *  - back()      返回上一级；栈底（Tab 根）且非 /today 时回 /today（决策 D4）
 *  - tab(key)    切换底部主 Tab：整栈替换（replaceState，不累积历史）
 *
 * 与浏览器 History 同步：安卓物理返回 / 系统手势返回 → popstate → 逐层 back。
 * 转场：M-A 先落进入动画（push 右入 / tab 淡入），退出与回退动画 M-B 精修。
 *
 * 说明：移动导航基建文件，路由 API 与 Provider 同文件维护；
 * fast-refresh 细粒度 HMR 对导航核心影响可忽略，故整文件豁免该规则。
 */
/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { JSX } from "react";

export type MobileTab = "today" | "browse" | "calendar" | "me";

export interface MobileParams {
  [key: string]: string;
}
export interface MobileQuery {
  [key: string]: string;
}

/** 路由表条目：pattern 支持 "/task/:id" 形式；tab=null 表示次级页（隐藏 Tab 栏） */
export interface MobileRoute {
  pattern: string;
  tab: MobileTab | null;
  render: (
    ctx: MobilePageContext,
    params: MobileParams,
    query: MobileQuery,
  ) => ReactNode;
}

interface MobileEntry {
  key: string;
  path: string;
  route: MobileRoute;
  params: MobileParams;
  query: MobileQuery;
}

export interface MobileRouterApi {
  push: (path: string) => void;
  replace: (path: string) => void;
  back: () => void;
  tab: (key: MobileTab) => void;
  currentPath: () => string;
  depth: () => number;
}

export interface MobilePageContext {
  nav: MobileRouterApi;
}

const MobilePageContextValue = createContext<MobilePageContext | null>(null);

export function useMobilePage(): MobilePageContext {
  const ctx = useContext(MobilePageContextValue);
  if (!ctx) {
    throw new Error("useMobilePage 必须在移动页面路由上下文内使用");
  }
  return ctx;
}

/* ---------------- 纯函数：路由匹配 / 查询解析（可单测） ---------------- */

export function matchRoute(
  routes: MobileRoute[],
  path: string,
): { route: MobileRoute; params: MobileParams } | null {
  const pure = path.split("?")[0];
  for (const route of routes) {
    const params = matchPattern(route.pattern, pure);
    if (params) return { route, params };
  }
  return null;
}

export function matchPattern(
  pattern: string,
  path: string,
): MobileParams | null {
  const pSeg = pattern.split("/").filter(Boolean);
  const xSeg = path.split("/").filter(Boolean);
  if (pSeg.length !== xSeg.length) return null;
  const params: MobileParams = {};
  for (let i = 0; i < pSeg.length; i++) {
    if (pSeg[i].startsWith(":")) {
      params[pSeg[i].slice(1)] = decodeURIComponent(xSeg[i]);
    } else if (pSeg[i] !== xSeg[i]) {
      return null;
    }
  }
  return params;
}

export function parseMobileQuery(path: string): MobileQuery {
  const q = path.split("?")[1];
  if (!q) return {};
  return Object.fromEntries(new URLSearchParams(q));
}

export function stripMobileQuery(path: string): string {
  return path.split("?")[0];
}

/** 主 Tab 起始路径（tab → 根路由 path） */
export const TAB_START_PATH: Record<MobileTab, string> = {
  today: "/today",
  browse: "/browse",
  calendar: "/calendar",
  me: "/me",
};

/* ---------------- React 路由 hook ---------------- */

export function useMobileRouter(routes: MobileRoute[], initialPath: string) {
  const [entries, setEntries] = useState<MobileEntry[]>(() => [
    buildEntry(routes, initialPath),
  ]);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  /** 最近一次导航方向（渲染层据此选进场动画） */
  const [navKind, setNavKind] = useState<"push" | "back" | "tab">("tab");

  function buildEntry(routesList: MobileRoute[], path: string): MobileEntry {
    const clean = stripMobileQuery(path);
    const query = parseMobileQuery(path);
    const hit = matchRoute(routesList, clean);
    const route = hit?.route ?? routesList[0];
    const params =
      hit?.params ??
      matchPattern(
        routesList[0].pattern,
        stripMobileQuery(routesList[0].pattern),
      ) ??
      {};
    return {
      key: `${clean}::${Math.random().toString(36).slice(2, 8)}`,
      path: clean,
      route,
      params,
      query,
    };
  }

  // 主 Tab 路由：route.tab 与 key 相同的第一个即为该 Tab 的根页。
  const tabRootPath = useMemo(() => {
    const map: Partial<Record<MobileTab, string>> = {};
    for (const route of routes) {
      if (route.tab && !map[route.tab]) {
        // 默认以 TAB_START_PATH 为准；若无显式注册则用 route.pattern。
        map[route.tab] = TAB_START_PATH[route.tab] ?? route.pattern;
      }
    }
    return map;
  }, [routes]);

  const currentPath = () =>
    entriesRef.current[entriesRef.current.length - 1].path;
  const depth = () => entriesRef.current.length;

  const push = (path: string) => {
    const entry = buildEntry(routes, path);
    setNavKind("push");
    setEntries((prev) => [...prev, entry]);
    window.history.pushState({ mobileNav: true }, "");
  };

  const replace = (path: string) => {
    const entry = buildEntry(routes, path);
    setNavKind("tab");
    setEntries((prev) => {
      const next = [...prev];
      next[next.length - 1] = entry;
      return next;
    });
    window.history.replaceState({ mobileNav: true }, "");
  };

  const goTab = (key: MobileTab) => {
    const path = tabRootPath[key] ?? TAB_START_PATH[key];
    setNavKind("tab");
    setEntries([buildEntry(routes, path)]);
    window.history.replaceState({ mobileNav: true }, "");
  };

  const back = () => {
    const list = entriesRef.current;
    if (list.length > 1) {
      // 有可返回层：交给浏览器历史，popstate 回调完成弹栈。
      window.history.back();
      return;
    }
    // 栈底：非 today 回 today（D4），已是 today 不动作（系统再返回即退出应用）。
    const current = currentPath();
    if (current !== TAB_START_PATH.today) {
      goTab("today");
    }
  };

  // 系统返回 / 浏览器后退统一在此弹栈。
  useEffect(() => {
    const onPopState = () => {
      const list = entriesRef.current;
      if (list.length <= 1) {
        // 浏览器历史已弹到栈底：若当前非 today 则回 today（兜底）。
        const current = currentPath();
        if (current !== TAB_START_PATH.today) {
          goTab("today");
        }
        return;
      }
      setNavKind("back");
      setEntries((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
    // popstate 只订阅一次；onPopState 通过 entriesRef 读最新栈，
    // goTab 首帧闭包引用的 routes 为模块常量，稳定无需重订阅。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const api = useMemo<MobileRouterApi>(
    () => ({
      push,
      replace,
      back,
      tab: goTab,
      currentPath,
      depth,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [routes],
  );

  return { entries, api, navKind };
}

/** 顶层页面上下文 Provider（页面经 useMobilePage 取导航能力） */
export function MobilePageProvider({
  ctx,
  children,
}: {
  ctx: MobilePageContext;
  children: ReactNode;
}): JSX.Element {
  return (
    <MobilePageContextValue.Provider value={ctx}>
      {children}
    </MobilePageContextValue.Provider>
  );
}
