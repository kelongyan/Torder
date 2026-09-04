/**
 * menus.js — 桌面浮层菜单集合：
 * 任务右键/更多菜单、排序菜单、筛选面板、视图更多菜单、清单选择器
 */
import { h } from "../core/dom.js";
import { openPopover, openContextMenu, openConfirm } from "../core/modal.js";
import { toast } from "../core/toast.js";
import { icon } from "../core/icons.js";
import {
  getState, setSort, toggleSortDir, toggleShowCompleted,
  toggleTask, softDeleteTask, restoreTask, purgeTask, updateTask, getList, toggleFilterTag,
} from "../core/store.js";
import { SORT_OPTIONS, LIST_COLORS } from "../data/enums.js";

/** 任务操作菜单：target = 元素 或 {x,y} */
export function openTaskContextMenu(target, task, ctx, afterClose) {
  const done = task.status === "done";
  const trashed = task.deletedAt != null;
  const items = trashed ? [
    { label: "恢复任务", icon: "history", onClick: () => restoreTask(task.id) },
    { label: "彻底删除", icon: "trash-2", danger: true, onClick: async () => {
      const ok = await openConfirm({ title: "彻底删除任务？", body: "将无法恢复，同步端也会删除该任务的墓碑记录。", confirmText: "彻底删除", danger: true });
      if (ok) { purgeTask(task.id); toast("已彻底删除"); }
    } },
  ] : [
    { label: done ? "标记为未完成" : "标记完成", icon: done ? "rotate-ccw" : "check", onClick: () => toggleTask(task.id) },
    { label: "编辑任务…", icon: "pencil", hint: "Enter", onClick: () => ctx?.openEditor?.(task) },
    { label: "移动到清单", icon: "folder-input", onClick: (e) => {} , keepOpen: true },
    { divider: true },
    { label: "复制标题", icon: "copy", onClick: () => { navigator.clipboard?.writeText(task.title); toast("标题已复制"); } },
    { label: "删除任务", icon: "trash-2", danger: true, onClick: () => { softDeleteTask(task.id); toast("已移入回收站"); } },
  ];

  // “移动到清单”展开二级选择（锚定当前已打开的浮层）
  const moveItem = items.find((i) => i.label === "移动到清单");
  if (moveItem) {
    moveItem.onClick = () => {
      openListPicker(document.querySelector(".popover"), task.listId, (listId) => {
        updateTask(task.id, { listId });
        toast(`已移动到「${getList(listId)?.name ?? ""}」`);
      });
    };
  }

  let ctrl;
  if (target instanceof HTMLElement) ctrl = openPopover(target, items, { align: "right", width: 200 });
  else ctrl = openContextMenu(target.x, target.y, items);
  if (afterClose) {
    const orig = ctrl.close;
    ctrl.close = function () { afterClose(); orig.call(this); };
    setTimeout(() => {
      const obs = new MutationObserver(() => { if (!ctrl.el.isConnected) { afterClose(); obs.disconnect(); } });
      obs.observe(document.body, { childList: true });
    }, 0);
  }
  return ctrl;
}

/** 排序菜单 */
export function openSortMenu(anchor) {
  const { sortBy, sortAsc } = getState().prefs;
  const items = [
    { header: "排序方式" },
    ...SORT_OPTIONS.map((o) => ({
      label: o.label, icon: o.icon, checked: sortBy === o.id,
      onClick: () => setSort(o.id),
    })),
    { divider: true },
    { label: sortAsc ? "升序（当前）" : "降序（当前）", icon: sortAsc ? "arrow-up" : "arrow-down", onClick: () => toggleSortDir() },
  ];
  return openPopover(anchor, items, { align: "right", width: 196 });
}

/** 筛选面板（优先级/完成显示），面板保持打开，可多选 */
export function openFilterMenu(anchor) {
  const body = h("div", { style: { width: "228px", padding: "4px 6px" } });
  function paint() {
    const s = getState();
    body.replaceChildren(
      h("div.menu-header", { text: "按优先级" }),
      h("div.row.gap-2", { style: { padding: "2px 4px 8px" } }, [2, 1, 0].map((p) =>
        h("button.chip" + (s.ui.filterTags.includes(`pri-${p}`) ? ".chip-accent" : ""), {
          text: p === 2 ? "高优先级" : p === 1 ? "中优先级" : "低优先级",
          onclick: () => { toggleFilterTag(`pri-${p}`); paint(); },
        }))),
      h("div.menu-header", { text: "显示" }),
      h("button.menu-row", { onclick: () => { toggleShowCompleted(); paint(); } }, [
        h("span.menu-row-icon", { html: icon("check-circle-2", "i-sm") }),
        h("span.menu-row-label", { text: "显示已完成" }),
        s.prefs.showCompleted ? h("span.menu-row-check", { html: icon("check", "i-sm") }) : null,
      ]),
    );
  }
  paint();
  return openPopover(anchor, body, { align: "right", width: 244 });
}

/** 右上“更多”视图菜单 */
export function openViewMenu(anchor, ctx) {
  const s = getState();
  return openPopover(anchor, [
    { label: s.prefs.showCompleted ? "隐藏已完成" : "显示已完成", icon: "check-circle-2", onClick: () => toggleShowCompleted() },
    { divider: true },
    { label: "统计概览", icon: "bar-chart-3", onClick: () => ctx?.openStats?.() },
    { label: "设置", icon: "settings", hint: "Ctrl ,", onClick: () => ctx?.openSettings?.() },
  ], { align: "right", width: 210 });
}

/** 清单选择器（锚定已打开的父浮层） */
export function openListPicker(anchor, currentId, onPick) {
  const lists = getState().lists;
  const items = lists.map((l) => ({
    label: l.name,
    icon: "folder",
    checked: l.id === currentId,
    onClick: () => onPick(l.id),
  }));
  return openPopover(anchor ?? document.body, items, { align: "left", width: 190 });
}
