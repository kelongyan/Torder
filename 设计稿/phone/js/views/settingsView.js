/**
 * settingsView.js — 「我的」主 Tab：设置中心 + 工具入口
 * 仅保留移动端有意义的设置项；桌面专属（开机自启/迷你窗/快捷键/便签外观）不出现。
 */
import { h } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { appbar } from "../components/chrome.js";
import { screenShell } from "../components/common.js";
import { openSheet, openActionSheet } from "../core/sheet.js";
import { openListPicker } from "../components/sheets.js";
import { toast } from "../core/toast.js";
import * as store from "../core/store.js";
import { THEMES, ACCENTS, DEFAULT_DUE_OPTIONS } from "../data/enums.js";

export function renderSettings(_p, _q, ctx) {
  const s = store.getState();
  const bar = appbar({ title: "我的" });

  const hero = h("div.settings-hero", {}, [
    h("div.settings-avatar", { text: "T" }),
    h("div.grow", {}, [
      h("h2", { text: "Torder 今序" }),
      h("p", { text: "本地优先 · WebDAV 多端同步" }),
    ]),
    h("button.icon-btn", { html: icon("info"), "aria-label": "关于", onclick: () => aboutSheet() }),
  ]);

  const syncBanner = h("div.sync-banner", {}, [
    h("div.sync-pulse", { html: icon("cloud", "i-lg") }),
    h("div.grow", {}, [
      h("strong.fs-sm", { text: "WebDAV 同步未配置", style: { display: "block" } }),
      h("span.fs-xs.t-muted", { text: "配置后任务与附件自动加密同步" }),
    ]),
    h("button.btn.btn-ghost", { text: "配置", onclick: () => syncSheet() }),
  ]);

  /* 外观 */
  const appearance = h("div.group", {}, [
    h("div.group-title", { text: "外观" }),
    menuRow("palette", "主题", THEMES.find((t) => t.id === s.prefs.theme)?.label ?? "深色", () => themeSheet()),
    menuRow("sparkles", "强调色", ACCENTS.find((a) => a.id === s.prefs.accent)?.label ?? "", () => accentSheet()),
    menuRow("type", "字号", "标准", () => fontSizeSheet()),
  ]);

  /* 任务默认 */
  const defaults = h("div.group", {}, [
    h("div.group-title", { text: "任务默认" }),
    menuRow("folder", "默认清单", s.lists.find((l) => l.id === s.prefs.defaultListId)?.name ?? "", () =>
      openListPicker(s.prefs.defaultListId, (l) => { s.prefs.defaultListId = l.id; rerender(); toast(`默认清单：${l.name}`); })),
    menuRow("calendar-days", "新建任务默认截止", "不设置", () =>
      openActionSheet({
        title: "默认截止",
        items: DEFAULT_DUE_OPTIONS.map((o) => ({ label: o.label, onSelect: () => toast(`默认截止：${o.label}`) })),
      })),
    switchRow("check-square", "完成后立即归入已完成", true),
  ]);

  /* 通知 */
  const notify = h("div.group", {}, [
    h("div.group-title", { text: "提醒与通知" }),
    switchRow("bell", "任务提醒", true),
    menuRow("volume-2", "提示音", "系统默认", () =>
      openActionSheet({ title: "提示音", items: [{ label: "系统默认", onSelect: () => toast("已切换") }, { label: "静音", onSelect: () => toast("已静音") }] })),
    switchRow("calendar-check", "每日回顾提醒 · 21:00", false),
    switchRow("flame", "专注时段免打扰", false),
  ]);

  /* 数据 */
  const data = h("div.group", {}, [
    h("div.group-title", { text: "数据与同步" }),
    menuRow("cloud", "WebDAV 同步", "未配置", () => syncSheet()),
    menuRow("hard-drive", "备份与恢复", "", () => toast("真机在此选择本地备份目录")),
    menuRow("download", "导入数据", "", () => toast("设计稿演示：真机调起文件选择器")),
    menuRow("upload", "导出数据", "", () => toast("设计稿演示：导出 JSON / 压缩包")),
  ]);

  /* 工具 */
  const tools = h("div.group", {}, [
    h("div.group-title", { text: "工具" }),
    menuRow("flame", "专注模式", "", () => ctx.nav.push("/focus")),
    menuRow("trending-up", "每日回顾", "", () => ctx.nav.push("/review")),
    menuRow("repeat-2", "循环任务", String(s.recurringRules.filter((r) => r.enabled).length), () => ctx.nav.push("/recurring")),
    menuRow("bar-chart-placeholder", "统计", "", () => statsSheet()),
  ]);

  /* 关于 */
  const about = h("div.group", {}, [
    h("div.group-title", { text: "关于" }),
    menuRow("smartphone", "版本", "2.6.3 (Android)", null, true),
    menuRow("rotate-ccw", "重置演示数据", "", () => { store.resetDemo(); toast("已恢复初始演示数据"); }, false, true),
  ]);

  function rerender() {
    // 设置项变更后重绘当前屏（保留滚动位置）
    ctx.rerender();
  }

  return screenShell({
    bar,
    body: [hero, syncBanner, appearance, defaults, notify, data, tools, about,
      h("p.t-muted.fs-xs", { style: { textAlign: "center", padding: "8px 0 4px", lineHeight: 1.8 },
        text: "Torder 今序 · 移动端 UI 设计稿\n纯静态演示，数据仅保存在本页内存" })],
  });
}

