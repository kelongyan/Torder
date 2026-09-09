import { useEffect, useRef, useState, type CSSProperties } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import {
  getWidgetSettings,
  patchWidgetSettings,
} from "../../services/widgetService";
import {
  defaultWidgetAppearance,
  ensureCustomNoteFont,
  fontStackFor,
  isCustomNoteFontRegistered,
  MIN_NOTE_GLASS_OPACITY,
  noteFontOptions,
  noteThemeOptions,
  registerCustomNoteFont,
  unregisterCustomNoteFont,
  type NoteThemeId,
  type WidgetAppearance,
} from "../../services/widgetAppearance";
import type { ToastKind } from "../../types/ui";
import { isMobile } from "../../utils/platform";
import { RefreshCw, Trash2, Upload } from "lucide-react";

const NOTE_THEME_DETAILS: Record<
  NoteThemeId,
  { title: string; desc: string }
> = {
  sky: { title: "海蓝纸面", desc: "经典便签 · 温暖手写" },
  glass: { title: "通透磨砂", desc: "深色亚克力 · 融入桌面" },
};

const FONT_DESCRIPTIONS: Record<string, string> = {
  handwriting: "经典便签 · 灵动手写",
  sans: "现代黑体 · 清晰利落",
  system: "系统默认 · 规范统一",
};

/** 滑杆拖动期间只更新本地状态，停顿 300ms 才落库——避免每像素一次 IPC */
const SLIDER_FLUSH_MS = 300;

/** 自定义字体导入的对话框过滤与大小上限提示（Rust 侧权威校验） */
const FONT_DIALOG_FILTERS = [
  { name: "字体文件", extensions: ["ttf", "otf", "woff", "woff2"] },
];
const FONT_ACCEPT = ".ttf,.otf,.woff,.woff2";

type SliderField = "noteGlassOpacity";

/** mock 模式的字体文件选择（Tauri 走系统对话框）。返回 null = 用户取消。 */
function pickBrowserFontFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = FONT_ACCEPT;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/**
 * 设置 → 外观 → 桌面便签个性化：纸色（海蓝 + 磨砂两卡，2026-09-09 老大定稿）+
 * 字体 + 自定义字体导入；组间 hairline 分隔，布局规约见
 * docs/appearance-layout-optimization-plan.md §3。
 *
 * 2026-09-08 收敛：字号滑杆（锁死 14px）、纸面与显示开关组、旧全局不透明度
 * 滑杆全部移除。2026-09-09 老大定稿：新增磨砂（glass）主题卡，透明度归其
 * 专属——磨砂卡右上角齿轮弹出横向滑杆（30–100%，参考图胶囊渐变轨道 +
 * 白色大圆拇指），透明度实时预览到磨砂色卡并防抖 300ms 落库。
 * 主题/字体点击立即落库；卸载时 flush 防抖尾值。
 *
 * - 纸面效果以桌面小窗本体为预览（改动经广播实时生效，
 *   不再设设置界面内的预览卡——2026-08-29 用户定稿移除）。
 * - 字体卡的字样直接用真实字体栈渲染：手写体字样会命中 Torder Note 的
 *   HTTP 缓存（widget 窗口每次启动都拉同一文件），仅外观页首次打开多一次缓存读；
 *   这是主窗唯一引用该字体的地方（AGENTS.md 的「仅 .widget-* 引用」约定以此为例外）。
 * - 色卡/字体卡用原生 radio（同 name 组自带方向键导航），选中态类名由状态驱动；
 *   磨砂卡齿轮与透明度弹层渲染在 label 外的包裹层上（真机验证 label 的
 *   激活行为不被 preventDefault 拦住，点齿轮会误选磨砂主题），结构隔离最彻底。
 * - 写入走 `patchWidgetSettings`（扁平字段），主窗 → widget 窗经
 *   `widget-settings-changed` 广播实时同步；失败回滚到最近成功值并 toast——
 *   与 `SettingsDesktopSection` 的开关同一范式。
 * - 移动端没有桌面小窗，不渲染；桌面浏览器 mock 照常可用（双模式一致性）。
 */
