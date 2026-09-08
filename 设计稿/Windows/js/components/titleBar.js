/**
 * titleBar.js — 自定义窗口标题栏（decorations:false 的视觉还原）
 * 左：logo + Torder/今序；中：拖拽区；右：最小化/最大化/关闭到托盘
 */
import { h } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { toast } from "../core/toast.js";

export function renderTitleBar() {
  return h("header.window-titlebar", {}, [
    h("div.titlebar-brand", {}, [
      h("span.titlebar-logo", { html: icon("check", "i-sm") }),
      h("span.titlebar-brand-text", {}, [
        h("strong", { text: "Torder" }),
        h("span", { text: "今序 · 待办清单" }),
      ]),
    ]),
    h("div.titlebar-drag"),
    h("div.window-controls", {}, [
      h("button.window-control", { title: "最小化", html: icon("minus", "i-sm"), onclick: () => toast("设计稿：最小化到任务栏") }),
      h("button.window-control", { title: "最大化", html: icon("square", "i-xs"), onclick: () => toast("设计稿：切换最大化") }),
      h("button.window-control.close", { title: "关闭到托盘（不退出）", html: icon("x", "i-sm"), onclick: () => toast("设计稿：关闭即隐藏到系统托盘") }),
    ]),
  ]);
}
