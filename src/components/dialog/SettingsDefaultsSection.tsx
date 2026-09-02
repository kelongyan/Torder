import { CircleCheckBig, Settings2 } from "lucide-react";
import { saveAppSetting } from "../../services/settingsService";
import type { AppSettings, DefaultDueDate } from "../../types/settings";
import type { TaskList } from "../../types/database";
import type { ToastKind } from "../../types/ui";
import { ToggleSwitch } from "../common/ToggleSwitch";
import { Select, type SelectOption } from "../common/Select";

/**
 * F2 · T-10 甲组：事项默认值 pane（原灰显结构转正）。
 * 「默认清单」自偏好 pane 迁入（方案书 §5.1 定稿：字段归位，逻辑不变）。
 * 默认截止/默认优先级/速记开关/完成归位开关为本批新增字段。
 */

const defaultDueOptions: SelectOption<DefaultDueDate>[] = [
  { value: "none", label: "无" },
  { value: "today", label: "今天" },
  { value: "tomorrow", label: "明天" },
  { value: "next_monday", label: "下周一" },
];

const defaultPriorityOptions: SelectOption<AppSettings["defaultPriority"]>[] = [
  { value: -1, label: "不预设" },
  { value: 0, label: "低" },
  { value: 1, label: "中" },
  { value: 2, label: "高" },
];

export function SettingsDefaultsSection({
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

  return (
    <>
      <section className="settings-section">
        <h3 className="settings-section-title">
          <Settings2 aria-hidden="true" className="icon-sm" />
          新建事项时
        </h3>
        <div className="settings-preference-grid">
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
            <span>默认截止</span>
            <Select<DefaultDueDate>
              value={settings.defaultDueDate}
              options={defaultDueOptions}
              onChange={(value) =>
                void savePreference("defaultDueDate", value, "已更新默认截止")
              }
              ariaLabel="默认截止日期"
            />
          </label>
          <label className="form-field">
            <span>默认优先级</span>
            <Select<AppSettings["defaultPriority"]>
              value={settings.defaultPriority}
              options={defaultPriorityOptions}
              onChange={(value) =>
                void savePreference(
                  "defaultPriority",
                  value,
                  "已更新默认优先级",
                )
              }
              ariaLabel="默认优先级"
            />
          </label>
        </div>
        <div className="settings-toggle-row">
          <span className="settings-toggle-label">识别自然语言速记</span>
          <ToggleSwitch
            checked={settings.quickAddNaturalLanguage}
            label="识别自然语言速记"
            onChange={(next) =>
              void savePreference(
                "quickAddNaturalLanguage",
                next,
                next ? "已开启自然语言速记" : "已关闭自然语言速记",
              )
            }
          />
        </div>
        <p className="settings-status-note">
          开启后，快速新建与速记里「明天 15:00 交周报 #工作
          !高」这类写法会自动解析出日期、清单与优先级。
        </p>
      </section>
      <section className="settings-section">
        <h3 className="settings-section-title">
          <CircleCheckBig aria-hidden="true" className="icon-sm" />
          完成事项时
        </h3>
        <div className="settings-toggle-row">
          <span className="settings-toggle-label">完成后立刻归入已完成</span>
          <ToggleSwitch
            checked={settings.moveCompletedImmediately}
            label="完成后立刻归入已完成"
            onChange={(next) =>
              void savePreference(
                "moveCompletedImmediately",
                next,
                next ? "打勾后立刻归入已完成" : "打勾后暂留原位",
              )
            }
          />
        </div>
        <p className="settings-status-note">
          关闭后，刚打勾的事项暂留原位，切换视图或重新加载才归入「已完成」。若视图已关闭「显示已完成」，打勾仍会隐藏该行——那是视图过滤的语义。
        </p>
      </section>
    </>
  );
}
