import type { ThemePreference } from "../types/settings";

export function applyThemePreference(theme: ThemePreference): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");

  function apply() {
    const dark = theme === "dark" || (theme === "system" && media.matches);
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }

  apply();
  if (theme === "system") media.addEventListener("change", apply);
  return () => media.removeEventListener("change", apply);
}
