import { Bell } from "lucide-react";
import { reminderOptions } from "../../constants/reminderConfig";
import { saveAppSetting } from "../../services/settingsService";
import type { AppSettings, NotificationSound } from "../../types/settings";
import type { ToastKind } from "../../types/ui";
import { ToggleSwitch } from "../common/ToggleSwitch";
import { Select, type SelectOption } from "../common/Select";

/**
 * F2 · T-10 甲组：提醒与通知 pane（原灰显结构转正）。
 * 「默认提前提醒」自偏好 pane 迁入（方案书 §5.1 定稿）。
 * 「每日回顾提醒」「专注时段免打扰」依赖 T-04/T-02，随乙组（F4）。
 */
const soundOptions: SelectOption<NotificationSound>[] = [
  { value: "system", label: "跟随系统" },
  { value: "silent", label: "静音" },
];

export function SettingsNotificationsSection({
  settings,
  onSettingsChange,
  onToast,
}: {
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
  onToast: (message: string, type: ToastKind) => void;
}) {
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

  return (
    <section className="settings-section">
      <h3 className="settings-section-title">
        <Bell aria-hidden="true" className="icon-sm" />
        通知
      </h3>
      <div className="settings-toggle-row">
        <span className="settings-toggle-label">系统通知</span>
        <ToggleSwitch
          checked={settings.notificationsEnabled}
          label="系统通知"
          onChange={(next) =>
            void savePreference(
              "notificationsEnabled",
              next,
              next ? "已开启系统通知" : "已关闭系统通知",
            )
          }
        />
      </div>
      <div className="settings-preference-grid">
        <label className="form-field">
          <span>提示音</span>
          <Select<NotificationSound>
            value={settings.notificationSound}
            options={soundOptions}
            onChange={(value) =>
              void savePreference(
                "notificationSound",
                value,
                value === "silent" ? "通知将静音" : "通知将使用系统提示音",
              )
            }
            ariaLabel="提示音"
          />
        </label>
        <label className="form-field">
          <span>默认提前提醒</span>
          <Select<number>
            value={settings.defaultReminderMinutes}
            options={reminderOptions}
            onChange={(value) =>
              void savePreference(
                "defaultReminderMinutes",
                value,
                "已更新默认提醒",
              )
            }
            ariaLabel="默认提前提醒"
          />
        </label>
      </div>
      <p className="settings-status-note">
        关闭系统通知后，任务到点将不再弹出提醒；提前时间用于新建事项时的默认值。
      </p>
    </section>
  );
}
