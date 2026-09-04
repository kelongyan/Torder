/**
 * mobile/parts/MobileTaskRow.tsx — 移动端任务行（M-C，手势语义按 D3 定稿）
 *
 * 手势（对齐设计稿 gestures.js）：
 *  - 右滑（dx ≥ 64）→ 完成 / 恢复        （露出左侧动作语义）
 *  - 左滑（dx ≤ -64）→ 删除（移入回收站）
 *  - 主轴方向锁定，不劫持纵向滚动；拖动中抑制 click 防误进详情
 *  - 长按（>480ms）→ 更多操作（ActionSheet）
 * 回收站（deleted）行：不做滑动，行内提供「恢复 / 彻底删除」。
 * 桌面行组件 TaskRow 不受影响（本组件仅移动端列表使用）。
 */
import {
  useEffect,
  useRef,
  type CSSProperties,
  type JSX,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Check,
  MoreHorizontal,
  Paperclip,
  RotateCcw,
  Trash2,
} from "lucide-react";
import type { Task } from "../../types/database";
import { formatDueLabel } from "./taskEdits";

const SWIPE_FIRE = 64;
const SWIPE_MAX = 96;
const LONG_PRESS_MS = 480;

const PRIORITY_COLOR: Record<number, string> = {
  2: "var(--red)",
  1: "var(--amber)",
  0: "var(--p-blue)",
};

