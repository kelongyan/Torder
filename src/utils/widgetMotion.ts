/**
 * 便签动效纯函数（`docx/widget-ux-polish-plan-2026-09-08.md` W1/W2）。
 * 日期切换方向映射（W1-3）与窗口高度插值 easing（W2-1）共用，
 * 抽离纯函数以便 vitest 覆盖；不依赖 DOM。
 */

/** 日期导航方向：prev = 看过去（内容从左入），next = 看未来（内容从右入） */
export type NavDirection = "prev" | "next";

export function navDirectionFromDelta(delta: number): NavDirection {
  return delta < 0 ? "prev" : "next";
}

/**
 * 旧内容滑出的 class：prev 时旧内容向右出、next 时向左出，
 * 与新内容进入方向相反（标准轮播语义，见方案书 D-3）。
 */
export function leaveClassName(direction: NavDirection): string {
  return direction === "prev" ? "is-leaving-prev" : "is-leaving-next";
}

/** ease-out cubic：先快后慢，窗口高度插值（W2-1）与入场动画共用曲线家族 */
export function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - clamped, 3);
}
