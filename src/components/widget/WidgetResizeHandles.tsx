import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@tauri-apps/api/core";

/**
 * 与 Tauri `startResizeDragging` 的入参一致。
 * `ResizeDirection` 在 @tauri-apps/api 2.11 里没有导出（只在 .d.ts 内部声明），
 * 所以这里本地复刻同一个联合类型。
 */
type ResizeDirection =
  | "North"
  | "South"
  | "East"
  | "West"
  | "NorthEast"
  | "NorthWest"
  | "SouthEast"
  | "SouthWest";

const HANDLES: { key: string; direction: ResizeDirection }[] = [
  { key: "n", direction: "North" },
  { key: "s", direction: "South" },
  { key: "w", direction: "West" },
  { key: "e", direction: "East" },
  { key: "nw", direction: "NorthWest" },
  { key: "ne", direction: "NorthEast" },
  { key: "sw", direction: "SouthWest" },
  { key: "se", direction: "SouthEast" },
];

/**
 * 便签八向拉伸热区。
 *
 * 为什么是「盖在纸上的透明覆盖层」而不是窗口外圈留白：widget.css 顶部的约束
 * 要求纸面覆盖窗口每一个像素（Windows Release 下透明像素可能被合成成白色），
 * 所以不能靠窗口比纸大一圈来腾出 resize 边框。
 *
 * 每个热区都必须带 `data-tauri-drag-region="false"`：`.widget-stage` 是 "deep"
 * 拖拽区，否则按下热区会变成「拖动窗口」而不是「调整大小」。
 *
 * 这里刻意不挂 `title`：便签常驻桌面，鼠标靠近它就会扫过边缘，
 * 原生 tooltip 会频繁弹出来干扰。唯一的视觉提示是 hover 时的淡色边缘 + 方向光标。
 */
export function WidgetResizeHandles({
  onResizeStart,
}: {
  /** 用户开始拉伸：父组件据此把尺寸模式切到 manual 并开始记忆尺寸 */
  onResizeStart: () => void;
}) {
  function handlePointerDown(
    event: React.PointerEvent<HTMLDivElement>,
    direction: ResizeDirection,
  ) {
    if (event.button !== 0) return;
    event.preventDefault();
    if (!isTauri()) return;
    onResizeStart();
    void getCurrentWindow()
      .startResizeDragging(direction)
      .catch(() => undefined);
  }

  return (
    <>
      {HANDLES.map((handle) => (
        <div
          key={handle.key}
          className={`widget-resize-handle widget-resize-${handle.key}`}
          data-tauri-drag-region="false"
          aria-hidden="true"
          onPointerDown={(event) => handlePointerDown(event, handle.direction)}
        />
      ))}
    </>
  );
}
