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
import { Calendar, CalendarCheck, Layers, Plus, Settings } from "lucide-react";
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
            props.openCreateDialog();
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
  const tabs: Array<{
    key: MobileTab;
    label: string;
    icon: JSX.Element;
  }> = [
    { key: "today", label: "今天", icon: <CalendarCheck aria-hidden="true" /> },
    { key: "browse", label: "浏览", icon: <Layers aria-hidden="true" /> },
    { key: "calendar", label: "日历", icon: <Calendar aria-hidden="true" /> },
    { key: "me", label: "我的", icon: <Settings aria-hidden="true" /> },
  ];
  const fabIndex = 2;

  return (
    <nav className="m-tabbar" aria-label="主导航">
      {tabs.map((tab, index) => {
        if (index === fabIndex) {
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
        return (
          <button
            key={tab.key}
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
