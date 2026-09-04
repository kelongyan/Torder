/**
 * recurringView.js — 循环任务管理（镜像 RecurringRulesView）
 */
import { h } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { getState, getList } from "../core/store.js";
import { FREQ_LABELS } from "../data/enums.js";
import { formatDue } from "../core/format.js";
import { emptyState } from "../components/common.js";
import { toast } from "../core/toast.js";

function freqText(rule) {
  const base = FREQ_LABELS[rule.frequency] ?? "重复";
  if (rule.frequency === "weekly" && rule.weekdays?.length) {
    const names = ["一", "二", "三", "四", "五", "六", "日"];
    return `每周${rule.weekdays.map((d) => "周" + names[d]).join("、")}`;
  }
  if (rule.frequency === "monthly" && rule.monthDay) return `每月 ${rule.monthDay} 日`;
  return rule.intervalCount > 1 ? `每 ${rule.intervalCount} ${base.replace("每", "")}` : base;
}

export function recurringView(route, ctx) {
  const rules = getState().recurringRules;
  const head = h("div.row.between", { style: { marginBottom: 14 } }, [
    h("div", {}, [
      h("div.fs-lg.fw-600", { text: "循环规则" }),
      h("div.fs-sm.t-muted", { text: "规则到期自动生成下一条任务实例", style: { marginTop: 2 } }),
    ]),
    h("button.btn.btn-primary.btn-sm", { onclick: () => ctx?.openRecurringEditor?.() }, [icon("plus", "i-xs"), document.createTextNode("新建规则")]),
  ]);

  if (!rules.length) return h("div", {}, [head, emptyState({ icon: "repeat-2", title: "还没有循环任务", desc: "例如「每天站会」「每月缴房租」，到期会自动生成。" })]);

  return h("div", { style: { maxWidth: 760 } }, [
    head,
    ...rules.map((rule) => {
      const list = getList(rule.listId);
      const sw = h("button.switch" + (rule.enabled ? ".on" : ""), {
        onclick: () => { rule.enabled = !rule.enabled; sw.classList.toggle("on"); toast(rule.enabled ? "规则已启用" : "规则已暂停"); },
      });
      return h("div.rule-card", {}, [
        h("div.rule-icon", { html: icon("repeat-2", "i-md") }),
        h("div.rule-main", {}, [
          h("div.rule-title.ellipsis", { text: rule.title }),
          h("div.rule-meta", {}, [
            h("span.meta-chip", {}, [icon("refresh-cw", "i-xs"), document.createTextNode(freqText(rule))]),
            h("span.meta-chip", {}, [icon("calendar-clock", "i-xs"), document.createTextNode("下次 " + (formatDue(rule.nextDueAt) ?? "—"))]),
            list ? h("span.meta-chip", {}, [h("span.list-dot", { style: { background: list.color } }), document.createTextNode(list.name)]) : null,
          ]),
        ]),
        h("button.btn.btn-sm.btn-ghost", { text: "立即生成", onclick: () => toast("已生成一条实例") }),
        sw,
      ]);
    }),
  ]);
}
