import { invoke, isTauri } from "@tauri-apps/api/core";
import type { ThemePreference } from "../types/settings";
import { broadcastAppTheme, cacheAppTheme } from "../services/widgetAppearance";

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
