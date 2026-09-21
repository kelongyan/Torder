import { useEffect } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { SettingsPanelId, UpdateInfo } from "../types/settings";
import { isMobile } from "../utils/platform";
import {
  applyTrayIntent,
  isTrayIntent,
  type TrayIntent,
} from "../utils/trayIntent";

export interface UseTrayNavigationOptions {
  /** 打开设置弹窗并直达面板（`useDialogManager` 的 `openSettingsDialog`）。 */
  openSettingsDialog: (panel?: SettingsPanelId) => void;
  /** 手动检查更新；发现新版本时应弹出更新弹窗，无更新/失败走 toast。 */
  checkUpdate: () => Promise<UpdateInfo>;
  onFoundUpdate: (info: UpdateInfo) => void;
  onToast: (message: string, kind: "info" | "success" | "error") => void;
}

/**
 * 托盘「设置」子菜单的导航桥（仅做 IPC 装配，决策在 `utils/trayIntent.ts`）。
 *
 * 两条通道缺一不可：
 *  1. `tray-intent` 事件——常规路径，前端已挂载时由 Rust 直接派发；
 *  2. 挂载时调一次 `take_tray_intent`——兜底路径，`--silent` 冷启动等场景下
 *     托盘点击可能早于 listener 注册，事件已经丢了，靠暂存槽补做一次。
 *
 * 顺序是硬要求：必须等 listener 注册成功后才调 `take_tray_intent`——
 * Rust 侧以该调用为「前端已就绪」的信号（之后就只走事件、不再暂存），
 * 反了会让冷启动期间的点击彻底丢失。
 */
export function useTrayNavigation({
  openSettingsDialog,
  checkUpdate,
  onFoundUpdate,
  onToast,
}: UseTrayNavigationOptions): void {
  useEffect(() => {
    // 托盘仅桌面存在；移动端既无托盘也无该事件。
    if (!isTauri() || isMobile()) return;

    let cancelled = false;
    let unlisten: (() => void) | undefined;

    const handle = (intent: TrayIntent) => {
      applyTrayIntent(intent, {
        openSettingsDialog,
        checkUpdate,
        onFoundUpdate,
        onToast,
      });
    };

    void listen<TrayIntent>("tray-intent", (event) => {
      if (isTrayIntent(event.payload)) handle(event.payload);
    })
      .then((dispose) => {
        if (cancelled) {
          dispose();
          return null;
        }
        unlisten = dispose;
        return invoke<TrayIntent | null>("take_tray_intent");
      })
      .then((pending) => {
        if (cancelled || !pending || !isTrayIntent(pending)) return;
        handle(pending);
      })
      .catch(() => {
        // 托盘交互失败不打断主界面（与 useTrayQuickAdd 一致）。
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [openSettingsDialog, checkUpdate, onFoundUpdate, onToast]);
}
