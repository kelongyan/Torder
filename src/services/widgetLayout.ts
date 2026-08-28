/**
 * 桌面小窗尺寸常量。
 * 与 `src-tauri/src/widget.rs` 的 WIDGET_* 保持一致，改这里后同步改 Rust 端。
 *
 * 竖版便签：宽固定 280，高度由前端实测内容自然高度决定（见 `WidgetApp` 的
 * ResizeObserver），这里只给几何边界 —— 不再手抄各子区域像素高度，
 * 这样 CSS 改动不会让窗口与实际内容错位。
 * MIN 320 保证任何内容量下都是竖版矩形（280×320 起）。
 */

export const WIDGET_WIDTH = 280;
export const WIDGET_MIN_HEIGHT = 320;
export const WIDGET_MAX_HEIGHT = 560;
export const WIDGET_DEFAULT_HEIGHT = 360;

/** 内容自然高度 → 窗口高度（竖版下限 + 上限封顶）。 */
export function clampWidgetHeight(naturalHeight: number): number {
  return Math.min(
    Math.max(naturalHeight, WIDGET_MIN_HEIGHT),
    WIDGET_MAX_HEIGHT,
  );
}

/** 超出上限才让任务列表内部滚动。 */
export function widgetListNeedsScroll(naturalHeight: number): boolean {
  return naturalHeight > WIDGET_MAX_HEIGHT;
}
