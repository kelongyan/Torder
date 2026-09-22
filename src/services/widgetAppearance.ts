import { invoke, isTauri } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";

/**
 * 便签外观（个性化）领域：类型、归一化守卫、DOM 应用、启动缓存与跨窗口广播。
 *
 * 存储与广播分工（见 docs/widget-personalization-plan.md §3.1/§3.5）：
 * - 权威数据在 `widget` 设置键（widgetService.ts 经 `patch_widget_settings` 原子合并）；
 * - 本模块负责把归一化后的外观字段应用到 `document.documentElement`
 *   （`data-note-theme` 属性 + `--note-opacity` / `--font-note` 变量），
 *   widget 窗口与设置界面的预览卡片共用同一套 CSS token 选择器；
 * - 每次成功 patch 都写通 localStorage 启动缓存（两窗口共享）并广播
 *   `widget-settings-changed`，widget 窗口幂等重放外观字段。
 *   缓存只读于首帧前（main.tsx），用于消灭「默认纸色闪一帧」，不作数据源。
 */

export const noteThemeIds = ["sky", "glass"] as const;
export type NoteThemeId = (typeof noteThemeIds)[number];

/** 主题展示名（设置界面色卡）。顺序即 UI 呈现顺序；id 须与 widget.css 主题块一一对应。
 *  2026-09-08 老大定稿：纸色只保留海蓝（sky）并作为默认，其余配色与「跟随应用」
 *  全部移除；normalizeAppearance 会把旧存档里的历史主题值归一到 sky。
 *  2026-09-09 老大定稿：新增磨砂（glass）主题——DWM Acrylic 模糊 + 海蓝纸色
 *  alpha 化，透明度为该主题专属（色卡右上角齿轮设置，见 noteGlassOpacity）。 */
export const noteThemeOptions: ReadonlyArray<{
  id: NoteThemeId;
  name: string;
}> = [
  { id: "sky", name: "海蓝" },
  { id: "glass", name: "磨砂" },
];

export const noteFontIds = ["handwriting", "sans", "system"] as const;
/** 内置预设字体（固定三项）。 */
export type NoteFontPresetId = (typeof noteFontIds)[number];

/**
 * 便签字体标识。
 *
 * 从「固定枚举」放宽为「预设 ∪ 任意系统字体家族名」：用户可在下拉里选电脑上
 * 装的任何字体（`list_system_fonts` 枚举出的家族名，如「微软雅黑」）。系统字体
 * 直接作 CSS `font-family` 值使用——浏览器能解析系统字体，**不需要**读字体字节。
 *
 * 历史 `custom`（用户导入字体文件）已于 2026-09-22 移除；旧值在
 * `normalizeAppearance` 里回退到 `handwriting`（见那里的注释）。
 */
export type NoteFontId = NoteFontPresetId | (string & {});

/** 字体展示名（设置界面的预设分组）。id 须与 fontStackFor 的分支一一对应。 */
export const noteFontOptions: ReadonlyArray<{
  id: NoteFontPresetId;
  name: string;
}> = [
  { id: "handwriting", name: "手写体" },
  { id: "sans", name: "无衬线" },
  { id: "system", name: "系统字体" },
];

/** 磨砂透明度区间（UI 用百分数 30–100 展示）。下限 30% 给 Release 白合成坑留安全边际。 */
export const MIN_NOTE_GLASS_OPACITY = 0.3;

/** 磨砂透明度默认值。同一数值同时驱动 Acrylic tint alpha 与 CSS 纸面 alpha，
 *  有效覆盖率 = 1-(1-α)²（双层叠加），0.5 → 75% 模糊覆盖：磨砂感与可读性的
 *  平衡点；0.65 时实际近乎实色（88%），是首版「看不出变化」的诱因之一。 */
export const DEFAULT_NOTE_GLASS_OPACITY = 0.5;

