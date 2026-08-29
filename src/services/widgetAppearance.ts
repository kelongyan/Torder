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

export const noteThemeIds = [
  "classic",
  "cloud",
  "kraft",
  "mint",
  "sakura",
  "sky",
  "lilac",
  "slate",
  "night",
  "auto",
] as const;
export type NoteThemeId = (typeof noteThemeIds)[number];

/** 主题展示名（设置界面色卡）。顺序即 UI 呈现顺序；id 须与 widget.css 主题块一一对应。
 *  `auto`（跟随应用主题）不在 widget.css 里——applyWidgetAppearance 会把它解析成
 *  classic/night 再落属性。 */
export const noteThemeOptions: ReadonlyArray<{
  id: NoteThemeId;
  name: string;
}> = [
  { id: "classic", name: "经典黄" },
  { id: "cloud", name: "云白" },
  { id: "kraft", name: "牛皮纸" },
  { id: "mint", name: "薄荷" },
  { id: "sakura", name: "樱粉" },
  { id: "sky", name: "海蓝" },
  { id: "lilac", name: "薰衣草" },
  { id: "slate", name: "石板灰" },
  { id: "night", name: "夜墨" },
  { id: "auto", name: "跟随应用" },
];

export const noteFontIds = ["handwriting", "sans", "system", "custom"] as const;
export type NoteFontId = (typeof noteFontIds)[number];

/** 字体展示名（设置界面字体卡）。id 须与 fontStackFor 的分支一一对应。
 *  `custom` 不进选项列表——由设置界面按「是否已导入字体文件」渲染第四张卡。 */
export const noteFontOptions: ReadonlyArray<{
  id: NoteFontId;
  name: string;
}> = [
  { id: "handwriting", name: "手写体" },
  { id: "sans", name: "无衬线" },
  { id: "system", name: "系统字体" },
];

/** 自定义字体的固定 FontFace 家族名（字节经 IPC 注册，家族名跨启动稳定）。 */
export const CUSTOM_NOTE_FONT_FAMILY = "Torder Note Custom";

/** 透明度区间（UI 用百分数 30–100 展示）。下限 30% 给 Release 白合成坑留安全边际。 */
export const MIN_NOTE_OPACITY = 0.3;
export const MIN_NOTE_FONT_SIZE = 12;
export const MAX_NOTE_FONT_SIZE = 17;