/* ---------------- 行构造 ---------------- */
function menuRow(iconName, label, value, onClick, noChevron = false, danger = false) {
  return h("button.menu-row" + (danger ? ".danger" : ""), { onclick: onClick }, [
    h("span.menu-icon", { html: icon(iconName === "bar-chart-placeholder" ? "trending-up" : iconName, "i-sm") }),
    h("span.menu-label", { text: label }),
    value ? h("span.menu-value", { text: value }) : null,
    noChevron ? null : icon("chevron-right", "i-sm"),
  ]);
}
function switchRow(iconName, label, initial) {
  const sw = h("button.switch" + (initial ? ".on" : ""), { "aria-label": label });
  const row = h("div.menu-row", { onclick: () => { const on = sw.classList.toggle("on"); navigator.vibrate?.(8); } }, [
    h("span.menu-icon", { html: icon(iconName, "i-sm") }),
    h("span.menu-label", { text: label }),
    sw,
  ]);
  return row;
}

/* ---------------- 弹层 ---------------- */
function themeSheet() {
  const s = store.getState();
  const grid = h("div.theme-grid", {}, THEMES.map((t) =>
    h("button.theme-card" + (s.prefs.theme === t.id ? ".active" : ""), {
      onclick: () => { store.setTheme(t.id); ctrl.close(); },
    }, [
      h("div.theme-preview", { class: t.preview }, [
        h("i", { style: { background: "var(--accent)" } }),
        h("i", { style: { background: "var(--text-3)" } }),
        h("i", { style: { background: "var(--green)" } }),
      ]),
      h("span", { text: t.label }),
    ]),
  ));
  const ctrl = openSheet({ title: "主题", body: grid });
}

function accentSheet() {
  const s = store.getState();
  const grid = h("div.accent-grid", { style: { padding: "4px 0 8px" } }, ACCENTS.map((a) =>
    h("button.accent-dot" + (s.prefs.accent === a.id ? ".selected" : ""), {
      style: { background: a.color }, "aria-label": a.label,
      html: s.prefs.accent === a.id ? icon("check", "i-sm") : "",
      onclick: () => { store.setAccent(a.id); ctrl.close(); toast(`强调色：${a.label}`); },
    }),
  ));
  const ctrl = openSheet({ title: "强调色", body: grid });
}

function fontSizeSheet() {
  openActionSheet({
    title: "字号",
    items: ["small", "standard", "large"].map((id) => ({
      label: { small: "偏小", standard: "标准", large: "偏大" }[id],
      onSelect: () => {
        if (id === "standard") delete document.documentElement.dataset.fontSize;
        else document.documentElement.dataset.fontSize = id;
        toast("字号已调整");
      },
    })),
  });
}

function syncSheet() {
  const body = h("div", {}, [
    h("p.t-secondary.fs-sm", { style: { lineHeight: 1.7, marginBottom: "16px" }, text: "数据经 Argon2 + ChaCha20-Poly1305 端到端加密后上传到你的 WebDAV，服务器无法读取内容。" }),
    h("label.field-label", { text: "服务器地址" }),
    h("input.input", { placeholder: "https://dav.example.com/torder/", style: { marginBottom: "12px" } }),
    h("label.field-label", { text: "账号" }),
    h("input.input", { placeholder: "username", style: { marginBottom: "12px" } }),
    h("label.field-label", { text: "密码（存入系统密钥库）" }),
    h("input.input", { type: "password", placeholder: "••••••••", style: { marginBottom: "20px" } }),
    h("button.btn.btn-primary.btn-block", { text: "测试连接并保存", onclick: () => { ctrl.close(); toast("设计稿演示：真机在此发起连接测试"); } }),
  ]);
  const ctrl = openSheet({ title: "WebDAV 同步", body });
}

function statsSheet() {
  const s = store.getState();
  const total = s.tasks.filter((t) => t.deletedAt == null).length;
  const done = s.tasks.filter((t) => t.status === "done").length;
  const body = h("div.review-stat-grid", { style: { marginBottom: "8px" } }, [
    h("div.stat-tile", {}, [h("strong", { text: String(total) }), h("span", { text: "全部任务" })]),
    h("div.stat-tile", {}, [h("strong", { text: String(done) }), h("span", { text: "累计完成" })]),
    h("div.stat-tile", {}, [h("strong", { text: String(s.lists.length) }), h("span", { text: "清单" })]),
    h("div.stat-tile", {}, [h("strong", { text: String(s.recurringRules.length) }), h("span", { text: "循环规则" })]),
  ]);
  const ctrl = openSheet({ title: "统计概览", body });
}

function aboutSheet() {
  const body = h("div", { style: { textAlign: "center", padding: "8px 0" } }, [
    h("div.settings-avatar", { style: { margin: "0 auto 12px", width: "64px", height: "64px", fontSize: "26px", borderRadius: "20px" }, text: "T" }),
    h("strong.fs-md", { text: "Torder 今序", style: { display: "block" } }),
    h("span.t-muted.fs-xs", { text: "版本 2.6.3 · 移动端 UI 设计稿" }),
    h("p.t-secondary.fs-sm", { style: { lineHeight: 1.7, marginTop: "12px" }, text: "本地优先的待办应用：SQLite 本地存储、循环任务、日历视图、WebDAV 端到端加密同步。" }),
  ]);
  openSheet({ title: "关于", body });
}
