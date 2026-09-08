/**
 * mobile/ui.tsx — 移动端基础 UI 原语（M-A 先覆盖页面壳所需）
 * 结构语义对齐 `设计稿/phone`：appbar / screen / nav-row / group。
 */
import type { JSX, ReactNode } from "react";
import { ArrowLeft, ChevronRight } from "lucide-react";

export interface TopBarAction {
  icon: JSX.Element;
  label: string;
  onClick: () => void;
  accent?: boolean;
}

export function TopBar({
  back,
  onBack,
  title,
  sub,
  actions,
}: {
  back?: boolean;
  onBack?: () => void;
  title: string;
  sub?: string;
  actions?: TopBarAction[];
}): JSX.Element {
  return (
    <header className="m-topbar">
      <div className="m-topbar-inner">
        {back && (
          <button
            type="button"
            className="m-topbar-icon"
            aria-label="返回"
            onClick={onBack}
          >
            <ArrowLeft aria-hidden="true" />
          </button>
        )}
        <div className="m-topbar-title">
          <h1 className="m-topbar-h">{title}</h1>
          {sub ? <div className="m-topbar-sub">{sub}</div> : null}
        </div>
        <div className="m-topbar-actions">
          {actions?.map((action) => (
            <button
              key={action.label}
              type="button"
              className={`m-topbar-icon ${action.accent ? "m-topbar-accent" : ""}`}
              aria-label={action.label}
              onClick={action.onClick}
            >
              {action.icon}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}

/** 全屏页骨架：顶栏 + 可滚动正文 + 可选吸底操作栏 */
export function ScreenShell({
  topbar,
  children,
  footer,
  className = "",
}: {
  topbar: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <section className={`m-page ${className}`}>
      {topbar}
      <div className={`m-page-body ${footer ? "has-footer" : ""}`}>
        {children}
      </div>
      {footer ? <footer className="m-page-footer">{footer}</footer> : null}
    </section>
  );
}

export function SectionTitle({
  children,
  right,
}: {
  children: ReactNode;
  right?: ReactNode;
}): JSX.Element {
  return (
    <div className="m-section-title">
      <span>{children}</span>
      {right}
    </div>
  );
}

export function EmptyView({
  icon,
  title,
  body,
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
}): JSX.Element {
  return (
    <div className="m-empty">
      {icon ? <div className="m-empty-icon">{icon}</div> : null}
      <div className="m-empty-title">{title}</div>
      {body ? <div className="m-empty-body">{body}</div> : null}
    </div>
  );
}

/** 导航行（浏览页/我的页入口） */
export function NavRow({
  tint,
  icon,
  label,
  badge,
  danger = false,
  onClick,
  trailing,
}: {
  tint?: string;
  icon: ReactNode;
  label: string;
  badge?: number | string;
  danger?: boolean;
  onClick: () => void;
  /** 尾随自定元素（如编辑按钮） */
  trailing?: ReactNode;
}): JSX.Element {
  return (
    <div className="m-nav-row-wrap">
      <button
        type="button"
        className={`m-nav-row ${danger ? "m-nav-row-danger" : ""}`}
        onClick={onClick}
      >
        <span
          className="m-nav-icon"
          style={
            tint
              ? {
                  background: `color-mix(in srgb, ${tint} 16%, transparent)`,
                  color: tint,
                }
              : undefined
          }
        >
          {icon}
        </span>
        <span className="m-nav-label">{label}</span>
        {badge !== undefined ? <span className="m-badge">{badge}</span> : null}
        <span className="m-nav-chevron">
          <ChevronRight aria-hidden="true" />
        </span>
      </button>
      {trailing}
    </div>
  );
}
