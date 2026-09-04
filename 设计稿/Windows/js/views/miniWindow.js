/**
 * miniWindow.js — 迷你速记窗（独立 Tauri 窗 mock，镜像 MiniApp）
 * 失焦自动隐藏、置顶；输入自然语言片段，下方实时解析预览，Enter 提交。
 */
import { h } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { createTask } from "../core/store.js";
import { toast } from "../core/toast.js";

export function miniWindow(ctx) {
  const preview = h("div.mini-preview");
  const input = h("textarea.mini-input", {
    rows: 3,
    placeholder: "速记：明天 3 点 #工作 !高 交周报",
  });

  function parse(text) {
    const chips = [];
    const time = text.match(/(今天|明天|后天|\d+月\d+日)?\s*(\d{1,2})[点:：](\d{0,2})/);
    if (time) chips.push(["clock", `时间 ${time[0].trim()}`]);
    const list = text.match(/#(\S+)/);
    if (list) chips.push(["folder", `清单 ${list[1]}`]);
    const pri = text.match(/!([高中低])/);
    if (pri) chips.push(["flag", `优先级 ${pri[1]}`]);
    preview.replaceChildren(...chips.map(([ic, t]) => h("span.chip.chip-accent", {}, [icon(ic, "i-xs"), document.createTextNode(t)])));
  }
  input.addEventListener("input", () => parse(input.value));

  function submit() {
    const title = input.value.replace(/[#!]\S+/g, "").replace(/(今天|明天|后天|\d+月\d+日)?\s*\d{1,2}[点:：]\d{0,2}/g, "").trim();
    if (!title) return;
    createTask({ title, priority: /!高/.test(input.value) ? 2 : 1 });
    toast("已速记并加入任务");
    input.value = "";
    preview.replaceChildren();
  }

  return h("div.mini-stage", {}, [
    h("div.mini-window", {}, [
      h("div.mini-bar", {}, [
        icon("sparkles", "i-sm"),
        h("span", { text: "快速速记 · Enter 提交 / Shift Enter 换行" }),
        h("span.sp"),
        h("button.icon-btn", { html: icon("pin", "i-xs"), title: "置顶" }),
        h("button.icon-btn", { html: icon("x", "i-xs"), title: "失焦自动隐藏" }),
      ]),
      h("div.mini-body", {}, [
        input,
        preview,
        h("div.mini-foot", {}, [
          h("span.hint", { text: "解析遵循快速添加同一套自然语言规则" }),
          h("span.sp"),
          h("button.btn.btn-sm.btn-ghost", { text: "清空", onclick: () => { input.value = ""; preview.replaceChildren(); } }),
          h("button.btn.btn-sm.btn-primary", { text: "保存任务", onclick: submit }),
        ]),
      ]),
    ]),
    h("div.stage-caption", { text: "独立窗口 mock：迷你速记窗（Ctrl+Shift+M，置顶 · 失焦隐藏）" }),
  ]);
}
