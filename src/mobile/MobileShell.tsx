/**
 * mobile/MobileShell.tsx — 移动端壳（M-A）
 *
 * App 在 isMobile() 时渲染本组件替代桌面三栏。职责：
 *  - 持有移动页面栈（useMobileRouter），渲染当前页
 *  - 注入导航上下文（useMobilePage）与 App 能力（useMobileProps）
 *  - 渲染底部导航 4 Tab + 中央 FAB；次级页隐藏（tab=null）
 *  - 转场：push 右入 / back 左入 / tab 淡入（M-A 进场动画；退出动画 M-B 精修）
 */
import { type JSX } from "react";
import { Calendar, CalendarRange, Layers, Plus, Settings } from "lucide-react";
import { useMobileRouter, MobilePageProvider } from "./router";
import type { MobileTab, MobilePageContext } from "./router";
import { mobileRoutes } from "./routes";
import { MobilePropsProvider } from "./context";
import type { MobileShellProps } from "./types";
import "./mobile.css";

export function MobileShell(props: MobileShellProps): JSX.Element {
  const { entries, api, navKind } = useMobileRouter(mobileRoutes, "/today");

  // 页面共享 ctx：页面用 useMobilePage() 拿导航
  const pageCtx: MobilePageContext = { nav: api };

  const top = entries[entries.length - 1];
  const showTabBar = top.route.tab !== null;
  const activeTab: MobileTab | null = top.route.tab;

  return (
    <div className="m-app">
      <div className="m-screen-host">
        <div key={top.key} className={`m-screen m-anim-${navKind}`}>
          <MobilePageProvider ctx={pageCtx}>
            <MobilePropsProvider value={props}>
              {top.route.render(pageCtx, top.params, top.query)}
            </MobilePropsProvider>
          </MobilePageProvider>
        </div>
      </div>

      {showTabBar && (
        <MobileTabBar
          active={activeTab}
          onCreate={() => {
            navigator.vibrate?.(8);
            api.push("/new");
          }}
          onTab={(key) => {
            api.tab(key);
          }}
        />
      )}
    </div>
  );
}

function MobileTabBar({
  active,
  onCreate,
  onTab,
}: {
  active: MobileTab | null;
  onCreate: () => void;
  onTab: (key: MobileTab) => void;
}): JSX.Element {
  // 槽位顺序镜像设计稿 chrome.js TABS：今天 · 浏览 · ＋FAB · 日历 · 我的
  const slots: Array<
    | { kind: "tab"; key: MobileTab; label: string; icon: JSX.Element }
    | { kind: "fab" }
  > = [
    {
      kind: "tab",
      key: "today",
      label: "今天",
      icon: <Calendar aria-hidden="true" />,
    },
    {
      kind: "tab",
      key: "browse",
      label: "浏览",
      icon: <Layers aria-hidden="true" />,
    },
    { kind: "fab" },
    {
      kind: "tab",
      key: "calendar",
      label: "日历",
      icon: <CalendarRange aria-hidden="true" />,
    },
    {
      kind: "tab",
      key: "me",
      label: "我的",
      icon: <Settings aria-hidden="true" />,
    },
  ];

  return (
    <nav className="m-tabbar" aria-label="主导航">
      {slots.map((slot, index) => {
        if (slot.kind === "fab") {
          return (
            <div key="fab-slot" className="m-tab-fab-slot" aria-hidden="true">
              <button
                type="button"
                className="m-tab-fab"
                onClick={onCreate}
                aria-label="新建任务"
              >
                <Plus aria-hidden="true" />
              </button>
            </div>
          );
        }
        const tab = slot;
        return (
          <button
            key={tab.key ?? index}
            type="button"
            className={`m-tab ${active === tab.key ? "active" : ""}`}
            aria-label={tab.label}
            onClick={() => onTab(tab.key)}
          >
            <span className="m-tab-icon">{tab.icon}</span>
            <span className="m-tab-label">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
