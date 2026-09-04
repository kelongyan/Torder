/**
 * commandPalette.js — 命令面板（Ctrl K，镜像 CommandPalette）
 * 输入时合并：任务命中、视图跳转、命令动作；Enter 执行第一项。
 */
import { openCommand } from "../core/modal.js";
import { searchAll, setScope } from "../core/store.js";
import { go } from "../core/router.js";
import { SYSTEM_VIEWS } from "../data/enums.js";

const COMMANDS = (ctx) => [
  { id: "new", label: "新建任务", icon: "plus", meta: "Ctrl N", run: () => ctx.openCreate?.() },
  { id: "focus", label: "打开专注模式", icon: "flame", run: () => ctx.openFocus?.() },
  { id: "mini", label: "打开迷你速记窗", icon: "sparkles", meta: "Ctrl Shift M", run: () => ctx.openMini?.() },
  { id: "review", label: "每日回顾", icon: "trending-up", run: () => ctx.openReview?.() },
  { id: "stats", label: "统计概览", icon: "bar-chart-3", run: () => ctx.openStats?.() },
  { id: "settings", label: "打开设置", icon: "settings", meta: "Ctrl ,", run: () => ctx.openSettings?.() },
  { id: "sync", label: "立即同步", icon: "refresh-cw", run: () => ctx.toastRef?.("开始同步（设计稿演示）") },
];

export function openCommandPalette(ctx) {
  const ctrl = openCommand({
    onPick(item) {
      if (item.task) ctx.openDetail?.(item.task);
      else if (item.view) { setScope({ kind: "view", view: item.view }); go(`/view/${item.view}`); }
      else item.run?.();
    },
    onQuery: (q, render) => {
      const query = q.trim().toLowerCase();
      const nodes = [];
      const tasks = query ? searchAll(query, 6) : [];
      if (tasks.length) {
        nodes.push({ group: "任务" });
        tasks.forEach((t) => nodes.push({ label: t.title, icon: "circle-dot", meta: "任务", task: t }));
      }
      const views = SYSTEM_VIEWS.filter((v) => !query || v.label.toLowerCase().includes(query));
      if (views.length) {
        nodes.push({ group: "跳转视图" });
        views.forEach((v) => nodes.push({ label: v.label, icon: v.icon, view: v.id }));
      }
      const cmds = COMMANDS(ctx).filter((c) => !query || c.label.toLowerCase().includes(query));
      if (cmds.length) {
        nodes.push({ group: "命令" });
        cmds.forEach((c) => nodes.push(c));
      }
      render(nodes.flatMap((n) =>
        n.group
          ? [{ label: n.group, header: true }]
          : [{ label: n.label, icon: n.icon, meta: n.meta, task: n.task, view: n.view, run: n.run }],
      ));
    },
  });
  return ctrl;
}
