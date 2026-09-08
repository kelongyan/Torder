/**
 * gestures.js — 触摸手势
 * attachSwipeActions: 任务行左滑露出「完成」、右滑露出「删除」（对齐桌面 M2.1 语义，
 * 桌面端拖拽排序在移动端不做，改为长按 Action Sheet）。
 */

const ACTION_WIDTH = 80;   // 与 task.css .swipe-action 宽度一致
const FIRE_THRESHOLD = 64; // 越过该距离松手即触发
const MAX_OFFSET = 96;

/**
 * @param {HTMLElement} swipeEl .swipe 容器（内含 .swipe-track）
 * @param {{onComplete?:Function, onDelete?:Function}} handlers
 */
export function attachSwipeActions(swipeEl, { onComplete, onDelete } = {}) {
  const track = swipeEl.querySelector(".swipe-track");
  let startX = 0, startY = 0, dx = 0, lock = null, dragging = false;

  function setOffset(x, animate = false) {
    track.style.transition = animate ? "transform var(--dur-fast) var(--ease-standard)" : "none";
    track.style.transform = x ? `translateX(${x}px)` : "";
  }

  swipeEl.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    startX = t.clientX; startY = t.clientY; dx = 0; lock = null; dragging = false;
    swipeEl.classList.add("is-dragging");
  }, { passive: true });

  swipeEl.addEventListener("touchmove", (e) => {
    const t = e.touches[0];
    const rawX = t.clientX - startX;
    const rawY = t.clientY - startY;
    if (!lock) {
      // 以主轴锁定手势方向，避免与纵向滚动冲突
      if (Math.abs(rawX) > 8 && Math.abs(rawX) > Math.abs(rawY)) lock = "h";
      else if (Math.abs(rawY) > 8) lock = "v";
    }
    if (lock !== "h") return;
    dragging = true;
    // 左滑(dx<0) → 删除在右侧；右滑(dx>0) → 完成在左侧
    if ((rawX < 0 && !onDelete) || (rawX > 0 && !onComplete)) { dx = 0; setOffset(0); return; }
    dx = Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, rawX));
    setOffset(dx);
  }, { passive: true });

  function end() {
    swipeEl.classList.remove("is-dragging");
    if (!dragging) return;
    if (dx <= -FIRE_THRESHOLD && onDelete) {
      setOffset(-ACTION_WIDTH, true);
      navigator.vibrate?.(12);
      setTimeout(() => { onDelete(); setOffset(0, true); }, 140);
    } else if (dx >= FIRE_THRESHOLD && onComplete) {
      setOffset(ACTION_WIDTH, true);
      navigator.vibrate?.(12);
      setTimeout(() => { onComplete(); setOffset(0, true); }, 140);
    } else {
      setOffset(0, true);
    }
    dx = 0; dragging = false; lock = null;
  }
  swipeEl.addEventListener("touchend", end);
  swipeEl.addEventListener("touchcancel", end);

  // 桌面预览：鼠标拖拽同样可体验
  let mouseDown = false;
  swipeEl.addEventListener("mousedown", (e) => {
    mouseDown = true; startX = e.clientX; startY = e.clientY; dx = 0; dragging = false;
    swipeEl.classList.add("is-dragging");
  });
  window.addEventListener("mousemove", (e) => {
    if (!mouseDown) return;
    const rawX = e.clientX - startX;
    if (Math.abs(rawX) > 4) dragging = true;
    if ((rawX < 0 && !onDelete) || (rawX > 0 && !onComplete)) return;
    dx = Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, rawX));
    setOffset(dx);
  });
  window.addEventListener("mouseup", () => {
    if (!mouseDown) return;
    mouseDown = false;
    end();
  });
  // 拖拽中抑制 click，避免松手误打开详情
  swipeEl.addEventListener("click", (e) => {
    if (dragging || Math.abs(dx) > 4) { e.stopPropagation(); e.preventDefault(); dx = 0; }
  }, true);
}
