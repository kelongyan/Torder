/**
 * 桌面小窗尺寸 / 布局常量。
 * 与 `src-tauri/src/widget.rs` 的 WIDGET_* 常量保持一致，
 * 改这里后请同步改 Rust 端。窗口高度根据任务数动态计算。
 */

export const WIDGET_WIDTH = 300;
export const WIDGET_MIN_HEIGHT = 180;
export const WIDGET_MAX_HEIGHT = 480;
export const WIDGET_DEFAULT_HEIGHT = 260;

// 子区域像素高度（基于 widget.css 当前值）
const TITLEBAR_HEIGHT = 36;
const DATEBAR_HEIGHT = 40;
const SHELL_PADDING = 16; // widget-shell inset: 8px * 2
const ITEM_HEIGHT = 36;
const EMPTY_STATE_MIN_HEIGHT = 110;
const INLINE_ADD_HEIGHT = 56;

export interface WidgetHeightInput {
  itemCount: number;
  /** 顶部加号按钮激活时显示的快速新增输入条 */
  adding: boolean;
}

export function calculateWidgetHeight({
  itemCount,
  adding,
}: WidgetHeightInput): number {
  const listHeight = Math.max(itemCount * ITEM_HEIGHT, EMPTY_STATE_MIN_HEIGHT);
  const total =
    TITLEBAR_HEIGHT +
    DATEBAR_HEIGHT +
    listHeight +
    (adding ? INLINE_ADD_HEIGHT : 0) +
    SHELL_PADDING;
  return Math.min(Math.max(total, WIDGET_MIN_HEIGHT), WIDGET_MAX_HEIGHT);
}
