import { invoke, isTauri } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";

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
    publishClockSettings(updated);
    return updated;
  }
  const updated = await invoke<ClockSettings>("patch_clock_settings", { patch });
  publishClockSettings(updated);
  return updated;
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

/* === 时钟设置广播 ===
   设置页改了置顶 / 锁定 / 显示开关后，时钟窗口需要实时响应，否则要重启挂件
   才生效。模式与 widgetAppearance 的 `widget-settings-changed` 完全一致：
   - Tauri：`emit` 广播所有窗口（含发送者自身；接收方幂等应用，无需排除来源）。
   - mock：BroadcastChannel 跨标签页送达 /#clock 预览页。

   注意这里刻意**不**做 localStorage 启动缓存——时钟的外观全部由 CSS 变量与
   app-theme 缓存驱动，没有「首帧闪默认值」的问题，缓存反而会引入第二数据源。 */

export const CLOCK_SETTINGS_EVENT = "clock-settings-changed";

export function publishClockSettings(settings: ClockSettings): void {
  if (isTauri()) {
    void emit(CLOCK_SETTINGS_EVENT, settings).catch(() => undefined);
    return;
  }
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(CLOCK_SETTINGS_EVENT);
  channel.postMessage(settings);
  channel.close();
}

/**
 * 监听时钟设置广播。Tauri 的 listen 是异步注册，这里把注册未完成时的清理
 * 兜住（与 listenWidgetSettings 同范式）。返回同步清理函数。
 */
export function listenClockSettings(
  handler: (settings: ClockSettings) => void,
): () => void {
  if (isTauri()) {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listen<ClockSettings>(CLOCK_SETTINGS_EVENT, (event) => {
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
  const channel = new BroadcastChannel(CLOCK_SETTINGS_EVENT);
  channel.onmessage = (event) => handler(event.data as ClockSettings);
  return () => channel.close();
}