export function MobileTaskRow({
  task,
  listColor,
  timeGutter,
  attachmentCount = 0,
  deleted = false,
  onOpen,
  onToggle,
  onDelete,
  onRestore,
  onPermanentDelete,
  onMore,
}: {
  task: Task;
  listColor?: string;
  timeGutter?: string;
  attachmentCount?: number;
  deleted?: boolean;
  onOpen: (task: Task) => void;
  onToggle: (task: Task) => void;
  onDelete: (task: Task) => void;
  onRestore?: (task: Task) => void;
  onPermanentDelete?: (task: Task) => void;
  onMore?: (task: Task) => void;
}): JSX.Element {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const done = task.status === "done";
  const overdue = task.dueAt ? formatDueLabel(task.dueAt) : null;
  const accent = listColor ?? "var(--accent)";

  // 手势回调最新引用：事件只绑一次，render 期不写 ref（由 effect 同步）
  const handlersRef = useRef({ onOpen, onToggle, onDelete, task });
  const deletedRef = useRef(false);
  useEffect(() => {
    handlersRef.current = { onOpen, onToggle, onDelete, task };
  });
  useEffect(() => {
    deletedRef.current = deleted;
  }, [deleted]);

  const pressTimer = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const pressStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const el = rowRef.current;
    if (!el || deletedRef.current) return;

    let startX = 0;
    let startY = 0;
    let lock: "h" | "v" | null = null;
    let dragging = false;
    let offset = 0;

    const setOffset = (x: number, animate = false) => {
      el.style.transition = animate
        ? "transform 180ms var(--ease-standard)"
        : "none";
      el.style.transform = x ? `translateX(${x}px)` : "";
    };

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      offset = 0;
      lock = null;
      dragging = false;
    };
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (!lock) {
        if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) lock = "h";
        else if (Math.abs(dy) > 8) lock = "v";
      }
      if (lock !== "h") return;
      dragging = true;
      // 方向无对应动作时不跟手：右滑需 onToggle(完成)，左滑需 onDelete
      if ((dx < 0 && !deletedRef.current) || (dx > 0 && !deletedRef.current)) {
        // deleted 行不走滑动；正常行双向都允许（完成/删除）
      }
      const clamped = Math.max(-SWIPE_MAX, Math.min(SWIPE_MAX, dx));
      offset = clamped;
      setOffset(clamped);
    };
    const end = () => {
      if (!dragging) return;
      const { onToggle, onDelete } = handlersRef.current;
      if (offset <= -SWIPE_FIRE) {
        navigator.vibrate?.(12);
        suppressClickRef.current = true;
        onDelete(task);
      } else if (offset >= SWIPE_FIRE) {
        navigator.vibrate?.(12);
        suppressClickRef.current = true;
        onToggle(task);
      }
      setOffset(0, true);
      dragging = false;
      lock = null;
      offset = 0;
    };
    const cancel = () => {
      if (dragging) setOffset(0, true);
      dragging = false;
      lock = null;
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", cancel);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", cancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 长按：Pointer 事件兼容触屏/预览鼠标；位移超限取消；触发后抑制本次 click
  const clearPress = () => {
    if (pressTimer.current != null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };
  const onPointerDown = (e: ReactPointerEvent) => {
    if (deleted) return;
    pressStartRef.current = { x: e.clientX, y: e.clientY };
    clearPress();
    pressTimer.current = window.setTimeout(() => {
      suppressClickRef.current = true;
      navigator.vibrate?.(16);
      onMore?.(task);
    }, LONG_PRESS_MS);
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const start = pressStartRef.current;
    if (!start || pressTimer.current == null) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) clearPress();
  };
  const onPointerUp = () => {
    clearPress();
    pressStartRef.current = null;
  };
  const onRowClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onOpen(task);
  };

  const priBarStyle = {
    "--pri": PRIORITY_COLOR[task.priority] ?? "var(--text-3)",
  } as CSSProperties;

  return (
    <div
      ref={rowRef}
      className={`m-mrow ${done ? "done" : ""} ${deleted ? "deleted" : ""}`}
      style={priBarStyle}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={clearPress}
      onClick={onRowClick}
    >
      {timeGutter ? <span className="m-mrow-time">{timeGutter}</span> : null}
      {!deleted && (
        <button
          type="button"
          className={`m-mrow-check ${done ? "checked" : ""}`}
          aria-label={done ? "恢复任务" : "完成任务"}
          onClick={(e) => {
            e.stopPropagation();
            navigator.vibrate?.(8);
            onToggle(task);
          }}
        >
          {done ? <Check aria-hidden="true" /> : null}
        </button>
      )}
      {deleted ? (
        <RotateCcw aria-hidden="true" className="m-mrow-del-icon" />
      ) : null}

      <div className="m-mrow-main">
        <span className="m-mrow-title">{task.title}</span>
        <span className="m-mrow-meta">
          <span
            className="m-mrow-dot"
            style={{ background: done ? "var(--text-3)" : accent }}
          />
          {overdue ? (
            <span className={overdue.danger ? "m-mrow-overdue" : ""}>
              {overdue.text}
            </span>
          ) : (
            <span>无日期</span>
          )}
          {task.tags.length > 0 && <span>#{task.tags[0]}</span>}
          {task.subtasks.length > 0 && (
            <span>
              {task.subtasks.filter((s) => s.completed).length}/
              {task.subtasks.length}
            </span>
          )}
        </span>
      </div>

      {attachmentCount > 0 && (
        <span className="m-mrow-att" aria-label={`${attachmentCount} 个附件`}>
          <Paperclip aria-hidden="true" />
          {attachmentCount}
        </span>
      )}

      {deleted ? (
        <div className="m-mrow-deleted-actions">
          <button
            type="button"
            className="m-mrow-del-btn ok"
            onClick={(e) => {
              e.stopPropagation();
              onRestore?.(task);
            }}
          >
            恢复
          </button>
          <button
            type="button"
            className="m-mrow-del-btn bad"
            onClick={(e) => {
              e.stopPropagation();
              onPermanentDelete?.(task);
            }}
          >
            <Trash2 aria-hidden="true" />
          </button>
        </div>
      ) : (
        onMore && (
          <button
            type="button"
            className="m-mrow-more"
            aria-label="更多操作"
            onClick={(e) => {
              e.stopPropagation();
              navigator.vibrate?.(8);
              onMore(task);
            }}
          >
            <MoreHorizontal aria-hidden="true" />
          </button>
        )
      )}
    </div>
  );
}
