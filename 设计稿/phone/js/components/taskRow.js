/**
 * taskRow.js — 任务行（含滑动操作背景）。所有任务列表统一复用。
 */
import { h } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { attachSwipeActions } from "../core/gestures.js";
import { formatDue, formatSchedule, isOverdue, isoToKey, dateKey } from "../core/format.js";
import { PRIORITIES, DEFAULT_LIST_COLOR } from "../data/enums.js";
import { highlight } from "./common.js";

/**
 * @param {object} task  Task 同构对象
 * @param {object} ctx
 * @param {Map|object} ctx.lists  id -> TaskList
 * @param {Function} ctx.onOpen
 * @param {Function} ctx.onToggle
 * @param {Function} ctx.onDelete
 * @param {string} [ctx.timeGutter] 今日议程时间槽 HH:mm
 * @param {boolean}[ctx.hideList]
 * @param {string} [ctx.query]     搜索高亮
 * @param {boolean} [ctx.deleted]  回收站行（恢复/彻底删除）
 * @param {Function}[ctx.onRestore]
 * @param {Function}[ctx.onPurge]
 */
export function taskRow(task, ctx) {
  const list = ctx.lists?.get?.(task.listId) ?? ctx.lists?.[task.listId] ?? null;
  const listColor = list?.color ?? DEFAULT_LIST_COLOR;
  const done = task.status === "done";
  const pri = PRIORITIES[task.priority];

  /* 长按 450ms 唤起任务操作菜单；移动超过 10px 或松手即取消，并抑制误触 click */
  let longFired = false, lpTimer = 0, lpX = 0, lpY = 0;
  const clearLong = () => clearTimeout(lpTimer);
  const rowEl = h("div.task-row" + (done ? ".completed" : "") + ` ${pri.cls}`, {
    onclick: () => { if (longFired) { longFired = false; return; } if (!ctx.deleted) ctx.onOpen?.(task); },
    onpointerdown: (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      longFired = false; lpX = e.clientX; lpY = e.clientY;
      lpTimer = setTimeout(() => {
        longFired = true;
        navigator.vibrate?.(18);
        ctx.onMore?.(task);
      }, 450);
    },
    onpointermove: (e) => {
      if (Math.hypot(e.clientX - lpX, e.clientY - lpY) > 10) clearLong();
    },
    onpointerup: clearLong,
    onpointercancel: clearLong,
    onpointerleave: clearLong,
  }, [
    ctx.timeGutter
      ? h("span.agenda-time", { text: ctx.timeGutter })
      : null,
    h("button.check" + (done ? ".checked" : ""), {
      "aria-label": done ? "恢复任务" : "完成任务",
      onclick: (e) => { e.stopPropagation(); ctx.onToggle?.(task); },
      html: done ? icon("check") : "",
    }),
    h("div.task-main", {}, [
      h("div.task-title-line", {}, [
        task.priority > 0
          ? h("span.pri-flag" + ` ${pri.cls}`, { html: icon("flag", "i-sm"), "aria-label": `${pri.label}优先级` })
          : null,
        h("span.task-title.ellipsis-2", { html: highlight(task.title, ctx.query) }),
      ]),
      buildMeta(task, listColor, list?.name, ctx),
    ]),
    ctx.deleted
      ? h("button.icon-btn", { "aria-label": "恢复", onclick: (e) => { e.stopPropagation(); ctx.onRestore?.(task); }, html: icon("rotate-ccw") })
      : h("span.task-row-chevron", { html: icon("chevron-right", "i-sm") }),
  ]);

  const swipe = h("div.swipe", { dataset: { id: task.id } }, [
    // 滑动露出的背景动作：右侧滑露出左侧绿色「完成」，左侧滑露出右侧红色「删除」
    h("div.swipe-action.swipe-left", { html: `${icon("check")}<span>${ctx.deleted ? "恢复" : "完成"}</span>` }),
    h("div.swipe-action.swipe-right", { html: `${icon("trash-2")}<span>${ctx.deleted ? "彻底删除" : "删除"}</span>` }),
    h("div.swipe-track", {}, [rowEl]),
  ]);

  attachSwipeActions(swipe, {
    onComplete: () => (ctx.deleted ? ctx.onRestore?.(task) : ctx.onToggle?.(task)),
    onDelete: () => (ctx.deleted ? ctx.onPurge?.(task) : ctx.onDelete?.(task)),
  });
  return swipe;
}

function buildMeta(task, listColor, listName, ctx) {
  const items = [];
  if (!ctx.hideList) {
    items.push(h("span.meta-item.meta-list", {}, [
      h("span.color-dot", { style: { background: listColor } }),
      h("span", { text: listName ?? "未分类" }),
    ]));
  }
  if (!ctx.timeGutter && task.dueAt) {
    const key = isoToKey(task.dueAt);
    const today = dateKey(new Date());
    const tomorrow = dateKey(new Date(Date.now() + 86400_000));
    const cls = isOverdue(task.dueAt) && task.status !== "done" ? "overdue"
      : key === today ? "today" : key === tomorrow ? "tomorrow" : "";
    items.push(h("span.meta-item.due" + (cls ? `.${cls}` : ""), { html: `${icon("calendar-clock", "i")}<span>${formatDue(task.dueAt)}</span>` }));
  }
  if (task.scheduledDate) {
    const dueKey = isoToKey(task.dueAt);
    if (!task.dueAt || task.scheduledDate !== dueKey) {
      const label = formatSchedule(task.scheduledDate);
      items.push(h("span.meta-item", { html: `${icon("calendar-days", "i")}<span>计划 ${label}</span>` }));
    }
  }
  if (task.subtasks.length) {
    const c = task.subtasks.filter((s) => s.completed).length;
    items.push(h("span.meta-item", { html: `${icon("list-todo", "i")}<span>${c}/${task.subtasks.length}</span>` }));
  }
  if (task.attachmentCount) {
    items.push(h("span.meta-item", { html: `${icon("paperclip", "i")}<span>${task.attachmentCount}</span>` }));
  }
  for (const tag of task.tags.slice(0, 3)) {
    items.push(h("span.tag-pill", { text: `#${tag}` }));
  }
  return h("div.task-meta", {}, items);
}
