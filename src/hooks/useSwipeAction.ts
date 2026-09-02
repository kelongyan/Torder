import { useEffect, useRef } from "react";

export type SwipeDirection = "left" | "right";

export interface SwipeActionOptions {
  /** 触发动作的位移阈值（px），默认 96 */
  threshold?: number;
  /** 最大拖拽位移（px），超过后施加阻力，默认 120 */
  maxDrag?: number;
  /** 小于该位移释放时回弹（px），默认 32 */
  snapBackBelow?: number;
  /** 触发方向：left = 向左滑出（显示右侧动作，如"完成"）；right 反之 */
  onAction: (direction: SwipeDirection) => void;
  /** 未达阈值释放时的回弹完成回调（可做轻微错位提示） */
  onSnapBack?: () => void;
  /** 拖动期间加到元素上的 class（供 CSS 关闭 transition 实现跟手拖动） */
  swipeClass?: string;
}

/**
 * 单轴水平滑动动作（M0.4 / M2.1 任务行左滑完成 / 右滑详情）。
 *
 * 实现要点：
 * - touchstart 记录起点，仅接受 |dx| > |dy| 的横滑（竖滑让给页面滚动）；
 * - 拖拽过程通过 CSS 变量 `--swipe-x` 驱动 transform，不直接写内联 transform，
 *   方便调用方在同一元素叠加其它变换；
 * - 达到阈值松手即触发一次 onAction（自动归位），未达阈值回弹；
 * - `prefers-reduced-motion` 下不跟手拖拽（避免位移动画），改为直接点击判定。
 */
export function useSwipeAction(options: SwipeActionOptions) {
  const ref = useRef<HTMLElement | null>(null);
  const opts = useRef(options);

  // 事件监听只在挂载时绑定一次；最新 options 由独立 effect 同步到 ref，
  // 避免"渲染期写 ref"（react-hooks/refs）也避免频繁重绑事件。
  useEffect(() => {
    opts.current = options;
  }, [options]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let startX = 0;
    let startY = 0;
    let tracking = false;
    let horizontal = false;
    let acted = false;

    const setSwipeClass = (on: boolean) => {
      const { swipeClass } = opts.current;
      if (!swipeClass) return;
      element.classList.toggle(swipeClass, on);
    };

    const setOffset = (px: number) => {
      element.style.setProperty("--swipe-x", `${px.toFixed(1)}px`);
    };
    const settle = () => {
      setSwipeClass(false);
      element.style.removeProperty("--swipe-x");
    };
    const onTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      tracking = true;
      horizontal = false;
      acted = false;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!tracking) return;
      const touch = event.touches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (!horizontal && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 6) {
        horizontal = true;
      }
      if (!horizontal) return;
      event.preventDefault();
      setSwipeClass(true);
      const { maxDrag = 120 } = opts.current;
      const raw = dx;
      // 反向不做（单方向动作），正反向都允许负方向轻微回弹则由 snapBack 归位
      const clamped =
        Math.abs(raw) > maxDrag
          ? Math.sign(raw) * (maxDrag + (Math.abs(raw) - maxDrag) * 0.35)
          : raw;
      setOffset(clamped);
    };

    const finish = () => {
      if (!tracking) return;
      tracking = false;
      if (!horizontal || acted) {
        settle();
        return;
      }
      const { threshold = 96, snapBackBelow = 32 } = opts.current;
      const dx =
        parseFloat(element.style.getPropertyValue("--swipe-x")) || 0;
      if (Math.abs(dx) >= threshold) {
        acted = true;
        settle();
        opts.current.onAction(dx < 0 ? "left" : "right");
      } else if (Math.abs(dx) < snapBackBelow) {
        settle();
        opts.current.onSnapBack?.();
      } else {
        // 介于 snapBackBelow 与 threshold 之间：回弹但不触发动作
        element.style.transition = "transform 180ms var(--ease-out)";
        settle();
        window.setTimeout(() => {
          element.style.transition = "";
        }, 200);
      }
    };

    element.addEventListener("touchstart", onTouchStart, { passive: true });
    element.addEventListener("touchmove", onTouchMove, { passive: false });
    element.addEventListener("touchend", finish);
    element.addEventListener("touchcancel", finish);
    return () => {
      element.removeEventListener("touchstart", onTouchStart);
      element.removeEventListener("touchmove", onTouchMove);
      element.removeEventListener("touchend", finish);
      element.removeEventListener("touchcancel", finish);
    };
  }, []);

  return { ref };
}
