import { useCallback } from "react";

/**
 * 触感反馈（M0.4 / M1.4）。
 *
 * 克制策略：仅在用户主动 tap/click 时触发，绝不监听滚动/拖拽过程；
 * 尊重 `prefers-reduced-motion`（系统关闭动画时同样静音）；
 * `navigator.vibrate` 为可选 API（iOS Safari 不支持），调用方无需判空。
 *
 * @returns `haptic(kind)` —— kind: 'tap' | 'heavy' | 'success'
 */
export function useHaptic() {
  return useCallback(
    (kind: "tap" | "heavy" | "success" = "tap") => {
      if (typeof navigator === "undefined" || !navigator.vibrate) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const ms =
        kind === "tap" ? 8 : kind === "heavy" ? 16 : 12;
      navigator.vibrate(ms);
    },
    [],
  );
}
