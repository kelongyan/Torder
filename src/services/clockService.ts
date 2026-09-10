import { invoke, isTauri } from "@tauri-apps/api/core";

export interface ClockSettings {
  enabled: boolean;
  x?: number | null;
  y?: number | null;
  /** 手动拉伸后的窗口尺寸（逻辑像素）。区间由 Rust 侧窗口的 min/max 声明，
   *  这里只负责落盘实测值；与 src-tauri/src/clock.rs 的口径保持一致。 */
  w?: number | null;
  h?: number | null;
  alwaysOnTop?: boolean;
  locked?: boolean;
}

const DEFAULT_CLOCK_SETTINGS: ClockSettings = {
  enabled: false,
  x: null,
  y: null,
  alwaysOnTop: false,
  locked: false,
};

const STORAGE_KEY = "torder.clock-settings";

export async function getClockSettings(): Promise<ClockSettings> {
  if (!isTauri()) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw
        ? { ...DEFAULT_CLOCK_SETTINGS, ...JSON.parse(raw) }
        : DEFAULT_CLOCK_SETTINGS;
    } catch {
      return DEFAULT_CLOCK_SETTINGS;
    }
  }
  return invoke<ClockSettings>("get_clock_settings");
}

export async function patchClockSettings(
  patch: Partial<ClockSettings>,
): Promise<ClockSettings> {
  if (!isTauri()) {
    const current = await getClockSettings();
    const updated = { ...current, ...patch };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return updated;
  }
  return invoke<ClockSettings>("patch_clock_settings", { patch });
}

export async function setClockEnabled(enabled: boolean): Promise<void> {
  if (!isTauri()) {
    await patchClockSettings({ enabled });
    return;
  }
  await invoke("set_clock_enabled", { enabled });
}

export async function toggleClockWindow(): Promise<boolean> {
  if (!isTauri()) {
    const current = await getClockSettings();
    const next = !current.enabled;
    await patchClockSettings({ enabled: next });
    return next;
  }
  return invoke<boolean>("toggle_clock");
}

/** CSS 玻璃 tint 的基础浓度。clock.css 按主题各自折算遮罩深度
 *  （暗色 ×0.75 / 亮色 ×0.8）——2026-09-10 起这是玻璃的全部遮罩来源：
 *  SWCA 磨砂按窗口矩形绘制、无法随纸面圆角裁形（会把挂件包进方角容器），
 *  已从时钟移除；便签不受影响（纸面铺满窗口每个像素，磨砂与纸面重合）。 */
export const CLOCK_GLASS_ALPHA = 0.5;

