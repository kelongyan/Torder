import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { Moon, Sun } from "lucide-react";
import {
  getWidgetSettings,
  patchWidgetSettings,
} from "../../services/widgetService";
import {
  defaultWidgetAppearance,
  ensureCustomNoteFont,
  fontStackFor,
  isCustomNoteFontRegistered,
  MIN_NOTE_OPACITY,
  noteFontOptions,
  noteThemeOptions,
  registerCustomNoteFont,
  unregisterCustomNoteFont,
  type WidgetAppearance,
} from "../../services/widgetAppearance";
import type { ToastKind } from "../../types/ui";
import { isMobile } from "../../utils/platform";

/** 滑杆拖动期间只更新本地状态，停顿 300ms 才落库——避免每像素一次 IPC */
const SLIDER_FLUSH_MS = 300;
/** 字号滑杆区间（px），与 MIN/MAX_NOTE_FONT_SIZE 一致 */
const FONT_SIZE_MIN = 12;
const FONT_SIZE_MAX = 17;
/** 自定义字体导入的对话框过滤与大小上限提示（Rust 侧权威校验） */
const FONT_DIALOG_FILTERS = [
  { name: "字体文件", extensions: ["ttf", "otf", "woff", "woff2"] },
];
const FONT_ACCEPT = ".ttf,.otf,.woff,.woff2";

