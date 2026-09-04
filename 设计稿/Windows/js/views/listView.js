/**
 * listView.js — 列表布局（默认布局）
 *  - 今日视图：逾期卡 + 时间轴（有时刻）+ 全天 + 今日完成
 *  - 其他视图：groupTasks 分组卡片（逾期/今天/明天/以后/无日期/已完成）
 *  - 清单 scope：顶部 ProjectHeader（色卡、进度环、统计）
 *  - 回收站：恢复 / 彻底删除行
 */
import { h } from "../core/dom.js";
import { icon } from "../core/icons.js";
import {
  queryTasks, groupTasks, todayAgenda, getState, getList, createTask,
  restoreTask, purgeTask, emptyTrash, reviewStats,
} from "../core/store.js";
import { taskRow } from "../components/taskRow.js";
import { groupCard, emptyState, quickComposer, progressRing } from "../components/common.js";
import { openConfirm } from "../core/modal.js";
import { toast } from "../core/toast.js";

/* ---------------- 清单头（ProjectHeader） ---------------- */
function projectHeader(listId, ctx) {
  const s = getState();
  const list = getList(listId);
  if (!list) return null;
  const all = s.tasks.filter((t) => t.listId === listId && t.deletedAt == null);
  const done = all.filter((t) => t.status === "done").length;
  const total = all.length;
  const ratio = total ? done / total : 0;
  const overdue = all.filter((t) => t.dueAt && t.status !== "done" && new Date(t.dueAt) < new Date()).length;

  const stat = (n, label) => h("div", {}, [
    h("div.fs-lg.fw-600", { text: String(n) }),
    h("div.fs-2xs.t-muted", { text: label, style: { marginTop: 2 } }),
  ]);

  return h("div.group-card", { style: { marginBottom: 16, "--gc-accent": list.color } }, [
    h("div.row.gap-3", { style: { padding: "14px 16px" } }, [
      h("div", {
        style: {
          width: 44, height: 44, borderRadius: 12, flex: "none",
          background: list.color, display: "grid", placeItems: "center", color: "#fff",
        },
      }, [icon("list-checks", "i-lg")]),
      h("div.flex1", {}, [
        h("div.fs-lg.fw-600", { text: list.name }),
        h("div.fs-sm.t-muted", { text: `${total} 项任务 · ${list.isDefault ? "默认清单" : "自定义清单"}`, style: { marginTop: 2 } }),
      ]),
      progressRing(ratio, 48),
      h("div.row.gap-4", { style: { marginRight: 8 } }, [
        stat(total, "全部"), stat(total - done, "待办"), stat(overdue, "逾期"),
      ]),
      h("button.btn.btn-sm", { onclick: () => ctx?.openCreate?.(listId) }, [icon("plus", "i-xs"), document.createTextNode("新建")]),
    ]),
  ]);
}

/* ---------------- 今日时间轴 ---------------- */
function timelineSection(title, tasks, tone, ctx) {
  if (!tasks.length) return null;
  const doneTotal = tasks.length;
  return groupCard({
    title, count: doneTotal, tone,
    children: tasks.map((t) => {
      const time = t.dueAt ? new Date(t.dueAt).toTimeString().slice(0, 5) : "全天";
      return h("div.timeline-row", {}, [
        h("div.timeline-time", { text: time }),
        h("div.timeline-rail", {}, [h("span.timeline-dot", {
          style: { borderColor: t.priority === 2 ? "var(--red)" : t.priority === 1 ? "var(--amber)" : "var(--accent)" },
        })]),
        h("div.timeline-card.flex1", {}, [taskRow(t, { hideList: false, ctx, onOpen: (x) => ctx?.openDetail(x) })]),
      ]);
    }),
  });
}

function todayView(ctx) {
  const { overdue, timed, allday, completedToday } = todayAgenda();
  const nowHM = new Date().toTimeString().slice(0, 5);
  const nodes = [
    quickComposer("快速添加：明天 3 点 #工作 !高 交周报…", (title) => {
      const t = createTask({ title });
      toast("已创建到今日");
      ctx?.openDetail(t);
    }),
    timelineSection("已逾期", overdue, "danger", ctx),
    h("div.now-line", { text: `现在 ${nowHM}` }),
    timelineSection("时间轴", timed, "accent", ctx),
    allday.length ? groupCard({
      title: "全天", count: allday.length,
      children: allday.map((t) => taskRow(t, { ctx, onOpen: (x) => ctx?.openDetail(x) })),
    }) : null,
    completedToday.length ? groupCard({
      title: "今日已完成", count: completedToday.length, tone: "muted",
      children: completedToday.map((t) => taskRow(t, { ctx, onOpen: (x) => ctx?.openDetail(x) })),
    }) : null,
  ];
  return h("div", {}, nodes);
}

