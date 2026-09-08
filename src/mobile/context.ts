/**
 * mobile/context.ts — 移动页面共享上下文（shell props）
 * Provider 由 MobileShell 注入；页面经 useMobileProps() 取 App 闭包能力。
 */
import { createContext, useContext } from "react";
import type { MobileShellProps } from "./types";

const MobilePropsContext = createContext<MobileShellProps | null>(null);

export function useMobileProps(): MobileShellProps {
  const value = useContext(MobilePropsContext);
  if (!value) {
    throw new Error("useMobileProps 必须在 MobileShell 内使用");
  }
  return value;
}

export const MobilePropsProvider = MobilePropsContext.Provider;
