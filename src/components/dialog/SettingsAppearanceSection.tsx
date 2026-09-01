import { Monitor, Moon, Sun } from "lucide-react";
import type { AppSettings, ThemePreference } from "../../types/settings";
import type { ToastKind } from "../../types/ui";
import { SettingsWidgetAppearanceSection } from "./SettingsWidgetAppearanceSection";
import {
  SettingsAccentPlaceholders,
  SettingsDisplayPlaceholders,
} from "./SettingsPlaceholderSection";

/**
 * 设置 → 外观分区的组合出口。
 * R7：新增「应用主题」三卡（真实生效，写 settings.theme）+
 * 强调色板/密度/字号灰显占位（T-09/T-10）；便签卡（v3 重排）保留在最后。
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

export function SettingsAppearanceSection({
  settings,
  onSettingsChange,
  onToast,
}: {
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
  onToast: (message: string, type: ToastKind) => void;
}) {
  function handleThemeChange(theme: ThemePreference) {
    onSettingsChange({ ...settings, theme });
    onToast(
      theme === "system"
        ? "已跟随系统主题"
        : `已切换到${theme === "dark" ? "深色" : "浅色"}主题`,
      "success",
    );
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

      {/* T-09 / T-10：强调色与显示偏好未开发，灰显占位 */}
      <SettingsAccentPlaceholders />
      <SettingsDisplayPlaceholders />

      <SettingsWidgetAppearanceSection onToast={onToast} />
    </>
  );
}