/* ---------------- 回收站 ---------------- */
function trashView(ctx) {
  const rows = queryTasks({ kind: "view", view: "deleted" }, { showCompleted: true });
  const head = h("div.row.between", { style: { marginBottom: 14 } }, [
    h("div.fs-sm.t-muted", { text: `回收站 ${rows.length} 项 · 保留 30 天后自动清除` }),
    h("button.btn.btn-sm.btn-danger", {
      onclick: async () => {
        const ok = await openConfirm({ title: "清空回收站？", body: `将永久删除 ${rows.length} 项任务，无法恢复。`, confirmText: "清空", danger: true });
        if (ok) { emptyTrash(); toast("回收站已清空"); }
      },
    }, [icon("trash-2", "i-xs"), document.createTextNode("清空回收站")]),
  ]);
  if (!rows.length) return h("div", {}, [head, emptyState({ icon: "trash-2", title: "回收站是空的", desc: "删除的任务会先在这里保留 30 天。" })]);
  return h("div", {}, [
    head,
    groupCard({
      title: "回收站", count: rows.length, tone: "muted",
      children: rows.map((t) => h("div.task-row", { dataset: { id: t.id } }, [
        h("span.row-grip", { html: icon("trash-2", "i-sm"), style: { opacity: .5 } }),
        h("div.row-main", {}, [h("div.row-title.ellipsis", { text: t.title })]),
        h("div.row-actions", { style: { opacity: 1 } }, [
          h("button.btn.btn-sm.btn-ghost", { text: "恢复", onclick: () => { restoreTask(t.id); toast("已恢复"); } }),
          h("button.btn.btn-sm", {
            class: "btn-ghost t-danger",
            text: "彻底删除",
            onclick: async () => {
              const ok = await openConfirm({ title: "彻底删除？", body: "删除后无法恢复。", confirmText: "删除", danger: true });
              if (ok) { purgeTask(t.id); toast("已彻底删除"); }
            },
          }),
        ]),
      ])),
    }),
  ]);
}

/* ---------------- 通用分组列表 ---------------- */
export function listView(route, ctx) {
  const scope = getState().ui.scope;
  if (scope.kind === "view" && scope.view === "deleted") return trashView(ctx);

  if (scope.kind === "view" && scope.view === "today") return todayView(ctx);

  const rows = queryTasks();
  const wrap = h("div");
  if (scope.kind === "list") wrap.append(projectHeader(scope.listId, ctx));
  wrap.append(quickComposer("+ 新建任务，Enter 快速创建", (title) => {
    const t = createTask(scope.kind === "list" ? { title, listId: scope.listId } : { title });
    ctx?.openDetail(t);
  }));

  if (!rows.length) {
    wrap.append(emptyState({
      icon: "list-todo",
      title: "这里还没有任务",
      desc: "在上方输入框快速创建，或点击右上角「新建」填写完整信息。",
    }));
    return wrap;
  }

  if (scope.kind === "view" && scope.view === "completed") {
    wrap.append(groupCard({
      title: "已完成", count: rows.length, tone: "muted",
      children: rows.map((t) => taskRow(t, { ctx, onOpen: (x) => ctx?.openDetail(x) })),
    }));
    return wrap;
  }

  const groups = groupTasks(rows);
  for (const g of groups) {
    wrap.append(groupCard({
      title: g.title,
      count: g.items.length,
      tone: g.tone,
      progress: g.id === "done"
        ? { done: g.items.filter((t) => t.status === "done").length, total: rows.length }
        : undefined,
      children: g.items.map((t) => taskRow(t, {
        hideList: scope.kind === "list",
        ctx,
        onOpen: (x) => ctx?.openDetail(x),
      })),
    }));
  }
  return wrap;
}
