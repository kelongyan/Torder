import { taskViewCopy } from "../../constants/taskViews";
import { cleanupTrash } from "../../services/taskService";
import { saveAppSetting } from "../../services/settingsService";
import { useTaskStore } from "../../stores/taskStore";
import type { SystemView } from "../../types/database";
import type { AppSettings } from "../../types/settings";
import type { ToastKind } from "../../types/ui";
import { isMobile } from "../../utils/platform";
import { Select, type SelectOption } from "../common/Select";
import { ToggleSwitch } from "../common/ToggleSwitch";

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
      <h3 className="settings-section-title">视图与清理</h3>
      <div className="settings-row">
        <span className="settings-row-label">启动视图</span>
        <div className="settings-row-control">
          <Select<SystemView>
            value={settings.defaultView}
            options={defaultViewOptions}
            onChange={(value) =>
              void savePreference("defaultView", value, "已更新启动视图")
            }
            ariaLabel="启动默认视图"
          />
        </div>
      </div>
      {!isMobile() && (
        <div className="settings-row">
          <span className="settings-row-label">备份保留</span>
          <div className="settings-row-control">
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
          </div>
        </div>
      )}
      <div className="settings-row">
        <div className="settings-row-copy">
          <span className="settings-row-label">回收站清理</span>
          <span className="settings-row-desc">
            超过保留天数的回收站任务将被清出数据库
          </span>
        </div>
        <div className="settings-row-control">
          <Select<number>
            value={settings.trashRetentionDays ?? -1}
            options={trashRetentionOptions}
            onChange={(value) => void handleTrashRetentionChange(value)}
            ariaLabel="回收站自动清理"
          />
        </div>
      </div>
      {/*
       * 阶段 D · T-10 乙组：逾期自动顺延到明天。数据行为开关（非纯偏好），
       * 顺延规则唯一走 taskStats.shiftOverdueTaskPatch，与每日回顾一致。
       */}
      <div className="settings-row">
        <div className="settings-row-copy">
          <span className="settings-row-label">逾期自动顺延</span>
          <span className="settings-row-desc">
            每天首次打开时，昨日逾期顺延到明天
          </span>
        </div>
        <div className="settings-row-control">
          <ToggleSwitch
            checked={settings.autoPostponeOverdue}
            label="逾期任务自动顺延到明天"
            onChange={(next) =>
              void savePreference(
                "autoPostponeOverdue",
                next,
                next ? "已开启逾期自动顺延" : "已关闭逾期自动顺延",
              )
            }
          />
        </div>
      </div>
    </section>
  );
}
