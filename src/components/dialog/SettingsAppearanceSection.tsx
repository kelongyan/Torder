import type { CSSProperties } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { saveAppSetting } from "../../services/settingsService";
import type {
  AccentPreference,
  AppSettings,
  DensityPreference,
  FontSizePreference,
  ThemePreference,
} from "../../types/settings";
import type { ToastKind } from "../../types/ui";
import { SettingsWidgetAppearanceSection } from "./SettingsWidgetAppearanceSection";

/**
 * 设置 → 外观分区的组合出口。
 * R7：新增「应用主题」三卡（真实生效，写 settings.theme）+
 * T-09 强调色六色板（真实生效，写 settings.accent → data-accent）+
 * 显示偏好灰显占位（T-10 乙组延后）；便签卡（v3 重排）保留在最后。
 */

const THEME_CARDS: Array<{
  value: ThemePreference;
  label: string;
  icon: typeof Sun;
}> = [
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
  { value: "system", label: "跟随系统", icon: Monitor },
];

const ACCENT_SWATCHES: Array<{ value: AccentPreference; color: string }> = [
  { value: "blue", color: "#6e9bff" },
  { value: "violet", color: "#a98af5" },
  { value: "teal", color: "#4bc0c8" },
  { value: "green", color: "#43c48d" },
  { value: "amber", color: "#e8b04b" },
  { value: "rose", color: "#f0819e" },
];

/** 阶段 D · T-10 乙组：显示偏好三档（档位覆写见 tokens.css 显示偏好段）。 */
const DENSITY_OPTIONS: Array<{ value: DensityPreference; label: string }> = [
  { value: "compact", label: "紧凑" },
  { value: "standard", label: "标准" },
  { value: "relaxed", label: "宽松" },
];

const FONT_SIZE_OPTIONS: Array<{ value: FontSizePreference; label: string }> = [
  { value: "small", label: "小" },
  { value: "standard", label: "标准" },
  { value: "large", label: "大" },
];

export function SettingsAppearanceSection({
  settings,
  onSettingsChange,
  onToast,
}: {
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
  onToast: (message: string, type: ToastKind) => void;
}) {
  /**
   * 其余 pane 的通用落盘模式（saveAppSetting + onSettingsChange + 失败 toast）。
   * 修复 F2 回归：主题卡片与强调色板此前只更新内存 state，重启后回默认值。
   */
  async function savePreference<K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
    message: string,
  ) {
    try {
      await saveAppSetting(key, value);
      onSettingsChange({ ...settings, [key]: value });
      onToast(message, "success");
    } catch (error) {
      onToast(`设置保存失败: ${String(error)}`, "error");
    }
  }

  function handleThemeChange(theme: ThemePreference) {
    if (theme === settings.theme) return;
    void savePreference(
      "theme",
      theme,
      theme === "system"
        ? "已跟随系统主题"
        : `已切换到${theme === "dark" ? "深色" : "浅色"}主题`,
    );
  }

  function handleAccentChange(accent: AccentPreference) {
    if (accent === settings.accent) return;
    void savePreference("accent", accent, "已更新强调色");
  }

  function handleDensityChange(density: DensityPreference) {
    const label = DENSITY_OPTIONS.find(
      (option) => option.value === density,
    )!.label;
    void savePreference("density", density, `已切换到${label}密度`);
  }

  function handleFontSizeChange(fontSize: FontSizePreference) {
    const label = FONT_SIZE_OPTIONS.find(
      (option) => option.value === fontSize,
    )!.label;
    void savePreference("fontSize", fontSize, `已切换到${label}字号`);
  }

  return (
    <>
      <section className="settings-section">
        <h3 className="settings-section-title">应用主题</h3>
        <div className="theme-cards">
          {THEME_CARDS.map(({ value, label, icon: Icon }) => {
            const on = settings.theme === value;
            return (
              <button
                key={value}
                type="button"
                className={`theme-card ${on ? "is-on" : ""}`}
                onClick={() => handleThemeChange(value)}
                aria-pressed={on}
              >
                <span
                  className={`theme-card-preview preview-${value}`}
                  aria-hidden="true"
                >
                  <i className="pv-side" />
                  <i className="pv-line" />
                  <i className="pv-line short" />
                </span>
                <span className="theme-card-label">
                  <Icon aria-hidden="true" className="icon-xs" />
                  {label}
                </span>
              </button>
            );
          })}
        </div>
        <p className="settings-status-note">主题即时生效；深色为默认主题。</p>
      </section>

      {/* F2 · T-09：强调色六色板（真实生效） */}
      <section className="settings-section">
        <h3 className="settings-section-title">强调色</h3>
        <div className="accent-swatches" role="radiogroup" aria-label="强调色">
          {ACCENT_SWATCHES.map(({ value, color }) => {
            const on = settings.accent === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={ACCENT_SWATCH_LABELS[value]}
                className={`accent-swatch ${on ? "is-on" : ""}`}
                style={{ "--swatch": color } as CSSProperties}
                onClick={() => handleAccentChange(value)}
              />
            );
          })}
        </div>
        <p className="settings-status-note">
          强调色即时生效；焦点环、选中态与主按钮一并跟随。
        </p>
      </section>

      {/* 阶段 D · T-10 乙组：显示偏好转正（三档 chips，即时生效） */}
      <section className="settings-section">
        <h3 className="settings-section-title">显示偏好</h3>
        <div className="display-pref-row">
          <span className="display-pref-label">界面密度</span>
          <div
            className="display-pref-chips"
            role="radiogroup"
            aria-label="界面密度"
          >
            {DENSITY_OPTIONS.map(({ value, label }) => {
              const on = settings.density === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className={`display-pref-chip ${on ? "is-on" : ""}`}
                  onClick={() => handleDensityChange(value)}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="display-pref-row">
          <span className="display-pref-label">字号</span>
          <div
            className="display-pref-chips"
            role="radiogroup"
            aria-label="字号"
          >
            {FONT_SIZE_OPTIONS.map(({ value, label }) => {
              const on = settings.fontSize === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className={`display-pref-chip ${on ? "is-on" : ""}`}
                  onClick={() => handleFontSizeChange(value)}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
        <p className="settings-status-note">
          即时生效；「标准」为默认档，密度调整行距与控件高度，字号整体缩放。
        </p>
      </section>

      <SettingsWidgetAppearanceSection onToast={onToast} />
    </>
  );
}

const ACCENT_SWATCH_LABELS: Record<AccentPreference, string> = {
  blue: "蓝（默认）",
  violet: "紫",
  teal: "青",
  green: "绿",
  amber: "琥珀",
  rose: "玫红",
};
