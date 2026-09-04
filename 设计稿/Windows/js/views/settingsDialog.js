/**
 * settingsDialog.js — 设置对话框（镜像 SettingsDialog 8 Tab）
 * 常规 / 外观 / 事项默认值 / 提醒与通知 / WebDAV 同步 / 数据与备份 / 快捷键 / 关于
 */
import { h } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { openDialog } from "../core/modal.js";
import { toast } from "../core/toast.js";
import { getState, patchPrefs, setTheme, setAccent, setFontSize } from "../core/store.js";
import { SETTINGS_TABS, THEMES, ACCENTS } from "../data/enums.js";

function switchRow(iconName, title, desc, key) {
  const s = getState();
  const sw = h("button.switch" + (s.prefs[key] ? ".on" : ""), {
    onclick: () => { patchPrefs({ [key]: !s.prefs[key] }); sw.classList.toggle("on"); },
  });
  return h("div.setting-row", {}, [
    h("span.setting-icon", { html: icon(iconName, "i-sm") }),
    h("div.setting-copy", {}, [h("div.setting-title", { text: title }), desc ? h("div.setting-desc", { text: desc }) : null]),
    sw,
  ]);
}

function group(title, rows) {
  return h("div.setting-group", {}, [
    h("div.setting-group-title", { text: title }),
    h("div.setting-card", {}, rows),
  ]);
}

function panes() {
  const s = getState();
  return {
    general: h("div", {}, [
      group("启动与窗口", [
        switchRow("power", "开机时自动启动", "静默启动并驻留系统托盘（--silent）", "launchAtStartup"),
        switchRow("minus", "关闭窗口时最小化到托盘", "点 × 不退出，真正退出走托盘菜单", "minimizeToTray"),
      ]),
      group("录入", [
        switchRow("sparkles", "快速添加自然语言解析", "识别「明天 3 点」「!高」「#工作」等片段", "naturalLanguage"),
        switchRow("check-check", "完成后立即归入已完成分组", "勾选后任务立刻移出当前进行中列表", "moveCompletedImmediately"),
      ]),
    ]),
    appearance: appearancePane(),
    defaults: h("div", {}, [
      group("新建任务默认值", [
        pickRow("folder", "默认清单", s.lists.find((l) => l.id === s.prefs.defaultListId)?.name ?? "工作"),
        pickRow("calendar-clock", "默认截止日期", "不设置"),
        pickRow("flag", "默认优先级", "中"),
      ]),
    ]),
    notifications: h("div", {}, [
      group("通知", [
        switchRow("bell-ring", "系统通知", "到期提醒通过 Windows 通知中心弹出", "systemNotification"),
        switchRow("volume-2", "提示音", "通知到达时播放轻提示音", "notifySound"),
        pickRow("alarm-clock", "默认提前提醒", "不提醒"),
      ]),
    ]),
    sync: syncPane(),
    data: h("div", {}, [
      group("备份与迁移", [
        actionRow("database", "立即备份", "导出加密 SQLite 到 backups/", "备份", () => toast("已写入 backups/（设计稿演示）")),
        actionRow("history", "恢复备份", "从备份文件还原，需校验完整性", "选择文件", () => toast("设计稿演示")),
        actionRow("download", "导出 JSON", "人类可读的全量数据导出", "导出", () => toast("已导出（设计稿演示）")),
        actionRow("upload", "导入 JSON", "从导出文件合并或覆盖", "导入", () => toast("设计稿演示")),
      ]),
      group("回收站", [pickRow("trash-2", "自动清理", "保留 30 天")]),
    ]),
    shortcuts: shortcutsPane(),
    about: aboutPane(),
  };
}

function appearancePane() {
  const s = getState();
  return h("div", {}, [
    group("主题", [
      h("div.setting-row", {}, [
        h("span.setting-icon", { html: icon("palette", "i-sm") }),
        h("div.setting-copy", {}, [h("div.setting-title", { text: "应用主题" })]),
        h("div.segmented", {}, THEMES.map((t) =>
          h("button" + (s.prefs.theme === t.id ? ".active" : ""), { text: t.label, onclick: () => setTheme(t.id) }))),
      ]),
    ]),
    group("强调色", [
      h("div.setting-row", {}, [
        h("span.setting-icon", { html: icon("droplet", "i-sm") }),
        h("div.setting-copy", {}, [h("div.setting-title", { text: "品牌强调色" })]),
        h("div.swatch-row", {}, ACCENTS.map((a) =>
          h("button.swatch" + (s.prefs.accent === a.id ? ".selected" : ""), {
            style: { background: a.color }, title: a.label,
            html: s.prefs.accent === a.id ? icon("check", "i-sm") : "",
            onclick: () => setAccent(a.id),
          }))),
      ]),
    ]),
    group("字号", [
      h("div.setting-row", {}, [
        h("span.setting-icon", { html: icon("type", "i-sm") }),
        h("div.setting-copy", {}, [h("div.setting-title", { text: "界面字号" })]),
        h("div.segmented", {}, [["small", "小"], ["standard", "标准"], ["large", "大"]].map(([id, label]) =>
          h("button" + (s.prefs.fontSize === id ? ".active" : ""), { text: label, onclick: () => setFontSize(id) }))),
      ]),
    ]),
  ]);
}

