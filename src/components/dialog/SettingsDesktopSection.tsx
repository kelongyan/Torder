import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { Monitor } from "lucide-react";
import { getSetting } from "../../services/settingsService";
import {
  getWidgetSettings,
  patchWidgetSettings,
} from "../../services/widgetService";
import {
  getClockSettings,
  patchClockSettings,
  setClockEnabled as setClockEnabledApi,
} from "../../services/clockService";
import {
  FOCUS_MAX_MINUTES,
  FOCUS_MIN_MINUTES,
  useFocusStore,
} from "../../stores/focusStore";
import type { ToastKind } from "../../types/ui";
import { isMobile } from "../../utils/platform";
import { ToggleSwitch } from "../common/ToggleSwitch";

/** 桌面专属（浏览器模式/移动端不渲染）：开机自启动 + 桌面小窗 + 桌面时钟。
 *
 * 桌面时钟的持久偏好（置顶 / 锁定 / 专注时长）统一落在这里——挂件本身按
 * 「零控件」原则不承载任何按钮，设置走这条路径，改动经 clock-settings-changed
 * 广播实时同步到挂件窗口。专注时长的权威存储是 focusStore（不是 clock 设置键），
 * 所以这里直接写 store，它自带落盘与跨窗口广播。 */
export function SettingsDesktopSection({
  onToast,
}: {
  onToast: (message: string, type: ToastKind) => void;
}) {
  const [launchAtStartup, setLaunchAtStartup] = useState(false);
  const [widgetEnabled, setWidgetEnabled] = useState(false);
  const [widgetDblEdit, setWidgetDblEdit] = useState(true);
  const [clockEnabled, setClockEnabled] = useState(false);
  const [clockAlwaysOnTop, setClockAlwaysOnTop] = useState(false);
  const [clockLocked, setClockLocked] = useState(false);
  const [busy, setBusy] = useState(false);

  const durationSec = useFocusStore((state) => state.durationSec);
  const setDuration = useFocusStore((state) => state.setDuration);
  const focusMode = useFocusStore((state) => state.mode);
  /** 编辑中的草稿；null = 未在编辑，直接显示权威值。
   *  不用 effect 把 store 值同步进本地 state —— 那是派生状态反模式，
   *  会在每次外部变更时引发级联渲染（eslint react-hooks/set-state-in-effect）。 */
  const [durationDraft, setDurationDraft] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri() || isMobile()) return;
    let cancelled = false;
    void (async () => {
      const [startupSetting, widgetSettings, clockSettings] = await Promise.all(
        [
          getSetting("launchAtStartup"),
          getWidgetSettings(),
          getClockSettings(),
        ],
      );
      if (cancelled) return;
      setLaunchAtStartup(startupSetting?.value === "true");
      setWidgetEnabled(widgetSettings.enabled);
      setWidgetDblEdit(widgetSettings.noteDblEdit);
      setClockEnabled(clockSettings.enabled);
      setClockAlwaysOnTop(Boolean(clockSettings.alwaysOnTop));
      setClockLocked(Boolean(clockSettings.locked));
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
      await patchWidgetSettings({ enabled });
      await invoke("set_widget_enabled", { enabled });
      setWidgetEnabled(enabled);
      onToast(enabled ? "桌面便签已显示" : "桌面便签已隐藏", "success");
    } catch (error) {
      // 窗口操作失败回滚设置键，保持开关与实际一致
      await patchWidgetSettings({ enabled: widgetEnabled }).catch(
        () => undefined,
      );
      onToast(`桌面便签设置失败: ${String(error)}`, "error");
    } finally {
      setBusy(false);
    }
  }

  /** 便签双击编辑开关：patch 成功即广播 widget-settings-changed，便签窗口即时生效 */
  async function handleWidgetDblEditToggle(enabled: boolean) {
    if (busy) return;
    setBusy(true);
    setWidgetDblEdit(enabled);
    try {
      await patchWidgetSettings({ noteDblEdit: enabled });
    } catch (error) {
      setWidgetDblEdit(!enabled);
      onToast(`便签设置失败: ${String(error)}`, "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleClockToggle(enabled: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      await patchClockSettings({ enabled });
      await setClockEnabledApi(enabled);
      setClockEnabled(enabled);
      onToast(enabled ? "桌面时钟已显示" : "桌面时钟已隐藏", "success");
    } catch (error) {
      await patchClockSettings({ enabled: clockEnabled }).catch(
        () => undefined,
      );
      onToast(`桌面时钟设置失败: ${String(error)}`, "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleClockAlwaysOnTopToggle(next: boolean) {
    if (busy) return;
    setBusy(true);
    setClockAlwaysOnTop(next);
    try {
      // 实际窗口行为的落地在时钟窗口侧（监听广播后调 setAlwaysOnTop），
      // 这里只负责写设置键 + 广播，保证「设置」与「窗口」单一数据源。
      await patchClockSettings({ alwaysOnTop: next });
    } catch (error) {
      setClockAlwaysOnTop(!next);
      onToast(`时钟置顶设置失败: ${String(error)}`, "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleClockLockToggle(next: boolean) {
    if (busy) return;
    setBusy(true);
    setClockLocked(next);
    try {
      await patchClockSettings({ locked: next });
    } catch (error) {
      setClockLocked(!next);
      onToast(`时钟锁定设置失败: ${String(error)}`, "error");
    } finally {
      setBusy(false);
    }
  }

  function commitDuration() {
    if (durationDraft === null) return;
    // 专注进行中 focusStore 不接受时长变更（本轮时长冻结），给出反馈而不是静默丢弃。
    if (focusMode !== "idle") {
      onToast("专注进行中，暂时无法修改时长", "info");
      setDurationDraft(null);
      return;
    }
    const parsed = Number(durationDraft);
    // 输入以分钟为单位（粗调入口）；时钟挂件的三段编辑才是秒级细调。
    // 未动过的草稿不会被提交（durationDraft === null 早退），秒级精度
    // 只在用户真的在这里输入时才会被取整覆盖。
    const next = Number.isFinite(parsed)
      ? Math.max(
          FOCUS_MIN_MINUTES,
          Math.min(FOCUS_MAX_MINUTES, Math.round(parsed)),
        )
      : Math.round(durationSec / 60);
    setDuration(next * 60);
    setDurationDraft(null);
  }

  return (
    <section className="settings-section">
      <h3 className="settings-section-title">
        <Monitor aria-hidden="true" className="icon-sm" />
        桌面与启动
      </h3>
      <div className="settings-toggle-list">
        <div className="settings-toggle-row">
          <span className="settings-toggle-label">开机自启动</span>
          <ToggleSwitch
            checked={launchAtStartup}
            label="开机自启动"
            disabled={busy}
            onChange={(next) => void handleLaunchToggle(next)}
          />
        </div>
        <div className="settings-toggle-row">
          <span className="settings-toggle-label">桌面便签</span>
          <ToggleSwitch
            checked={widgetEnabled}
            label="桌面便签"
            disabled={busy}
            onChange={(next) => void handleWidgetToggle(next)}
          />
        </div>
        <div className="settings-toggle-row">
          <span className="settings-toggle-copy">
            <span className="settings-toggle-label">便签双击编辑</span>
            <span className="settings-toggle-desc">
              双击条目改标题：Enter 保存，Esc 取消；右键条目可转到主窗改详细内容。
            </span>
          </span>
          <ToggleSwitch
            checked={widgetDblEdit}
            label="便签双击编辑"
            disabled={busy}
            onChange={(next) => void handleWidgetDblEditToggle(next)}
          />
        </div>
        <div className="settings-toggle-row">
          <span className="settings-toggle-copy">
            <span className="settings-toggle-label">桌面时钟</span>
            <span className="settings-toggle-desc">
              单击数字开始专注；点悬浮铅笔改时长；专注中空格暂停、Esc 结束。
            </span>
          </span>
          <ToggleSwitch
            checked={clockEnabled}
            label="桌面时钟"
            disabled={busy}
            onChange={(next) => void handleClockToggle(next)}
          />
        </div>
        <div className="settings-toggle-row is-sub">
          <span className="settings-toggle-label">时钟置顶显示</span>
          <ToggleSwitch
            checked={clockAlwaysOnTop}
            label="时钟置顶显示"
            disabled={busy}
            onChange={(next) => void handleClockAlwaysOnTopToggle(next)}
          />
        </div>
        <div className="settings-toggle-row is-sub">
          <span className="settings-toggle-label">锁定时钟位置</span>
          <ToggleSwitch
            checked={clockLocked}
            label="锁定时钟位置"
            disabled={busy}
            onChange={(next) => void handleClockLockToggle(next)}
          />
        </div>
      </div>
      <div className="settings-preference-grid">
        <label className="form-field form-grid-full">
          <span>专注时长（{FOCUS_MIN_MINUTES}–{FOCUS_MAX_MINUTES} 分钟）</span>
          <input
            type="number"
            inputMode="numeric"
            min={FOCUS_MIN_MINUTES}
            max={FOCUS_MAX_MINUTES}
            step={5}
            value={durationDraft ?? String(Math.round(durationSec / 60))}
            onChange={(event) => setDurationDraft(event.target.value)}
            onBlur={commitDuration}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitDuration();
              }
            }}
          />
        </label>
      </div>
    </section>
  );
}