/** 便签外观字段的扁平集合；`widget` 设置键在此基础上再带几何/锚点字段。 */
export interface WidgetAppearance {
  noteTheme: NoteThemeId;
  /** 纸面不透明度（旧全局滑杆）。2026-09-09 起透明度归磨砂主题专属，
   *  滑杆 UI 已移除，字段保留但归一恒为 1（历史存档值一并失效）。 */
  noteOpacity: number;
  /** 磨砂主题专属透明度（0.3–1，UI 百分数展示）。仅 noteTheme === "glass"
   *  时生效：驱动 Rust set_widget_glass 的 Acrylic tint alpha 与 CSS
   *  --note-glass-alpha（纸面渐变 alpha 化）。 */
  noteGlassOpacity: number;
  noteFont: NoteFontId;
  noteFontSize: number;
  /** 纸面白点纹理 */
  noteTexture: boolean;
  /** 条目间行格线 */
  noteRules: boolean;
  /** 顶部图钉 */
  notePin: boolean;
  /** 清单色点 */
  noteDots: boolean;
  /** 隐藏已完成条目（行为字段：列表派生过滤，非样式） */
  noteHideDone: boolean;
  /** 双击条目就地编辑标题（行为字段：交互开关，防误触可在设置关闭） */
  noteDblEdit: boolean;
}

/** 默认外观（= 经典黄）。经 normalizeAppearance 生成，与守卫共用同一份默认值来源。 */
export const defaultWidgetAppearance: WidgetAppearance =
  normalizeAppearance(undefined);

export function isNoteThemeId(value: unknown): value is NoteThemeId {
  return (
    typeof value === "string" &&
    (noteThemeIds as readonly string[]).includes(value)
  );
}

/** 是否为内置预设字体 id（非预设值一律按「系统字体家族名」处理）。 */
export function isNoteFontPresetId(value: unknown): value is NoteFontPresetId {
  return (
    typeof value === "string" &&
    (noteFontIds as readonly string[]).includes(value)
  );
}

/**
 * 字体字段守卫。
 *
 * 从「白名单枚举」放宽为「非空字符串即合法」：字体名来自系统枚举，无法预先穷举。
 * 保留约束两点——必须是字符串、必须非空（空串会让 `font-family: ""` 整条 CSS
 * 失效，比回退默认更糟）。长度上限防脏数据把 CSS 变量撑爆。
 */
export function isNoteFontId(value: unknown): value is NoteFontId {
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= 256
  );
}

function clampNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/**
 * 非法值一律回默认（与 settingsService 的守卫风格一致）。null/undefined/坏对象
 * 都返回默认外观——即海蓝纸，保证旧存档与损坏缓存天然兼容。
 *
 * 2026-09-08 老大定稿收敛：
 * - 纸色只保留 sky，历史存档里的任何主题值（classic/sakura/auto…）都归一到 sky；
 * - 字号设置面已移除，noteFontSize 锁死 14px（存档中的历史值一并忽略）；
 * - 纸面细节开关（纹理/格线/图钉/色点）的设置面已移除，字段与归一逻辑保留，
 *   历史存档值继续生效（无 UI 可再修改）。
 * 2026-09-09 老大定稿：新增磨砂主题（glass），透明度归其专属——
 * noteOpacity 锁死 1（旧全局滑杆移除），noteGlassOpacity 接管透明度语义。
 */
export function normalizeAppearance(parsed: unknown): WidgetAppearance {
  const raw = (
    typeof parsed === "object" && parsed !== null ? parsed : {}
  ) as Partial<WidgetAppearance>;
  return {
    noteTheme: isNoteThemeId(raw.noteTheme) ? raw.noteTheme : "sky",
    noteOpacity: 1,
    noteGlassOpacity: clampNumber(
      raw.noteGlassOpacity,
      MIN_NOTE_GLASS_OPACITY,
      1,
      DEFAULT_NOTE_GLASS_OPACITY,
    ),
    noteFont: parseNoteFont(raw.noteFont),
    noteFontSize: 14,
    noteTexture: typeof raw.noteTexture === "boolean" ? raw.noteTexture : true,
    noteRules: typeof raw.noteRules === "boolean" ? raw.noteRules : true,
    notePin: typeof raw.notePin === "boolean" ? raw.notePin : true,
    noteDots: typeof raw.noteDots === "boolean" ? raw.noteDots : true,
    noteHideDone:
      typeof raw.noteHideDone === "boolean" ? raw.noteHideDone : false,
    noteDblEdit:
      typeof raw.noteDblEdit === "boolean" ? raw.noteDblEdit : true,
  };
}

/**
 * 外观字段 → CSS font-family 栈。默认值须与 widget.css 的 `--font-note` 一致。
 *
 * 预设走固定分支；其余值（系统字体家族名）按字面家族名使用并追加 UI 字体兜底——
 * 用户可能选了某个装在不同机器上不一定存在的字体，兜底保证不会掉到浏览器默认
 * serif（那会让便签排版崩掉）。
 */