type SliderField = "noteOpacity" | "noteFontSize";

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
 * 设置 → 外观 → 桌面便签个性化：三个组（纸色+不透明度 / 字体+字号 /
 * 纸面与显示）+ 沉底「恢复默认外观」；组间 hairline 分隔，布局规约见
 * docs/appearance-layout-optimization-plan.md §3。
 *
 * - 色卡固定五列（10 个选项恰好 5×2）；纸面效果以桌面小窗本体为预览（改动经广播实时生效，
 *   不再设设置界面内的预览卡——2026-08-29 用户定稿移除）。
 * - 字体卡的字样直接用真实字体栈渲染：手写体字样会命中 Torder Note 的
 *   HTTP 缓存（widget 窗口每次启动都拉同一文件），仅外观页首次打开多一次缓存读；
 *   这是主窗唯一引用该字体的地方（AGENTS.md 的「仅 .widget-* 引用」约定以此为例外）。
 * - 色卡/字体卡用原生 radio（同 name 组自带方向键导航），选中态类名由状态驱动。
 * - 写入走 `patchWidgetSettings`（扁平字段），主窗 → widget 窗经
 *   `widget-settings-changed` 广播实时同步；失败回滚到最近成功值并 toast——
 *   与 `SettingsDesktopSection` 的开关同一范式。主题/字体点击立即落库；
 *   两个滑杆本地即时、防抖 300ms 合并落库（pending 按字段合并，拖完 A 马上拖 B
 *   不会丢 A 的尾值），卸载时 flush。
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

  /** 纸面细节/显示开关：布尔字段通用处理 */
  function handleToggleChange<
    K extends
      "noteTexture" | "noteRules" | "notePin" | "noteDots" | "noteHideDone",
  >(field: K, value: WidgetAppearance[K]) {
    if (!appearance) return;
    const fallback = appearance[field];
    setAppearance({ ...appearance, [field]: value });
    void persistPatch({ [field]: value }, { [field]: fallback });
  }

  /** 恢复默认外观：只重置九个外观字段，几何/锚点/启用开关不碰 */
  function handleResetDefaults() {
    if (!appearance || busy) return;
    const previous = appearance;
    setAppearance({ ...appearance, ...defaultWidgetAppearance });
    setBusy(true);
    void persistPatch(defaultWidgetAppearance, previous).finally(() =>
      setBusy(false),
    );
  }

  function handleOpacityChange(percent: number) {
    if (!appearance) return;
    const value = percent / 100;
    if (value === appearance.noteOpacity) return;
    setAppearance({ ...appearance, noteOpacity: value });
    scheduleSliderPersist({ noteOpacity: value });
  }

  function handleFontSizeChange(value: number) {
    if (!appearance) return;
    if (value === appearance.noteFontSize) return;
    setAppearance({ ...appearance, noteFontSize: value });
    scheduleSliderPersist({ noteFontSize: value });
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

  const opacityPercent = Math.round(appearance.noteOpacity * 100);

  return (
    <section className="settings-section">
      <div className="appearance-group">
        <h4 className="appearance-group-title">纸色</h4>
        <div
          className="note-theme-grid"
          role="radiogroup"
          aria-label="便签纸色"
        >
          {noteThemeOptions.map((theme) => {
            const active = appearance.noteTheme === theme.id;
            return (
              <label
                key={theme.id}
                className={`note-theme-swatch ${active ? "is-active" : ""}`.trim()}
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
                {theme.id === "auto" ? (
                  <span className="note-theme-swatch-paper is-auto">
                    <Sun aria-hidden="true" />
                    <Moon aria-hidden="true" />
                  </span>
                ) : (
                  <span className="note-theme-swatch-paper">
                    <span className="note-theme-swatch-line is-title" />
                    <span className="note-theme-swatch-line" />
                    <span className="note-theme-swatch-line is-short" />
                    <span className="note-theme-swatch-line is-check" />
                  </span>
                )}
                <span className="note-theme-swatch-name">{theme.name}</span>
              </label>
            );
          })}
        </div>
        <div className="note-slider-row">
          <span>不透明度</span>
          <input
            type="range"
            min={Math.round(MIN_NOTE_OPACITY * 100)}
            max={100}
            step={5}
            value={opacityPercent}
            aria-label="便签不透明度"
            onChange={(event) =>
              handleOpacityChange(Number(event.target.value))
            }
          />
          <span className="note-slider-value">{opacityPercent}%</span>
        </div>
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
                <span
                  className="note-font-sample"
                  style={{ fontFamily: fontStackFor(font.id) }}
                >
                  今天的事 09:30
                </span>
                <span className="note-font-name">{font.name}</span>
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
              <span
                className="note-font-sample"
                style={{ fontFamily: fontStackFor("custom") }}
              >
                今天的事 09:30
              </span>
              <span className="note-font-name">
                {appearance.noteCustomFontName}
              </span>
            </label>
          ) : (
            <button
              type="button"
              className="note-font-card note-font-import"
              disabled={busy || importingFont}
              onClick={() => void handleImportFont()}
            >
              <span className="note-font-sample">＋</span>
              <span className="note-font-name">
                {importingFont ? "导入中…" : "导入字体"}
              </span>
            </button>
          )}
        </div>
        {appearance.noteCustomFontName && (
          <div className="note-font-actions">
            <span
              className="note-font-current"
              title={appearance.noteCustomFontName}
            >
              {appearance.noteCustomFontName}
            </span>
            <button
              type="button"
              className="note-font-link"
              disabled={busy || importingFont}
              onClick={() => void handleImportFont()}
            >
              更换
            </button>
            <button
              type="button"
              className="note-font-link is-danger"
              disabled={busy || importingFont}
              onClick={() => void handleRemoveCustomFont()}
            >
              移除
            </button>
          </div>
        )}
        <div className="note-slider-row">
          <span>字号</span>
          <input
            type="range"
            min={FONT_SIZE_MIN}
            max={FONT_SIZE_MAX}
            step={1}
            value={appearance.noteFontSize}
            aria-label="便签字号"
            onChange={(event) =>
              handleFontSizeChange(Number(event.target.value))
            }
          />
          <span className="note-slider-value">{appearance.noteFontSize}px</span>
        </div>
      </div>

      <div className="appearance-group">
        <h4 className="appearance-group-title">纸面与显示</h4>
        <div
          className="note-detail-toggles"
          role="group"
          aria-label="便签纸面与显示"
        >
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={appearance.noteTexture}
              disabled={busy}
              onChange={(event) =>
                handleToggleChange("noteTexture", event.target.checked)
              }
            />
            <span>纸张纹理</span>
          </label>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={appearance.noteRules}
              disabled={busy}
              onChange={(event) =>
                handleToggleChange("noteRules", event.target.checked)
              }
            />
            <span>行格线</span>
          </label>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={appearance.notePin}
              disabled={busy}
              onChange={(event) =>
                handleToggleChange("notePin", event.target.checked)
              }
            />
            <span>顶部图钉</span>
          </label>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={appearance.noteDots}
              disabled={busy}
              onChange={(event) =>
                handleToggleChange("noteDots", event.target.checked)
              }
            />
            <span>清单色点</span>
          </label>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={appearance.noteHideDone}
              disabled={busy}
              onChange={(event) =>
                handleToggleChange("noteHideDone", event.target.checked)
              }
            />
            <span>隐藏已完成条目</span>
          </label>
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