/** 便签外观字段的扁平集合；`widget` 设置键在此基础上再带几何/锚点字段。 */
export interface WidgetAppearance {
  noteTheme: NoteThemeId;
  noteOpacity: number;
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
  /** 隐藏已完成条目（唯一影响行为的字段） */
  noteHideDone: boolean;
  /** 已导入自定义字体的显示名（源文件名去扩展名）；null = 未导入 */
  noteCustomFontName: string | null;
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

export function isNoteFontId(value: unknown): value is NoteFontId {
  return (
    typeof value === "string" &&
    (noteFontIds as readonly string[]).includes(value)
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
 * 都返回默认外观——即经典黄，保证旧存档与损坏缓存天然兼容。
 */
export function normalizeAppearance(parsed: unknown): WidgetAppearance {
  const raw = (
    typeof parsed === "object" && parsed !== null ? parsed : {}
  ) as Partial<WidgetAppearance>;
  return {
    noteTheme: isNoteThemeId(raw.noteTheme) ? raw.noteTheme : "classic",
    noteOpacity: clampNumber(raw.noteOpacity, MIN_NOTE_OPACITY, 1, 1),
    noteFont: isNoteFontId(raw.noteFont) ? raw.noteFont : "handwriting",
    noteFontSize: clampNumber(
      raw.noteFontSize,
      MIN_NOTE_FONT_SIZE,
      MAX_NOTE_FONT_SIZE,
      14,
    ),
    noteTexture: typeof raw.noteTexture === "boolean" ? raw.noteTexture : true,
    noteRules: typeof raw.noteRules === "boolean" ? raw.noteRules : true,
    notePin: typeof raw.notePin === "boolean" ? raw.notePin : true,
    noteDots: typeof raw.noteDots === "boolean" ? raw.noteDots : true,
    noteHideDone:
      typeof raw.noteHideDone === "boolean" ? raw.noteHideDone : false,
    noteCustomFontName:
      typeof raw.noteCustomFontName === "string" &&
      raw.noteCustomFontName.trim()
        ? raw.noteCustomFontName.trim()
        : null,
  };
}

/** 外观字段 → CSS font-family 栈。默认值须与 widget.css 的 `--font-note` 一致。 */
export function fontStackFor(font: NoteFontId): string {
  switch (font) {
    case "handwriting":
      return `"Torder Note", var(--font-ui)`;
    case "sans":
      return `var(--font-ui)`;
    case "system":
      return `"Source Han Sans SC", "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", sans-serif`;
    case "custom":
      return `"${CUSTOM_NOTE_FONT_FAMILY}", var(--font-ui)`;
  }
}

/**
 * 把外观应用到当前窗口的 documentElement。幂等：重复调用结果一致，
 * 因此广播接收方（widget 收到自己几何写入触发的广播）无需按来源排除。
 * 字号经 `--note-fs` 基准 token 缩放整套便签字号（widget.css 派生比值）；
 * 纸面细节开关以 `.note-no-*` 类表达（CSS 定义见 widget.css 末尾）；
 * `noteHideDone` 是行为过滤不是样式，由 WidgetApp 的条目派生消费（不在此处理）。
 *
 * `noteTheme: "auto"` 在这里解析成 classic/night：依据是本窗口 html 的
 * `data-theme`（applyThemePreference 维护），调用方须先设好它再调本函数。
 */
export function applyWidgetAppearance(appearance: WidgetAppearance): void {
  const root = document.documentElement;
  const dark = root.dataset.theme === "dark";
  root.dataset.noteTheme =
    appearance.noteTheme === "auto"
      ? dark
        ? "night"
        : "classic"
      : appearance.noteTheme;
  root.style.setProperty("--note-opacity", String(appearance.noteOpacity));
  root.style.setProperty("--note-fs", `${appearance.noteFontSize}px`);
  root.style.setProperty("--font-note", fontStackFor(appearance.noteFont));
  root.classList.toggle("note-no-texture", !appearance.noteTexture);
  root.classList.toggle("note-no-rules", !appearance.noteRules);
  root.classList.toggle("note-no-pin", !appearance.notePin);
  root.classList.toggle("note-no-dots", !appearance.noteDots);
}

/* === 自定义字体（FontFace 动态注册） ===
   字体文件由 Rust `import_note_font` 复制进应用数据目录 fonts/ 槽位；
   两个窗口都按需经 `read_note_font_bytes` 拿字节后注册同一个家族名。
   用字节注册而非 asset 协议 URL：免开 assetProtocol/ACL 配置面。
   注册是「替换式」的：同会话更换字体文件时旧 face 先删再加，否则新字节不生效。 */

let registeredCustomFace: FontFace | null = null;

/** 注册（或替换）自定义字体。注册后使用 `CUSTOM_NOTE_FONT_FAMILY` 的文本自动重排。 */
export async function registerCustomNoteFont(
  bytes: ArrayBuffer,
): Promise<void> {
  const face = new FontFace(CUSTOM_NOTE_FONT_FAMILY, bytes);
  await face.load();
  if (registeredCustomFace) {
    document.fonts.delete(registeredCustomFace);
  }
  document.fonts.add(face);
  registeredCustomFace = face;
}

export function isCustomNoteFontRegistered(): boolean {
  return registeredCustomFace !== null;
}

/** 注销自定义字体（移除字体文件时调用，避免会话内残留旧 face）。 */
export function unregisterCustomNoteFont(): void {
  if (registeredCustomFace) {
    document.fonts.delete(registeredCustomFace);
    registeredCustomFace = null;
  }
}

/**
 * 确保 noteFont === "custom" 时字体已注册（Tauri：IPC 取字节；mock：无字节源，
 * 保持未注册 → 字体栈回退 var(--font-ui) 渲染，不报错）。
 * 返回是否最终处于已注册状态。
 */
export async function ensureCustomNoteFont(): Promise<boolean> {
  if (registeredCustomFace) return true;
  if (!isTauri()) return false;
  try {
    const buffer = await invoke<ArrayBuffer>("read_note_font_bytes");
    if (!buffer || buffer.byteLength === 0) return false;
    await registerCustomNoteFont(buffer);
    return true;
  } catch {
    return false;
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

/* === 应用主题广播（便签「跟随应用」主题的数据源） ===
   theme.ts 的 applyThemePreference 每次应用暗/亮时广播 { dark }；
   widget 窗口监听后更新自身 data-theme 并在 noteTheme === "auto" 时重解析纸色。
   mock 用同名 BroadcastChannel 跨标签页送达。 */

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
