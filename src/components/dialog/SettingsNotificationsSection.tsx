import { Bell } from "lucide-react";
import { reminderOptions } from "../../constants/reminderConfig";
import { saveAppSetting } from "../../services/settingsService";
import type { AppSettings, NotificationSound } from "../../types/settings";
import type { ToastKind } from "../../types/ui";
import { isMobile } from "../../utils/platform";
import { ToggleSwitch } from "../common/ToggleSwitch";
import { Select, type SelectOption } from "../common/Select";

/**
 * F2 · T-10 甲组：提醒与通知 pane（原灰显结构转正）。
 * 「默认提前提醒」自偏好 pane 迁入（方案书 §5.1 定稿）。
 * 「每日回顾提醒」「专注时段免打扰」随乙组（阶段 D）转正。
 */
const soundOptions: SelectOption<NotificationSound>[] = [
  { value: "system", label: "跟随系统" },
  { value: "silent", label: "静音" },
];

/** 每日回顾提醒时刻：17:00–23:30，每 30 分钟一档。 */
const reviewTimeOptions: SelectOption<string>[] = Array.from(
  { length: 14 },
  (_, index) => {
    const minutes = (17 + index * 0.5) * 60;
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    const value = `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
    return { value, label: value };
  },
);

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
      {isMobile() && (
        <p className="settings-section-note">
          移动端提醒在应用打开时补发，不做后台常驻。
        </p>
      )}
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
      <div className="settings-toggle-row">
        <span className="settings-toggle-label">每日回顾提醒</span>
        <ToggleSwitch
          checked={settings.reviewReminderEnabled}
          label="每日回顾提醒"
          onChange={(next) =>
            void savePreference(
              "reviewReminderEnabled",
              next,
              next ? "已开启每日回顾提醒" : "已关闭每日回顾提醒",
            )
          }
        />
      </div>
      {settings.reviewReminderEnabled && (
        <div className="settings-preference-grid">
          <label className="form-field">
            <span>提醒时刻</span>
            <Select<string>
              value={settings.reviewReminderTime}
              options={reviewTimeOptions}
              onChange={(value) =>
                void savePreference(
                  "reviewReminderTime",
                  value,
                  "已更新提醒时刻",
                )
              }
            />
          </label>
        </div>
      )}
      {/*
       * 阶段 D · T-10 乙组：专注时段免打扰。focusStore 在专注状态切换时把
       * focusDndUntil 写入 settings KV，Rust notifier 轮询读取并抑制任务提醒
       * （暂停语义：专注结束后下轮轮询补发）。
       */}
      <div className="settings-toggle-row">
        <span className="settings-toggle-label">专注时段免打扰</span>
        <ToggleSwitch
          checked={settings.focusDndEnabled}
          label="专注时段免打扰"
          onChange={(next) =>
            void savePreference(
              "focusDndEnabled",
              next,
              next ? "已开启专注免打扰" : "已关闭专注免打扰",
            )
          }
        />
      </div>
      {settings.focusDndEnabled && (
        <p className="settings-section-hint">
          开启后，专注计时期间暂停任务提醒，专注结束或暂停后自动补发。
        </p>
      )}
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
