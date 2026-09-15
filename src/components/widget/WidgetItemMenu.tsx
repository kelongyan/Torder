import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * 便签条目右键菜单（导航入口）。
 *
 * 定位不是把详情面板搬到便签上，而是**两个跳主窗的入口**：详情、循环规则。
 * 字段编辑永远只有主窗一套实现——菜单只负责把用户送过去。
 *
 * 三种「纸面自绘」而非系统原生 `Menu::popup` 的理由：
 * 1. 外观与便签纸同源（墨色/纸色/手写体），原生菜单是完全割裂的系统外观；
 * 2. 免新增 `core:menu:*` ACL 与 capabilities 改动；
 * 3. 菜单项文字跟随 `--font-note`，与便签正文同一支笔。
 *
 * ==== 坐标与钳制 ====
 * 位置由 `contextmenu` 事件的 `clientX/clientY` 给出，`position: fixed` 直接消费
 * （与事件同一坐标系，无需减 shell 偏移）。窗口最小 240×320，菜单约 148×76，
 * 放得下，但右下角仍须翻转——先量实际尺寸再定位（`useLayoutEffect`，
 * 在 paint 前完成，不闪）。文字 `nowrap` 保证测量尺寸不受落点影响。
 *
 * ==== 关闭语义 ====
 * pointerdown 捕获阶段（判定菜单外）/ Esc / 窗口失焦 / 列表滚动。
 * Esc 与失焦都走 `onClose`，由父组件统一收口，菜单自身不持有可见性状态。
 */

export type WidgetItemMenuAction = "detail" | "recurring";

/** 菜单与窗口边缘的最小间距（留一点纸边，贴边显得像被裁切） */
const EDGE_MARGIN = 4;

export function WidgetItemMenu({
  x,
  y,
  hasRecurringRule,
  onAction,
  onClose,
}: {
  /** 右键落点（client 坐标，相对便签窗口） */
  x: number;
  y: number;
  /** 有循环规则 → 「编辑循环规则…」，否则 → 「设为循环任务…」 */
  hasRecurringRule: boolean;
  onAction: (action: WidgetItemMenuAction) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  /** null = 尚未测量，此时先按落点渲染（同一帧内会被 layout effect 修正） */
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  /** -1 = 无高亮：与 Windows/macOS 上下文菜单一致，打开时不预选任何项，
      鼠标悬停或键盘 ↓↑ 才点亮（避免"刚弹出就有一项是选中态"的视觉噪音） */
  const [activeIndex, setActiveIndex] = useState(-1);

  const items: ReadonlyArray<{
    action: WidgetItemMenuAction;
    label: string;
  }> = [
    { action: "detail", label: "修改详细内容…" },
    {
      action: "recurring",
      label: hasRecurringRule ? "编辑循环规则…" : "设为循环任务…",
    },
  ];

  // 量实际尺寸后钳制：右/下越界则向左/上翻转，翻转后仍越界再夹进边距内。
  //
  // ⚠️ 必须用 offsetWidth/offsetHeight 而不是 getBoundingClientRect()：
  // 入场动画 `note-menu-in` 带 `transform: scale(0.96)`，而 getBoundingClientRect
  // 返回的是**变换后**的矩形——在动画起始帧量会得到比真实尺寸小 4% 的值
  // （132px 量成 126.7px），菜单最终越过右边界约 0.27px。offsetWidth/Height 读的是
  // 布局尺寸，不受 transform 影响。实测见方案书 §6 的边界用例。
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x;
    let top = y;
    if (left + width > vw - EDGE_MARGIN) left = x - width;
    if (top + height > vh - EDGE_MARGIN) top = y - height;
    left = Math.max(EDGE_MARGIN, Math.min(left, vw - width - EDGE_MARGIN));
    top = Math.max(EDGE_MARGIN, Math.min(top, vh - height - EDGE_MARGIN));
    setPos({ left, top });
  }, [x, y]);

  // 菜单取得焦点，键盘可达（Esc/↑↓/Enter）。聚焦容器而非首项：
  // 避免刚打开就出现"选中态"的视觉噪音，键盘按下再高亮。
  useEffect(() => {
    ref.current?.focus();
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const element = ref.current;
      if (element && event.target instanceof Node && element.contains(event.target)) {
        return;
      }
      onClose();
    };
    // 捕获阶段：抢在条目自身的 pointerdown（可能进入编辑态）之前收口
    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [onClose]);

  // 便签可滚动时滚走菜单会显得"飘在原地"，滚动即关闭
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener("scroll", close, true);
    return () => window.removeEventListener("scroll", close, true);
  }, [onClose]);

  function activate(action: WidgetItemMenuAction) {
    onAction(action);
  }

  return (
    <div
      ref={ref}
      className="widget-menu"
      role="menu"
      aria-label="条目操作"
      tabIndex={-1}
      // .widget-stage 是 "deep" 拖拽区：菜单容器（非 BUTTON 的留白）必须显式排除，
      // 否则在菜单内按下会变成拖窗口而不是点菜单项。
      data-tauri-drag-region="false"
      style={{
        left: pos?.left ?? x,
        top: pos?.top ?? y,
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        } else if (event.key === "ArrowDown") {
          event.preventDefault();
          setActiveIndex((index) => (index + 1) % items.length);
        } else if (event.key === "ArrowUp") {
          // 从"无高亮"(-1) 向上应落到最后一项，而非倒数第二项
          event.preventDefault();
          setActiveIndex((index) =>
            index <= 0 ? items.length - 1 : index - 1,
          );
        } else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          // 无高亮时不误触发首项：必须先↑↓选一项
          const item = items[activeIndex];
          if (item) activate(item.action);
        }
      }}
    >
      {items.map((item, index) => (
        <button
          key={item.action}
          type="button"
          role="menuitem"
          className={`widget-menu-item ${index === activeIndex ? "is-active" : ""}`.trim()}
          onMouseEnter={() => setActiveIndex(index)}
          onClick={() => activate(item.action)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
