import { useEffect, useRef, useState } from "react";

/**
 * 滚动方向感知（M0.4）：向下滚动时隐藏 header（返回 `true`），向上滚动显示。
 *
 * 通用接口：默认监听 window；若内容在容器内滚动（Torder 各内容面板多为独立
 * 滚动容器），把容器元素绑到 `headerRef` 即可（`<main ref={headerRef}>`）。
 *
 * 阈值/回弹逻辑：滚动距顶 ≤4px 恒显示；单次滚动增量 >6px 判为"向下滚"→隐藏，
 * 向上滚 → 显示。`prefers-reduced-motion` 用户不位移，仅让调用方切换 opacity。
 */
export function useScrollHeader<T extends HTMLElement = HTMLDivElement>() {
  const containerRef = useRef<T | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    const scrollTarget: Window | HTMLElement = container ?? window;
    const isWindow = scrollTarget === window;
    let lastY: number = isWindow
      ? window.scrollY
      : (scrollTarget as HTMLElement).scrollTop;

    const readY = () =>
      isWindow ? window.scrollY : (scrollTarget as HTMLElement).scrollTop;

    const onScroll = () => {
      const y = readY();
      const delta = y - lastY;
      lastY = y;
      if (y <= 4) {
        setHidden(false);
        return;
      }
      setHidden(delta > 6);
    };

    scrollTarget.addEventListener("scroll", onScroll, { passive: true });
    return () => scrollTarget.removeEventListener("scroll", onScroll);
  }, []);

  return { containerRef, headerHidden: hidden };
}
