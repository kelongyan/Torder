import { Settings2 } from "lucide-react";
import { reminderOptions } from "../../constants/reminderConfig";
import { taskViewCopy } from "../../constants/taskViews";
import { cleanupTrash } from "../../services/taskService";
import { saveAppSetting } from "../../services/settingsService";
import { useTaskStore } from "../../stores/taskStore";
import type { TaskList, SystemView } from "../../types/database";
import type { AppSettings } from "../../types/settings";
import type { ToastKind } from "../../types/ui";
import { Select, type SelectOption } from "../common/Select";

const startupViews: SystemView[] = [
  "all",
  "today",
  "planned",
  "overdue",
  "no-date",
  "important",
  "completed",
];

const defaultViewOptions: SelectOption<SystemView>[] = startupViews.map(
  (view) => ({
    value: view,
    label: taskViewCopy[view].title,
  }),
);

const trashRetentionOptions: SelectOption<number>[] = [
  { value: -1, label: "永不自动清理" },
  { value: 0, label: "立即清理" },
  { value: 7, label: "保留 7 天" },
  { value: 30, label: "保留 30 天" },
  { value: 90, label: "保留 90 天" },
];

const backupRetentionOptions: SelectOption<number>[] = [
  { value: 5, label: "保留 5 份" },
  { value: 10, label: "保留 10 份" },
  { value: 20, label: "保留 20 份" },
  { value: 50, label: "保留 50 份" },
];

export function SettingsPreferencesSection({
  settings,
  lists,
  onSettingsChange,
  onToast,
}: {
  settings: AppSettings;
  lists: TaskList[];
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

  async function handleTrashRetentionChange(value: number) {
    const retention = value < 0 ? null : value;
    await savePreference(
      "trashRetentionDays",
      retention,
      retention === null ? "已关闭回收站自动清理" : "已更新回收站清理规则",
    );
    if (retention !== null) {
      try {
        const count = await cleanupTrash(retention);
        if (count > 0) {
          onToast(`已清理 ${count} 项回收站任务`, "info");
          // cleanupTrash 绕过 store 直接清库，需同步回收站缓存
          if (useTaskStore.getState().trashLoaded) {
            void useTaskStore.getState().refreshTrash();
          }
        }
      } catch (error) {
        onToast(`回收站清理失败: ${String(error)}`, "error");
      }
    }
  }

  return (
    <section className="settings-section">
      <h3 className="settings-section-title">
        <Settings2 aria-hidden="true" className="icon-sm" />
        默认行为
      </h3>
      <div className="settings-preference-grid">
        <label className="form-field">
          <span>默认提醒</span>
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
            ariaLabel="默认提醒"
          />
        </label>
        <label className="form-field">
          <span>默认清单</span>
          <Select<string>
            value={
              lists.some((list) => list.id === settings.defaultListId)
                ? settings.defaultListId
                : "work"
            }
            options={lists.map((list) => ({
              value: list.id,
              label: list.name,
              dotColor: list.color ?? undefined,
            }))}
            onChange={(value) =>
              void savePreference("defaultListId", value, "已更新默认清单")
            }
            ariaLabel="默认清单"
          />
        </label>
        <label className="form-field">
          <span>启动视图</span>
          <Select<SystemView>
            value={settings.defaultView}
            options={defaultViewOptions}
            onChange={(value) =>
              void savePreference("defaultView", value, "已更新启动视图")
            }
            ariaLabel="启动默认视图"
          />
        </label>
        <label className="form-field">
          <span>备份保留</span>
          <Select<number>
            value={settings.backupRetentionCount}
            options={backupRetentionOptions}
            onChange={(value) =>
              void savePreference(
                "backupRetentionCount",
                value,
                "已更新备份保留份数",
              )
            }
            ariaLabel="备份保留份数"
          />
        </label>
        <label className="form-field form-grid-full">
          <span>回收站清理</span>
          <Select<number>
            value={settings.trashRetentionDays ?? -1}
            options={trashRetentionOptions}
            onChange={(value) => void handleTrashRetentionChange(value)}
            ariaLabel="回收站自动清理"
          />
        </label>
      </div>
    </section>
  );
}
