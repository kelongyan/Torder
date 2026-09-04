/**
 * sheets.js — 业务弹层构造（排序 / 任务操作 / 清单新建编辑 / 清单选择）
 */
import { h } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { openSheet, openActionSheet, openConfirm } from "../core/sheet.js";
import { SORT_OPTIONS, LIST_COLORS, DEFAULT_LIST_COLOR } from "../data/enums.js";
import * as store from "../core/store.js";
import { toast } from "../core/toast.js";

/* ---------------- 排序 ---------------- */
export function openSortSheet(current, { onPick, onToggleDir, asc }) {
  const body = h("div", {}, [
    ...SORT_OPTIONS.map((opt) =>
      h("button.sheet-action", {
        onclick: () => { onPick(opt.id); ctrl.close(); toast(`已按${opt.label}排序`); },
      }, [
        h("span.grow", { text: opt.label }),
        current === opt.id ? icon("check", "i-sm") : "",
      ].map((x) => (typeof x === "string" ? h("span", { html: x }) : x))),
    ),
    h("div.sheet-divider"),
    h("button.sheet-action", {
      onclick: () => { onToggleDir(); ctrl.close(); },
    }, [
      h("span.grow", { text: asc ? "当前升序，切换为降序" : "当前降序，切换为升序" }),
      icon("arrow-down-up", "i-sm"),
    ]),
  ]);
  const ctrl = openSheet({ title: "排序方式", body });
}

/* ---------------- 任务行更多操作（长按/详情内） ---------------- */
export function openTaskActions(task, { onEdit, onDelete, onToggle, onMoveList }) {
  const done = task.status === "done";
  openActionSheet({
    title: task.title,
    items: [
      { label: done ? "标记为未完成" : "标记完成", icon: done ? "rotate-ccw" : "check", onSelect: onToggle },
      { label: "编辑任务", icon: "pencil", onSelect: onEdit },
      { label: "移动到清单", icon: "folder", onSelect: onMoveList },
      { label: "删除任务", icon: "trash-2", danger: true, onSelect: onDelete },
    ],
  });
}

/**
 * 列表场景统一的任务操作菜单（长按任务行）
 * @param nav 路由对象（push/back）
 */
export function openTaskActionsFor(task, nav) {
  openTaskActions(task, {
    onToggle: () => { store.toggleTask(task.id); toast(task.status === "done" ? "已恢复为进行中" : "已完成"); },
    onEdit: () => nav.push(`/task/${task.id}/edit`),
    onMoveList: () => openListPicker(task.listId, (l) => {
      store.updateTask(task.id, { listId: l.id });
      toast(`已移动到「${l.name}」`);
    }),
    onDelete: async () => {
      const ok = await openConfirm({ title: "删除任务？", body: "任务将移入回收站，可在回收站恢复。", confirmText: "删除", danger: true });
      if (ok) { store.softDeleteTask(task.id); toast("已移入回收站"); }
    },
  });
}

/** 回收站行的操作菜单（恢复 / 彻底删除） */
export function openTrashActionsFor(task) {
  openActionSheet({
    title: task.title,
    items: [
      { label: "恢复任务", icon: "rotate-ccw", onSelect: () => { store.restoreTask(task.id); toast("已恢复"); } },
      { label: "彻底删除", icon: "trash-2", danger: true, onSelect: async () => {
        const ok = await openConfirm({ title: "彻底删除？", body: "删除后无法恢复。", confirmText: "彻底删除", danger: true });
        if (ok) { store.purgeTask(task.id); toast("已彻底删除"); }
      } },
    ],
  });
}

/* ---------------- 选择清单 ---------------- */
export function openListPicker(currentId, onPick) {
  const lists = store.getState().lists;
  const body = h("div", {}, lists.map((l) =>
    h("button.sheet-action", {
      onclick: () => { onPick(l); ctrl.close(); },
    }, [
      h("span.color-dot", { style: { background: l.color ?? DEFAULT_LIST_COLOR, width: "12px", height: "12px" } }),
      h("span.grow", { text: l.name }),
      l.id === currentId ? icon("check", "i-sm") : "",
    ].map((x) => (typeof x === "string" ? h("span", { html: x }) : x))),
  ));
  const ctrl = openSheet({ title: "移动到清单", body });
}

/* ---------------- 新建 / 编辑清单 ---------------- */
export function openListEditSheet(list, onSaved) {
  let picked = list?.color ?? LIST_COLORS[0];
  const nameInput = h("input.input", {
    value: list?.name ?? "", placeholder: "清单名称，如：副业", maxlength: 20,
  });
  const grid = h("div.color-grid", { style: { marginTop: "12px" } });
  LIST_COLORS.forEach((color, i) => {
    const sw = h("button.color-swatch" + ((list?.color ?? LIST_COLORS[0]) === color ? ".selected" : ""), {
      style: { background: color, color }, "aria-label": color,
      html: ((list?.color ?? LIST_COLORS[0]) === color) ? icon("check", "i-sm") : "",
      onclick: () => {
        picked = color;
        [...grid.children].forEach((c, j) => {
          c.classList.toggle("selected", LIST_COLORS[j] === color);
          c.innerHTML = LIST_COLORS[j] === color ? icon("check", "i-sm") : "";
        });
      },
    });
    grid.append(sw);
  });

  const body = h("div", {}, [
    h("label.field-label", { text: "名称" }),
    nameInput,
    h("label.field-label", { style: { marginTop: "16px" }, text: "颜色" }),
    grid,
    h("button.btn.btn-primary.btn-block", {
      style: { marginTop: "20px" },
      text: list ? "保存修改" : "创建清单",
      onclick: () => {
        const name = nameInput.value.trim();
        if (!name) { nameInput.focus(); return; }
        if (list) store.updateList(list.id, { name, color: picked });
        else store.createList({ name, color: picked });
        ctrl.close();
        toast(list ? "清单已更新" : "清单已创建");
        onSaved?.();
      },
    }),
    list && !list.isDefault
      ? h("button.btn.btn-danger.btn-block", {
        style: { marginTop: "8px" },
        text: "删除清单",
        onclick: async () => {
          const ok = await openConfirm({
            title: "删除清单？",
            body: `清单「${list.name}」内的任务将移回默认清单，不会删除。`,
            confirmText: "删除", danger: true,
          });
          if (!ok) return;
          store.deleteList(list.id);
          ctrl.close();
          toast("清单已删除");
          onSaved?.();
        },
      })
      : null,
  ]);
  const ctrl = openSheet({ title: list ? "编辑清单" : "新建清单", body });
  setTimeout(() => nameInput.focus(), 340);
}