export function fontStackFor(font: NoteFontId): string {
  switch (font) {
    case "handwriting":
      return `"Torder Note", var(--font-ui)`;
    case "sans":
      return `var(--font-ui)`;
    case "system":
      return `"Source Han Sans SC", "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", sans-serif`;
    default:
      // 系统字体家族名：必须引号包裹（家族名常含空格/中文，裸写会被当作
      // 多个标识符），内部引号与反斜杠按 CSS 字符串规则转义。
      return `"${escapeCssFontFamily(font)}", var(--font-ui)`;
  }
}

/**
 * 解析持久化的 `noteFont` 值。
 *
 * `custom`（用户导入字体）已于 2026-09-22 移除，但老用户的设置里可能还留着它：
 * 直接透传会让便签落到 `"custom"` 这个不存在的家族名上（视觉上退回 var(--font-ui)，
 * 设置面板还会显示一个点不到的选项）。这里显式回退到 `handwriting`——
 * 那是该功能引入前的默认值，也是移除后最接近的语义。
 */
function parseNoteFont(value: unknown): NoteFontId {
  if (value === "custom") return "handwriting";
  return isNoteFontId(value) ? value : "handwriting";
}

/** CSS 字符串内的转义：反斜杠与引号需转义，换行类字符直接剔除。 */
function escapeCssFontFamily(name: string): string {
  return name
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\r\n]/g, "");
}

/**
 * 把外观应用到当前窗口的 documentElement。幂等：重复调用结果一致，
 * 因此广播接收方（widget 收到自己几何写入触发的广播）无需按来源排除。
 * 字号经 `--note-fs` 基准 token 缩放整套便签字号（widget.css 派生比值）；
 * 纸面细节开关以 `.note-no-*` 类表达（CSS 定义见 widget.css 末尾）；
 * `noteHideDone` 是行为过滤不是样式，由 WidgetApp 的条目派生消费（不在此处理）。
 *
 * 磨砂玻璃（2026-09-09）：仅 widget 窗口上下文调用本函数（WidgetApp +
 * main.tsx 缓存重放），故在此内聚 invoke `set_widget_glass`——切到 glass
 * 开 Acrylic（tint alpha = noteGlassOpacity），切走即清除；非 Tauri（mock）
 * 只落 CSS alpha，玻璃退化为半透明无模糊。非 Windows 平台 Rust 侧 no-op。
 */
export function applyWidgetAppearance(appearance: WidgetAppearance): void {
  const root = document.documentElement;
  root.dataset.noteTheme = appearance.noteTheme;
  root.style.setProperty("--note-opacity", String(appearance.noteOpacity));
  root.style.setProperty(
    "--note-glass-alpha",
    String(appearance.noteGlassOpacity),
  );
  root.style.setProperty("--note-fs", `${appearance.noteFontSize}px`);
  root.style.setProperty("--font-note", fontStackFor(appearance.noteFont));
  root.classList.toggle("note-no-texture", !appearance.noteTexture);
  root.classList.toggle("note-no-rules", !appearance.noteRules);
  root.classList.toggle("note-no-pin", !appearance.notePin);
  root.classList.toggle("note-no-dots", !appearance.noteDots);
  if (isTauri()) {
    void invoke("set_widget_glass", {
      enabled: appearance.noteTheme === "glass",
      alpha: appearance.noteGlassOpacity,
    }).catch(() => undefined);
  }
}

/**
 * 枚举系统已安装字体家族名，供便签字体下拉选择。
 *
 * 家族名直接作为 CSS `font-family` 值使用，**不需要**读字体字节
 * （浏览器自己解析系统字体）。
 *
 * 浏览器 mock 没有系统字体枚举能力，返回空表让 UI 退化为「只有预设」，
 * 与 mock 环境其它能力缺失时的处理一致。
 */
export async function listSystemFonts(): Promise<string[]> {
  if (!isTauri()) return [];
  try {
    return await invoke<string[]>("list_system_fonts");
  } catch {
    return [];
  }
}

const APPEARANCE_CACHE_KEY = "torder.widget-appearance";
export const WIDGET_SETTINGS_EVENT = "widget-settings-changed";

