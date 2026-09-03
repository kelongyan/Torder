import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  AccentPreference,
  DensityPreference,
  FontSizePreference,
  ThemePreference,
} from "../types/settings";
import { broadcastAppTheme, cacheAppTheme } from "../services/widgetAppearance";

/**
 * T-09 强调色：把预设写到 <html data-accent>，由 theme-tokens.css 的静态
 * 预设层接管全部派生（设计稿 §2.4 复现取舍：统一走静态层，不走内联变量）。
 * blue 是默认值，此时移除属性让主体 token 生效。
 */
export function applyAccentPreference(accent: AccentPreference): void {
  if (accent === "blue") {
    delete document.documentElement.dataset.accent;
  } else {
    document.documentElement.dataset.accent = accent;
  }
}

/**
 * 阶段 D · T-10 乙组：显示偏好。standard 是默认值，此时移除属性让主体
 * token 生效（与 data-accent「无属性即默认」同一惯例）；档位覆写值见
 * tokens.css 的显示偏好段，消费方声明（font-size: var(--text-*) 等）不变。
 */
export function applyDisplayDensity(density: DensityPreference): void {
  if (density === "standard") {
    delete document.documentElement.dataset.density;
  } else {
    document.documentElement.dataset.density = density;
  }
}

export function applyFontSizeScale(size: FontSizePreference): void {
  if (size === "standard") {
    delete document.documentElement.dataset.fontSize;
  } else {
    document.documentElement.dataset.fontSize = size;
  }
}

export function applyThemePreference(theme: ThemePreference): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");

  function apply() {
    const dark = theme === "dark" || (theme === "system" && media.matches);
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    // 便签「跟随应用」主题的两个数据源：首帧缓存 + 跨窗口广播
    cacheAppTheme(dark);
    broadcastAppTheme(dark);
    if (isTauri()) {
      void invoke("set_window_material_theme", { dark }).catch(() => {
        // CSS glass remains the visual fallback when native Mica is unavailable.
      });
    }
  }

  apply();
  if (theme === "system") media.addEventListener("change", apply);
  return () => media.removeEventListener("change", apply);
}