function syncPane() {
  const input = (label, value, type = "text") => h("div", {}, [
    h("label.field-label", { text: label }),
    h("input.input", { type, value, placeholder: label }),
  ]);
  return h("div", {}, [
    h("div.setting-card", { style: { padding: 16, marginBottom: 16 } }, [
      h("div.row.gap-3", { style: { marginBottom: 12 } }, [
        h("span.setting-icon", { html: icon("cloud", "i-md") }),
        h("div.flex1", {}, [
          h("div.setting-title", { text: "WebDAV 端到端加密同步" }),
          h("div.setting-desc", { text: "Argon2 + ChaCha20-Poly1305，服务器无法读取内容" }),
        ]),
      ]),
      h("div.col.gap-3", {}, [
        input("服务器地址", "https://dav.example.com/remote.php/dav/files/torder/"),
        h("div.form-grid", {}, [input("账号", "kelong"), input("密码", "••••••••", "password")]),
        h("div.row.gap-3", {}, [
          h("button.btn", { text: "测试连接并保存", onclick: () => toast("连接成功（设计稿演示）") }),
          h("span.fs-xs.t-muted", { text: "密码存入系统密钥库，不落盘" }),
        ]),
      ]),
    ]),
    group("同步行为", [
      switchRow("refresh-cw", "自动同步", "变更后 2 秒防抖自动上传", "autoSync"),
      actionRow("monitor-smartphone", "已授权设备", "2 台设备 · 可远程吊销", "查看", () => toast("设计稿演示")),
      actionRow("git-compare", "冲突处理", "保留双方，进入合并面板", "查看", () => toast("设计稿演示")),
    ]),
  ]);
}

function actionRow(ic, title, desc, btnText, onClick) {
  return h("div.setting-row", {}, [
    h("span.setting-icon", { html: icon(ic, "i-sm") }),
    h("div.setting-copy", {}, [h("div.setting-title", { text: title }), h("div.setting-desc", { text: desc })]),
    h("button.btn.btn-sm", { text: btnText, onclick: onClick }),
  ]);
}
function pickRow(ic, title, value) {
  return h("div.setting-row", {}, [
    h("span.setting-icon", { html: icon(ic, "i-sm") }),
    h("div.setting-copy", {}, [h("div.setting-title", { text: title })]),
    h("span.fs-sm.t-muted", { text: value }),
    h("span", { html: icon("chevron-right", "i-sm"), class: "t-muted" }),
  ]);
}

function shortcutsPane() {
  const rows = [
    ["新建任务", "Ctrl N"], ["全局快速速记", "Ctrl Shift T"], ["迷你速记窗", "Ctrl Shift M"],
    ["命令面板", "Ctrl K"], ["全库搜索", "Ctrl F"], ["折叠侧栏", "Ctrl B"],
    ["批量选择", "B"], ["切换主题", "Ctrl J"],
  ];
  return h("div", {}, [
    group("全局与视图快捷键", rows.map(([label, keys]) =>
      h("div.shortcut-row", {}, [
        h("span", { text: label }),
        h("div.shortcut-keys", {}, keys.split(" ").map((k) => h("kbd.kbd", { text: k }))),
      ]))),
  ]);
}

function aboutPane() {
  return h("div.col.gap-4", {}, [
    h("div.setting-card", { style: { padding: 20 } }, [
      h("div.row.gap-3", {}, [
        h("span.titlebar-logo", { style: { width: 44, height: 44, borderRadius: 12 }, html: icon("check", "i-lg") }),
        h("div", {}, [
          h("div.fs-lg.fw-600", { text: "Torder 今序" }),
          h("div.fs-sm.t-muted", { text: "版本 2.6.3 · Windows x64 (Tauri 2)" }),
        ]),
      ]),
    ]),
    group("存储", [
      pickRow("database", "本地数据库", "%APPDATA%/com.zhaxideler.torder/torder.sqlite"),
      pickRow("folder", "备份目录", "应用数据 / backups"),
    ]),
    group("关于", [
      actionRow("file-text", "开源许可", "字体 / 图标 / 依赖清单", "查看", () => toast("设计稿演示")),
      actionRow("external-link", "项目仓库", "github.com/kelongyan/Torder", "打开", () => toast("设计稿演示")),
    ]),
  ]);
}

export function openSettingsDialog(initialTab = "general") {
  let active = SETTINGS_TABS.some((t) => t.id === initialTab) ? initialTab : "general";
  const all = panes();
  const paneBox = h("div.settings-pane.scroll");
  const nav = h("div.settings-nav");
  function paint() {
    nav.replaceChildren(...SETTINGS_TABS.map((t) =>
      h("button" + (active === t.id ? ".active" : ""), {
        onclick: () => { active = t.id; paint(); },
      }, [icon(t.icon, "i-sm"), document.createTextNode(t.label)])));
    paneBox.replaceChildren(all[active]);
    paneBox.scrollTop = 0;
  }
  paint();
  const body = h("div.settings-shell", {}, [nav, paneBox]);
  return openDialog({ title: "设置", icon: "settings", body, width: 820 });
}
