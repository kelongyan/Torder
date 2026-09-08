/**
 * statsDialog.js — 统计概览（镜像 StatsDialog）
 * 顶部 3 张汇总卡 + 近 7 日完成柱状图 + 清单分布。
 */
import { h } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { openDialog } from "../core/modal.js";
import { getState } from "../core/store.js";
import { dateKey, addDaysSafe, isoToKey } from "../core/format.js";

export function openStatsDialog() {
  const s = getState();
  const live = s.tasks.filter((t) => t.deletedAt == null);
  const open = live.filter((t) => t.status !== "done").length;
  const done = live.filter((t) => t.status === "done").length;
  const high = live.filter((t) => t.status !== "done" && t.priority === 2).length;

  // 近 7 日完成数（mock 中完成时间相对今天，柱状图永远有数据）
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = addDaysSafe(new Date(), i - 6);
    const key = dateKey(d);
    const n = live.filter((t) => t.status === "done" && isoToKey(t.completedAt) === key).length;
    return { label: `${d.getMonth() + 1}/${d.getDate()}`, n };
  });
  const max = Math.max(3, ...days.map((d) => d.n));

  const card = (n, label, ic) => h("div.stats-card", {}, [
    h("div.row.gap-2", { style: { marginBottom: 6 } }, [h("span.t-muted", { html: icon(ic, "i-sm") }), h("span.fs-xs.t-muted", { text: label })]),
    h("div.num", { text: String(n) }),
  ]);

  const body = h("div", { style: { width: 580 } }, [
    h("div.stats-grid", {}, [card(open, "待办中", "circle-dot"), card(done, "累计完成", "check-circle-2"), card(high, "高优先", "flag")]),
    h("div.setting-group-title", { text: "近 7 日完成" }),
    h("div.setting-card", { style: { padding: "14px 16px 8px" } }, [
      h("div.bar-chart", {}, days.map((d) =>
        h("div.bar-col", {}, [
          h("span.fs-2xs.t-muted", { text: String(d.n) }),
          h("i", { style: { height: `${(d.n / max) * 100}%` } }),
          h("span", { text: d.label }),
        ]))),
    ]),
  ]);

  return openDialog({ title: "统计概览", icon: "bar-chart-3", body, width: 640 });
}
