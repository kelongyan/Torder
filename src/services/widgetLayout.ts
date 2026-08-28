/**
 * 桌面小窗尺寸常量。
 * 与 `src-tauri/src/widget.rs` 的 WIDGET_* 保持一致，改这里后同步改 Rust 端。
 *
 * 竖版便签：宽 240–480（默认 280）、高 320–560（默认 360）。
 * 尺寸有两种模式（`WidgetSizeMode`，**不单独持久化**，从 `widget` 设置键里
 * 有没有 `h` 派生出来）：
 * - "auto"：从未手动拉伸过。高度由前端实测内容自然高度决定（见 `WidgetApp` 的
 *   ResizeObserver），宽度保持当前值不动；w/h 不落盘。
 * - "manual"：用户拖过 resize 热区之后进入，尺寸完全由用户决定并落盘为 w/h，
 *   自动高度不再介入。这是**单向**的 —— 一旦用户定过尺寸就一直记住，
 *   便签上不提供「回到自适应」的入口（那会在 280px 宽的抬头里常驻一颗按钮）。
 *
 * 这里只给几何边界 —— 不手抄各子区域像素高度，这样 CSS 改动不会让窗口与
 * 实际内容错位。MIN 240×320 保证任何内容量下都是竖版矩形。
 *
 * 注意：区间上下限同时也声明在窗口自身（Rust 侧 min/max_inner_size）。
 * 拖拽过程中前端没有介入机会，必须由 OS 在拖动时夹取，这里的函数只用于
 * 程序化设置尺寸的场合。
 */

/** 尺寸模式：auto = 高度跟随内容；manual = 用户拖过热区，尺寸由 w/h 决定 */
export type WidgetSizeMode = "auto" | "manual";

export const WIDGET_DEFAULT_WIDTH = 280;
export const WIDGET_MIN_WIDTH = 240;
export const WIDGET_MAX_WIDTH = 480;
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

export function clampWidgetWidth(width: number): number {
  return Math.min(Math.max(width, WIDGET_MIN_WIDTH), WIDGET_MAX_WIDTH);
}