/** 启动缓存写入（localStorage 两窗口共享，只作首帧提示，不作数据源）。 */
function writeAppearanceCache(appearance: WidgetAppearance): void {
  try {
    window.localStorage.setItem(
      APPEARANCE_CACHE_KEY,
      JSON.stringify(appearance),
    );
  } catch {
    // 隐私模式等 localStorage 不可用：仅失去首帧防闪，不影响功能
  }
}

/**
 * 首帧前的同步外观应用（main.tsx 在 createRoot 之前调用，仅 widget 入口）。
 * 权威设置随后仍由 WidgetApp 异步读取并覆盖。
 */
export function applyWidgetAppearanceFromCache(): void {
  try {
    const raw = window.localStorage.getItem(APPEARANCE_CACHE_KEY);
    if (!raw) return;
    applyWidgetAppearance(normalizeAppearance(JSON.parse(raw)));
  } catch {
    // 缓存损坏即保持默认（:root token 即经典黄）
  }
}

/**
 * patch 成功后的统一发布点：写通启动缓存 + 广播。
 * - Tauri：`emit` 广播所有窗口（含发送者自身；接收方幂等应用，无需排除来源）。
 * - mock：BroadcastChannel 跨标签页送达 /#widget 预览页。
 */
export function publishWidgetSettings(appearance: WidgetAppearance): void {
  writeAppearanceCache(normalizeAppearance(appearance));
  if (isTauri()) {
    void emit(WIDGET_SETTINGS_EVENT, appearance).catch(() => undefined);
    return;
  }
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(WIDGET_SETTINGS_EVENT);
  channel.postMessage(appearance);
  channel.close();
}

/**
 * 监听外观广播。Tauri 的 listen 是异步注册，这里把注册未完成时的清理
 * 兜住（与 WidgetApp 现有 unlisteners 范式一致）；mock 走 BroadcastChannel。
 * 返回同步清理函数。
 */
export function listenWidgetSettings(
  handler: (appearance: WidgetAppearance) => void,
): () => void {
  if (isTauri()) {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listen<WidgetAppearance>(WIDGET_SETTINGS_EVENT, (event) => {
      handler(event.payload);
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }
  if (typeof BroadcastChannel === "undefined") return () => undefined;
  const channel = new BroadcastChannel(WIDGET_SETTINGS_EVENT);
  channel.onmessage = (event) => handler(event.data as WidgetAppearance);
  return () => channel.close();
}

/* === 应用主题广播 ===
   theme.ts 的 applyThemePreference 每次应用暗/亮时广播 { dark }；widget 窗口
   监听后更新自身 data-theme。原「跟随应用」纸色（auto）已随主题收敛移除，
   广播链保留：data-theme 仍影响 widget 窗口内的壳层样式，成本为零。 */

export const APP_THEME_EVENT = "app-theme-changed";

export function broadcastAppTheme(dark: boolean): void {
  if (isTauri()) {
    void emit(APP_THEME_EVENT, { dark }).catch(() => undefined);
    return;
  }
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(APP_THEME_EVENT);
  channel.postMessage({ dark });
  channel.close();
}

export function listenAppTheme(handler: (dark: boolean) => void): () => void {
  if (isTauri()) {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listen<{ dark: boolean }>(APP_THEME_EVENT, (event) => {
      handler(event.payload.dark);
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }
  if (typeof BroadcastChannel === "undefined") return () => undefined;
  const channel = new BroadcastChannel(APP_THEME_EVENT);
  channel.onmessage = (event) => handler(Boolean(event.data?.dark));
  return () => channel.close();
}

/** 应用主题的 localStorage 启动缓存：auto 主题在 widget 首帧前解析暗/亮用。 */
const APP_THEME_CACHE_KEY = "torder.app-theme-cache";

export function cacheAppTheme(dark: boolean): void {
  try {
    window.localStorage.setItem(APP_THEME_CACHE_KEY, dark ? "1" : "0");
  } catch {
    // 仅失去 auto 主题的首帧精度，不影响功能
  }
}

/** widget 入口首帧前读取（main.tsx）；返回 dark 或 null（无缓存）。 */
export function readCachedAppTheme(): boolean | null {
  try {
    const raw = window.localStorage.getItem(APP_THEME_CACHE_KEY);
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch {
    // 读不到就保持 light 默认
  }
  return null;
}
