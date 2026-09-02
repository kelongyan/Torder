/**
 * F2 · T-10：快捷键速查表（只读展示数据源）。
 *
 * 注意：这里的每一行都必须与 `hooks/useKeyboardShortcuts.ts` 实际注册的
 * 按键一一对应——只列真实存在的键位，未实现的不上表（方案书定稿：
 * 不得公示按了没反应的快捷键）。新增/调整快捷键时两处同步修改。
 * Ctrl K（命令面板）由 CommandPalette 在 useKeyboardShortcuts 中注册。
 */
export interface ShortcutEntry {
  label: string;
  keys: string;
}

export interface ShortcutGroup {
  title: string;
  entries: ShortcutEntry[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "全局",
    entries: [
      { label: "命令面板", keys: "Ctrl K" },
      { label: "快速新建（速记）", keys: "Ctrl Shift T" },
      { label: "折叠 / 展开侧栏", keys: "Ctrl B" },
      { label: "聚焦搜索", keys: "Ctrl F" },
    ],
  },
  {
    title: "事项",
    entries: [{ label: "新建事项", keys: "Ctrl N" }],
  },
  {
    title: "视图",
    entries: [
      { label: "批量模式", keys: "B" },
      { label: "快捷键速查", keys: "?" },
      { label: "逐层关闭弹层", keys: "Esc" },
    ],
  },
];