export function SettingsWidgetAppearanceSection({
  onToast,
}: {
  onToast: (message: string, type: ToastKind) => void;
}) {
  const [appearance, setAppearance] = useState<WidgetAppearance | null>(null);
  const [busy, setBusy] = useState(false);
  /** 自定义字体导入中（对话框 + 复制 + FontFace 注册） */
  const [importingFont, setImportingFont] = useState(false);
  /** 最近一次成功落库的外观；写失败时按字段回滚到它 */
  const persistedRef = useRef<WidgetAppearance | null>(null);
  const sliderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 防抖窗口内待落库的滑杆字段（按字段合并）；卸载 flush 时读取 */
  const pendingSliderRef = useRef<Partial<
    Pick<WidgetAppearance, SliderField>
  > | null>(null);

  useEffect(() => {
    if (isMobile()) return;
    let cancelled = false;
    void (async () => {
      const settings = await getWidgetSettings();
      if (cancelled) return;
      setAppearance(settings);
      persistedRef.current = settings;
      // 主窗此前从未注册自定义字体；字样卡要用它渲染（缓存命中，代价仅一次）
      if (settings.noteCustomFontName && !isCustomNoteFontRegistered()) {
        await ensureCustomNoteFont();
      }
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // 卸载时 flush 滑杆防抖尾值：拖完立刻点「完成」也不能静默丢最后一档。
  // patch 是字段级原子写，晚到的写入不会造成半写状态；此刻失败无从回滚
  // （组件已卸载），静默落库失败可接受——重开面板读到的是数据库真值。
  useEffect(
    () => () => {
      if (sliderTimer.current) {
        clearTimeout(sliderTimer.current);
        sliderTimer.current = null;
      }
      const pending = pendingSliderRef.current;
      pendingSliderRef.current = null;
      if (pending && Object.keys(pending).length > 0) {
        void patchWidgetSettings(pending).catch(() => undefined);
      }
    },
    [],
  );



  if (isMobile() || !appearance) return null;

  /**
   * 离散控件（色卡/字体卡/开关/恢复默认）的立即落库：失败按字段回滚到
   * fallback 并 toast。滑杆走 scheduleSliderPersist 的防抖通道，不经这里。
   */
  async function persistPatch(
    patch: Partial<WidgetAppearance>,
    fallback: Partial<WidgetAppearance>,
  ) {
    try {
      persistedRef.current = await patchWidgetSettings(patch);
    } catch (error) {
      setAppearance((current) =>
        current ? { ...current, ...fallback } : current,
      );
      onToast(`便签外观设置失败: ${String(error)}`, "error");
    }
  }

  /** 滑杆字段的防抖落库：pending 按字段合并，一次 flush 带上所有待写字段 */
  function scheduleSliderPersist(patch: Partial<WidgetAppearance>) {
    pendingSliderRef.current = { ...pendingSliderRef.current, ...patch };
    if (sliderTimer.current) clearTimeout(sliderTimer.current);
    sliderTimer.current = setTimeout(() => {
      sliderTimer.current = null;
      void flushSliderPersist();
    }, SLIDER_FLUSH_MS);
  }

  async function flushSliderPersist() {
    const pending = pendingSliderRef.current;
    if (!pending || Object.keys(pending).length === 0) return;
    pendingSliderRef.current = null;
    const fallback = persistedRef.current;
    try {
      persistedRef.current = await patchWidgetSettings(pending);
    } catch (error) {
      // 回滚到最近成功值（本地未落库的拖动值不作数）
      if (fallback) setAppearance(fallback);
      onToast(`便签外观设置失败: ${String(error)}`, "error");
    }
  }

  function handleThemeChange(theme: WidgetAppearance["noteTheme"]) {
    // 函数体内自行判空：TS 的外层早退收窄不会流入函数体
    if (!appearance || busy || theme === appearance.noteTheme) return;
    setAppearance({ ...appearance, noteTheme: theme });
    setBusy(true);
    void persistPatch(
      { noteTheme: theme },
      { noteTheme: appearance.noteTheme },
    ).finally(() => setBusy(false));
  }

  function handleFontChange(font: WidgetAppearance["noteFont"]) {
    if (!appearance || busy || font === appearance.noteFont) return;
    setAppearance({ ...appearance, noteFont: font });
    setBusy(true);
    void persistPatch(
      { noteFont: font },
      { noteFont: appearance.noteFont },
    ).finally(() => setBusy(false));
  }

  /** 恢复默认外观：重置外观字段（字号已锁死、开关组已无 UI，落库值由
   *  normalizeAppearance 归一），几何/锚点/启用开关不碰 */
  function handleResetDefaults() {
    if (!appearance || busy) return;
    const previous = appearance;
    setAppearance({ ...appearance, ...defaultWidgetAppearance });
    setBusy(true);
    void persistPatch(defaultWidgetAppearance, previous).finally(() =>
      setBusy(false),
    );
  }

  /** 磨砂透明度滑杆：本地即时预览（swatch 内联变量 + 广播实时生效），防抖落库 */
  function handleGlassOpacityChange(percent: number) {
    if (!appearance) return;
    const value = percent / 100;
    if (value === appearance.noteGlassOpacity) return;
    setAppearance({ ...appearance, noteGlassOpacity: value });
    scheduleSliderPersist({ noteGlassOpacity: value });
  }

  /**
   * 导入自定义字体：Tauri 走系统文件对话框 → Rust 校验+复制进应用数据目录
   * → 读回字节注册 FontFace；mock 走浏览器 <input type="file">（字节仅会话内
   * 有效，重载后字体栈自然回退，姓名仍持久化便于观察回退表现）。
   * 成功后自动切到 custom 并落库。
   */
  async function handleImportFont() {
    if (!appearance || importingFont) return;
    setImportingFont(true);
    try {
      let displayName: string;
      if (isTauri()) {
        const picked = await openFileDialog({
          multiple: false,
          directory: false,
          title: "选择字体文件",
          filters: FONT_DIALOG_FILTERS,
        });
        if (typeof picked !== "string" || picked.length === 0) return;
        displayName = await invoke<string>("import_note_font", {
          sourcePath: picked,
        });
        await ensureCustomNoteFont();
      } else {
        const file = await pickBrowserFontFile();
        if (!file) return;
        displayName = file.name.replace(/\.[^.]+$/, "") || "自定义字体";
        await registerCustomNoteFont(await file.arrayBuffer());
      }
      const previous = appearance;
      setAppearance({
        ...appearance,
        noteFont: "custom",
        noteCustomFontName: displayName,
      });
      await persistPatch(
        { noteFont: "custom", noteCustomFontName: displayName },
        {
          noteFont: previous.noteFont,
          noteCustomFontName: previous.noteCustomFontName,
        },
      );
    } catch (error) {
      onToast(`字体导入失败: ${String(error)}`, "error");
    } finally {
      setImportingFont(false);
    }
  }

  /** 移除自定义字体：清槽位（Tauri）+ 拉回默认字体；custom 选中态一并退出 */
  async function handleRemoveCustomFont() {
    if (!appearance || busy) return;
    const previous = appearance;
    unregisterCustomNoteFont();
    setAppearance({
      ...appearance,
      noteFont:
        previous.noteFont === "custom" ? "handwriting" : previous.noteFont,
      noteCustomFontName: null,
    });
    setBusy(true);
    try {
      if (isTauri()) {
        await invoke("remove_note_font");
      }
      await persistPatch(
        {
          noteFont:
            previous.noteFont === "custom" ? "handwriting" : previous.noteFont,
          noteCustomFontName: null,
        },
        {
          noteFont: previous.noteFont,
          noteCustomFontName: previous.noteCustomFontName,
        },
      );
    } catch (error) {
      onToast(`字体移除失败: ${String(error)}`, "error");
    } finally {
      setBusy(false);
    }
  }

  const glassOpacityPercent = Math.round(appearance.noteGlassOpacity * 100);
  // 渐变已选段比例按滑杆刻度折算（min 30 起步），与拇指位置逐像素一致
  const glassFillPercent = Math.round(
    ((glassOpacityPercent - MIN_NOTE_GLASS_OPACITY * 100) /
      (100 - MIN_NOTE_GLASS_OPACITY * 100)) *
      100,
  );

  return (
    <section className="settings-section">
      <div className="appearance-group">
        <h4 className="appearance-group-title">便签主题</h4>
        <div
          className="note-theme-grid"
          role="radiogroup"
          aria-label="便签主题"
        >
          {noteThemeOptions.map((theme) => {
            const active = appearance.noteTheme === theme.id;
            const isGlass = theme.id === "glass";
            const detail = NOTE_THEME_DETAILS[theme.id];
            return (
              <label
                key={theme.id}
                className={`note-theme-card ${active ? "is-active" : ""}`.trim()}
                data-note-theme={theme.id}
              >
                <input
                  type="radio"
                  name="note-theme"
                  value={theme.id}
                  checked={active}
                  disabled={busy}
                  onChange={() => handleThemeChange(theme.id)}
                />
                <div className="note-theme-card-preview">
                  <div
                    className="note-theme-mini-note"
                    style={
                      isGlass
                        ? ({
                            "--note-glass-alpha": String(
                              appearance.noteGlassOpacity,
                            ),
                          } as CSSProperties)
                        : undefined
                    }
                  >
                    {!isGlass && <div className="note-theme-mini-pin" />}
                    <div className="note-theme-mini-line is-title" />
                    <div className="note-theme-mini-line" />
                    <div className="note-theme-mini-line is-short" />
                    <div className="note-theme-mini-line is-check" />
                  </div>
                </div>
                <div className="note-theme-card-body">
                  <div className="note-theme-card-header">
                    <span className="note-theme-card-title">{detail.title}</span>
                    <span className="note-theme-card-radio" aria-hidden="true" />
                  </div>
                  <span className="note-theme-card-desc">{detail.desc}</span>
                </div>
              </label>
            );
          })}
        </div>

        {/* 磨砂透明度内联调节：选中通透磨砂时直接在下方呈现，不再用蹩脚的小齿轮浮层 */}
        {appearance.noteTheme === "glass" && (
          <div className="note-glass-inline-panel">
            <div className="note-glass-slider-head">
              <div className="note-glass-slider-title-wrap">
                <span className="note-glass-slider-title">磨砂透明度</span>
                <span className="note-glass-slider-hint">
                  （更通透 30% — 100% 更深邃）
                </span>
              </div>
              <span className="note-glass-slider-value">
                {glassOpacityPercent}%
              </span>
            </div>
            <div className="note-glass-slider-track-wrap">
              <input
                type="range"
                min={Math.round(MIN_NOTE_GLASS_OPACITY * 100)}
                max={100}
                step={5}
                value={glassOpacityPercent}
                aria-label="磨砂透明度"
                style={
                  {
                    "--glass-fill": `${glassFillPercent}%`,
                  } as CSSProperties
                }
                onChange={(event) =>
                  handleGlassOpacityChange(Number(event.target.value))
                }
              />
            </div>
          </div>
        )}
      </div>

      <div className="appearance-group">
        <h4 className="appearance-group-title">字体</h4>
        <div className="note-font-grid" role="radiogroup" aria-label="便签字体">
          {noteFontOptions.map((font) => {
            const active = appearance.noteFont === font.id;
            return (
              <label
                key={font.id}
                className={`note-font-card ${active ? "is-active" : ""}`.trim()}
              >
                <input
                  type="radio"
                  name="note-font"
                  value={font.id}
                  checked={active}
                  disabled={busy}
                  onChange={() => handleFontChange(font.id)}
                />
                <div className="note-font-card-header">
                  <span className="note-font-name">{font.name}</span>
                  <span className="note-font-card-radio" aria-hidden="true" />
                </div>
                <div
                  className="note-font-sample"
                  style={{ fontFamily: fontStackFor(font.id) }}
                >
                  今天的事 09:30
                </div>
                <div className="note-font-desc">
                  {FONT_DESCRIPTIONS[font.id] ?? font.name}
                </div>
              </label>
            );
          })}
          {appearance.noteCustomFontName ? (
            <label
              className={`note-font-card ${appearance.noteFont === "custom" ? "is-active" : ""}`.trim()}
              title={appearance.noteCustomFontName}
            >
              <input
                type="radio"
                name="note-font"
                value="custom"
                checked={appearance.noteFont === "custom"}
                disabled={busy}
                onChange={() => handleFontChange("custom")}
              />
              <div className="note-font-card-header">
                <span className="note-font-name">自定义字体</span>
                <div className="note-font-custom-header-right">
                  <div className="note-font-inline-actions">
                    <button
                      type="button"
                      className="note-font-action-btn"
                      disabled={busy || importingFont}
                      title="更换字体文件"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void handleImportFont();
                      }}
                    >
                      <RefreshCw
                        size={11}
                        className={importingFont ? "is-spinning" : ""}
                      />
                      <span>更换</span>
                    </button>
                    <button
                      type="button"
                      className="note-font-action-btn is-danger"
                      disabled={busy || importingFont}
                      title="移除自定义字体"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void handleRemoveCustomFont();
                      }}
                    >
                      <Trash2 size={11} />
                      <span>移除</span>
                    </button>
                  </div>
                  <span className="note-font-card-radio" aria-hidden="true" />
                </div>
              </div>
              <div
                className="note-font-sample"
                style={{ fontFamily: fontStackFor("custom") }}
              >
                今天的事 09:30
              </div>
              <div
                className="note-font-desc note-font-custom-name"
                title={appearance.noteCustomFontName}
              >
                {appearance.noteCustomFontName}
              </div>
            </label>
          ) : (
            <button
              type="button"
              className="note-font-card note-font-import"
              disabled={busy || importingFont}
              onClick={() => void handleImportFont()}
            >
              <div className="note-font-card-header">
                <span className="note-font-name">自定义字体</span>
                <Upload size={14} className="note-font-import-icon" />
              </div>
              <div className="note-font-sample is-placeholder">
                {importingFont ? "正在读取文件…" : "＋ 导入本地字体"}
              </div>
              <div className="note-font-desc">支持 TTF / OTF / WOFF2</div>
            </button>
          )}
        </div>
      </div>

      <div className="note-reset-row">
        <button
          type="button"
          className="note-reset-link"
          disabled={busy}
          onClick={handleResetDefaults}
        >
          恢复默认外观
        </button>
      </div>
    </section>
  );
}
