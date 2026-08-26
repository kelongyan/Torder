import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { Monitor } from "lucide-react";
import { getSetting } from "../../services/settingsService";
import {
  getWidgetSettings,
  saveWidgetSettings,
} from "../../services/widgetService";
import type { ToastKind } from "../../types/ui";
import { isMobile } from "../../utils/platform";

/** 桌面专属（浏览器模式/移动端不渲染）：开机自启动 + 桌面小窗开关。 */
export function SettingsDesktopSection({
  onToast,
}: {
  onToast: (message: string, type: ToastKind) => void;
}) {
  const [launchAtStartup, setLaunchAtStartup] = useState(false);
  const [widgetEnabled, setWidgetEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isTauri() || isMobile()) return;
    let cancelled = false;
    void (async () => {
      const [startupSetting, widgetSettings] = await Promise.all([
        getSetting("launchAtStartup"),
        getWidgetSettings(),
      ]);
      if (cancelled) return;
      setLaunchAtStartup(startupSetting?.value === "true");
      setWidgetEnabled(widgetSettings.enabled);
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!isTauri() || isMobile()) return null;

  async function handleLaunchToggle(enabled: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      await invoke("set_launch_at_startup", { enabled });
      setLaunchAtStartup(enabled);
      onToast(enabled ? "已开启开机自启动" : "已关闭开机自启动", "success");
    } catch (error) {
      onToast(`开机自启动设置失败: ${String(error)}`, "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleWidgetToggle(enabled: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      await saveWidgetSettings({ enabled });
      await invoke("set_widget_enabled", { enabled });
      setWidgetEnabled(enabled);
      onToast(enabled ? "桌面小窗已显示" : "桌面小窗已隐藏", "success");
    } catch (error) {
      // 窗口操作失败时回滚设置键，保持开关与实际一致
      await saveWidgetSettings({ enabled: widgetEnabled }).catch(
        () => undefined,
      );
      onToast(`桌面小窗设置失败: ${String(error)}`, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-section">
      <h3 className="settings-section-title">
        <Monitor aria-hidden="true" className="icon-sm" />
        桌面与启动
      </h3>
      <div className="settings-preference-grid">
        <label className="settings-toggle form-grid-full">
          <input
            type="checkbox"
            checked={launchAtStartup}
            disabled={busy}
            onChange={(event) => void handleLaunchToggle(event.target.checked)}
          />
          <span>开机自启动（静默驻留托盘）</span>
        </label>
        <label className="settings-toggle form-grid-full">
          <input
            type="checkbox"
            checked={widgetEnabled}
            disabled={busy}
            onChange={(event) => void handleWidgetToggle(event.target.checked)}
          />
          <span>桌面小窗（常驻桌面的日期便签）</span>
        </label>
      </div>
    </section>
  );
}
