import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  getWidgetSettings,
  patchWidgetSettings,
} from "../../services/widgetService";
import {
  defaultWidgetAppearance,
  isGlassNoteTheme,
  listSystemFonts,
  MIN_NOTE_GLASS_OPACITY,
  noteFontOptions,
  noteThemeOptions,
  type NoteThemeId,
  type WidgetAppearance,
} from "../../services/widgetAppearance";
import { FontPicker, type FontPickerOption } from "../common/FontPicker";
import type { ToastKind } from "../../types/ui";
import { isMobile } from "../../utils/platform";
import { Check, RotateCcw } from "lucide-react";

const NOTE_THEME_DETAILS: Record<NoteThemeId, { title: string; desc: string }> =
  {
    sky: { title: "海蓝纸面", desc: "经典便签 · 温暖手写" },
    glass: { title: "深色磨砂", desc: "深色亚克力 · 沉浸融桌" },
    frost: { title: "浅色磨砂", desc: "浅色亚克力 · 柔和融桌" },
  };

/** 滑杆拖动期间只更新本地状态，停顿 300ms 才落库——避免每像素一次 IPC */
const SLIDER_FLUSH_MS = 300;

type SliderField = "noteGlassOpacity";

/**
 * 设置 → 外观 → 桌面便签个性化：纸色（海蓝 + 磨砂两卡，2026-09-09 老大定稿）+
 * 字体 + 自定义字体导入；布局规约见 docs/appearance-layout-optimization-plan.md §3。
 * 2026-11-03 结构级重构：并入「桌面便签」一个分组——主题是 3 个无边框瓦片
 * （.settings-choice-strip，选中态 = accent-soft 底 + 强调色标题 + 角标对勾），
 * 磨砂浓度、便签字体、恢复默认各占一条设置行。原来 6 张 187×125 描边卡 +
 * 3 个通栏描边容器（字体 / 滑杆 / 重置）的「一排方框」形态到此为止。
 *
 * 2026-09-08 收敛：字号滑杆（锁死 14px）、纸面与显示开关组、旧全局不透明度
 * 滑杆全部移除。2026-09-09 定稿：新增深色磨砂（glass）主题卡，透明度归其
 * 专属——磨砂卡下方横向滑杆（2026-11-02 起 15–100%），实时预览并防抖落库。
 * 2026-11-02（issue #13）：新增浅色磨砂（frost），两种磨砂共用同一滑杆；
 * 主题/字体点击立即落库；卸载时 flush 防抖尾值。
 *
 * - 纸面效果以桌面小窗本体为预览（改动经广播实时生效，
 *   不再设设置界面内的预览卡——2026-08-29 用户定稿移除）。
 * - 字体卡的字样直接用真实字体栈渲染：手写体字样会命中 Torder Note 的
 *   HTTP 缓存（widget 窗口每次启动都拉同一文件），仅外观页首次打开多一次缓存读；
 *   这是主窗唯一引用该字体的地方（AGENTS.md 的「仅 .widget-* 引用」约定以此为例外）。
 * - 主题瓦片用原生 radio（同 name 组自带方向键导航），选中态类名由状态驱动；
 *   预览里的角标对勾与线条都是 aria-hidden 的装饰件，语义只由 radio 承担。
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
  /** 系统字体家族名（下拉数据源）；null = 尚未加载 */
  const [systemFonts, setSystemFonts] = useState<string[] | null>(null);
  /** 最近一次成功落库的外观；写失败时按字段回滚到它 */
  const persistedRef = useRef<WidgetAppearance | null>(null);
  const sliderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 防抖窗口内待落库的滑杆字段（按字段合并）；卸载 flush 时读取 */
  const pendingSliderRef = useRef<Partial<
    Pick<WidgetAppearance, SliderField>
  > | null>(null);

  /**
   * 字体下拉的数据源：预设组 → 已安装字体组。
   *
   * 系统字体在**首次打开下拉时**才拉取（`handleOpenFontList` 触发），
   * 不随设置面板挂载：多数用户不改字体，没必要每次进设置都去枚举注册表。
   */
  const fontPickerOptions = useMemo<FontPickerOption[]>(() => {
    const options: FontPickerOption[] = noteFontOptions.map((font) => ({
      value: font.id,
      label: font.name,
      group: "预设",
      preview: false,
    }));
    for (const family of systemFonts ?? []) {
      options.push({
        value: family,
        label: family,
        group: "已安装字体",
        // 用字体自身渲染名字：选之前就能看出长相，比只列名字有用得多
        preview: true,
      });
    }
    return options;
  }, [systemFonts]);

  useEffect(() => {
    if (isMobile()) return;
    let cancelled = false;
    void (async () => {
      const settings = await getWidgetSettings();
      if (cancelled) return;
      setAppearance(settings);
      persistedRef.current = settings;
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

  /**
   * 首次打开字体下拉时拉取系统字体（惰性）。
   *
   * `systemFonts === null` 既表示「未加载」也表示「正在加载」，用 ref 之外的
   * 状态判定会漏掉「加载失败后再次打开」的场景——失败时回填空数组，
   * 让 UI 明确退化为「只有预设 + 导入字体」，而不是永远卡在「加载中」。
   */
  function handleOpenFontList() {
    if (systemFonts !== null) return;
    void listSystemFonts().then((fonts) => setSystemFonts(fonts));
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

  const glassOpacityPercent = Math.round(appearance.noteGlassOpacity * 100);
  // 渐变已选段比例按滑杆刻度折算（min 15 起步），与拇指位置逐像素一致
  const glassFillPercent = Math.round(
    ((glassOpacityPercent - MIN_NOTE_GLASS_OPACITY * 100) /
      (100 - MIN_NOTE_GLASS_OPACITY * 100)) *
      100,
  );

  return (
    <section className="settings-section">
      <h3 className="settings-section-title">桌面便签</h3>
      <div
        className="settings-choice-strip"
        role="radiogroup"
        aria-label="便签主题"
      >
        {noteThemeOptions.map((theme) => {
          const active = appearance.noteTheme === theme.id;
          const isGlass = isGlassNoteTheme(theme.id);
          const detail = NOTE_THEME_DETAILS[theme.id];
          return (
            <label
              key={theme.id}
              className={`settings-choice ${active ? "is-on" : ""}`.trim()}
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
              <span className="settings-choice-preview">
                <span
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
                  {!isGlass && <span className="note-theme-mini-pin" />}
                  <span className="note-theme-mini-line is-title" />
                  <span className="note-theme-mini-line" />
                  <span className="note-theme-mini-line is-short" />
                  <span className="note-theme-mini-line is-check" />
                </span>
                <span className="settings-choice-check" aria-hidden="true">
                  <Check />
                </span>
              </span>
              <span className="settings-choice-title">{detail.title}</span>
              <span className="settings-choice-desc">{detail.desc}</span>
            </label>
          );
        })}
      </div>

      {/* 磨砂浓度：选中任一磨砂主题时，作为分组内的一条通栏行展开 */}
      {isGlassNoteTheme(appearance.noteTheme) && (
        <div className="settings-row is-stacked">
          <div className="settings-row-copy">
            <span className="settings-row-label">磨砂浓度</span>
            <span className="settings-row-desc">
              越往右纸面越实、越不透桌面
            </span>
          </div>
          <div className="settings-row-control">
            <input
              className="settings-range"
              type="range"
              min={Math.round(MIN_NOTE_GLASS_OPACITY * 100)}
              max={100}
              step={5}
              value={glassOpacityPercent}
              aria-label="磨砂浓度"
              style={
                {
                  "--glass-fill": `${glassFillPercent}%`,
                } as CSSProperties
              }
              onChange={(event) =>
                handleGlassOpacityChange(Number(event.target.value))
              }
            />
            <span className="settings-range-value">{glassOpacityPercent}%</span>
          </div>
        </div>
      )}

      <div className="settings-row">
        <span className="settings-row-label">便签字体</span>
        <div className="settings-row-control">
          <FontPicker
            value={appearance.noteFont}
            options={fontPickerOptions}
            onChange={handleFontChange}
            disabled={busy}
            loading={systemFonts === null}
            onFirstOpen={handleOpenFontList}
          />
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row-copy">
          <span className="settings-row-label">恢复默认外观</span>
          <span className="settings-row-desc">
            纸色与字体回到初始值，位置与尺寸不变
          </span>
        </div>
        <div className="settings-row-control">
          <button
            type="button"
            className="settings-ghost-button"
            disabled={busy}
            onClick={handleResetDefaults}
          >
            <RotateCcw aria-hidden="true" className="icon-xs" />
            恢复
          </button>
        </div>
      </div>
    </section>
  );
}
