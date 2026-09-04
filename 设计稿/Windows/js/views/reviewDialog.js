/**
 * reviewDialog.js — 每日回顾（镜像 ReviewDialog）
 * 今日完成大数字 + 4 统计 + 完成清单 + 明日预览。
 */
import { h } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { openDialog } from "../core/modal.js";
import { reviewStats, getList } from "../core/store.js";
import { formatDue } from "../core/format.js";
import { taskRow } from "../components/taskRow.js";

function stat(num, label) {
  return h("div.review-stat", {}, [
    h("div.rs-num", { text: String(num) }),
    h("div.rs-label", { text: label }),
  ]);
}

export function openReviewDialog(ctx) {
  const r = reviewStats();
  const body = h("div", { style: { width: 560 } }, [
    h("div.review-hero", {}, [
      h("div.fs-sm.t-muted", { text: "今天完成" }),
      h("div.big-num", { text: String(r.doneToday.length) }),
      h("div.fs-sm.t-muted", { text: "项任务，每一步都算数" }),
    ]),
    h("div.review-stat-grid", {}, [
      stat(r.overdue.length, "逾期待处理"),
      stat(r.tomorrow.length, "明日待办"),
      stat(r.createdToday.length, "今日新增"),
      stat(r.activeRules, "生效循环"),
    ]),
    r.doneToday.length ? h("div.setting-group", {}, [
      h("div.setting-group-title", { text: `今日完成 · ${r.doneToday.length}` }),
      h("div.setting-card", {}, r.doneToday.map((t) => taskRow(t, { ctx, onOpen: (x) => ctx?.openDetail(x) }))),
    ]) : null,
    r.tomorrow.length ? h("div.setting-group", {}, [
      h("div.setting-group-title", { text: `明日预览 · ${r.tomorrow.length}` }),
      h("div.setting-card", {}, r.tomorrow.map((t) => taskRow(t, { ctx, onOpen: (x) => ctx?.openDetail(x) }))),
    ]) : null,
  ]);
  const footer = h("div.dialog-footer-row", {}, [
    h("button.btn.btn-ghost", { text: "关闭" }),
    h("button.btn.btn-primary", { html: "", onclick: null }, [icon("check", "i-sm"), document.createTextNode("结束今天")]),
  ]);
  const ctrl = openDialog({ title: "每日回顾", icon: "trending-up", body, footer, width: 640 });
  footer.querySelector(".btn-primary").addEventListener("click", () => ctrl.close());
  footer.querySelector(".btn-ghost").addEventListener("click", () => ctrl.close());
  return ctrl;
}
