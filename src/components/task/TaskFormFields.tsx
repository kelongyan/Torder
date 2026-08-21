import { DEFAULT_LIST_COLOR } from "../../constants/listConfig";
import { priorityCopy } from "../../constants/taskConfig";
import { reminderPresets } from "../../constants/reminderConfig";
import type { RecurrenceFrequency, TaskList } from "../../types/database";
import { isMobile } from "../../utils/platform";
import type { TaskDraft } from "../../utils/taskHelpers";
import { SegmentedControl } from "../common/SegmentedControl";
import { Select } from "../common/Select";
import { TaskDateTimeField } from "./TaskDateTimeField";

const priorityOptions = [
  { value: 2 as const, label: priorityCopy[2].label, color: "var(--red)" },
  { value: 1 as const, label: priorityCopy[1].label, color: "var(--amber)" },
  { value: 0 as const, label: priorityCopy[0].label, color: "var(--blue)" },
];

const reminderOptions = [
  { value: -1, label: "不提醒" },
  ...reminderPresets.map((preset) => ({
    value: preset.value,
    label: preset.label,
  })),
];

const repeatOptions = [
  { value: "none", label: "不重复" },
  { value: "daily", label: "每天" },
  { value: "weekly", label: "每周" },
  { value: "monthly", label: "每月" },
  { value: "quarterly", label: "每季度" },
];

const weekdayOptions = [
  { value: 1, label: "一" },
  { value: 2, label: "二" },
  { value: 3, label: "三" },
  { value: 4, label: "四" },
  { value: 5, label: "五" },
  { value: 6, label: "六" },
  { value: 0, label: "日" },
];

const aheadUnitOptions = [
  { value: "hours" as const, label: "小时" },
  { value: "days" as const, label: "天" },
];

export function TaskFormFields({
  draft,
  lists,
  onChange,
  onSubmit,
  titleInvalid,
  recurrenceRequired = false,
}: {
  draft: TaskDraft;
  lists: TaskList[];
  onChange: (draft: TaskDraft) => void;
  onSubmit?: () => void;
  titleInvalid?: boolean;
  recurrenceRequired?: boolean;
}) {
  const frequency = draft.recurrenceFrequency;
  const shouldAutoFocus = !isMobile();

  return (
    <>
      <div className="form-title-field">
        <input
          autoFocus={shouldAutoFocus}
          value={draft.title}
          onChange={(event) => onChange({ ...draft, title: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing && onSubmit) {
              event.preventDefault();
              onSubmit();
            }
          }}
          className={titleInvalid ? "invalid" : ""}
          placeholder="输入任务名称..."
        />
        {titleInvalid && <span className="form-title-error">任务名称不能为空</span>}
      </div>

      <div className="form-field">
        <span>描述</span>
        <textarea
          value={draft.note}
          onChange={(event) => onChange({ ...draft, note: event.target.value })}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && onSubmit) {
              event.preventDefault();
              onSubmit();
            }
          }}
          placeholder="补充任务背景、要求或链接 (支持 Ctrl+Enter 保存)"
          rows={4}
        />
      </div>

      <div className="form-grid">
        <TaskDateTimeField
          value={draft.dueAt}
          onChange={(dueAt) => onChange({ ...draft, dueAt })}
        />
        {draft.dueAt && (
          <div className="form-field">
            <span>提醒</span>
            <Select<number>
              value={draft.remindBefore ?? -1}
              options={reminderOptions}
              onChange={(value) =>
                onChange({ ...draft, remindBefore: value < 0 ? null : value })
              }
              ariaLabel="提醒时间"
            />
          </div>
        )}
        <div className="form-field">
          <span>优先级</span>
          <SegmentedControl
            value={draft.priority}
            options={priorityOptions}
            onChange={(priority) => onChange({ ...draft, priority })}
            ariaLabel="优先级"
          />
        </div>
        <div className="form-field">
          <span>所属清单</span>
          <Select<string>
            value={draft.listId}
            options={lists.map((list) => ({
              value: list.id,
              label: list.name,
              dotColor: list.color ?? DEFAULT_LIST_COLOR,
            }))}
            onChange={(listId) => onChange({ ...draft, listId })}
            ariaLabel="所属清单"
          />
        </div>
        <div className="form-field">
          <span>重复</span>
          <Select<string>
            value={frequency ?? "none"}
            options={recurrenceRequired ? repeatOptions.slice(1) : repeatOptions}
            onChange={(value) => {
              const due = new Date(draft.dueAt || Date.now());
              onChange({
                ...draft,
                recurrenceFrequency:
                  value === "none" ? null : (value as RecurrenceFrequency),
                recurrenceWeekdays:
                  draft.recurrenceWeekdays.length > 0
                    ? draft.recurrenceWeekdays
                    : [due.getDay()],
                recurrenceMonthDay: due.getDate(),
              });
            }}
            ariaLabel="重复规则"
          />
        </div>

        {frequency && (
          <div className="recurrence-config form-grid-full">
            <div className="recurrence-config-header">
              <div>
                <strong>循环计划</strong>
                <span>按计划提前创建任务，不依赖上一次是否完成</span>
              </div>
            </div>

            <div className="recurrence-config-grid">
              <label className="form-field compact-number-field">
                <span>循环间隔</span>
                <div className="inline-number-control">
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={draft.recurrenceInterval}
                    onChange={(event) =>
                      onChange({
                        ...draft,
                        recurrenceInterval: Math.max(1, Number(event.target.value) || 1),
                      })
                    }
                    aria-label="循环间隔"
                  />
                  <span>{frequencyUnit(frequency)}</span>
                </div>
              </label>

              <label className="form-field compact-number-field">
                <span>提前创建</span>
                <div className="inline-number-control ahead-control">
                  <input
                    type="number"
                    min={0}
                    max={365}
                    value={aheadValue(draft)}
                    onChange={(event) => {
                      const value = Math.max(0, Number(event.target.value) || 0);
                      onChange({
                        ...draft,
                        generateAheadMinutes:
                          value * (draft.generateAheadUnit === "days" ? 1440 : 60),
                      });
                    }}
                    aria-label="提前创建数值"
                  />
                  <Select<"hours" | "days">
                    value={draft.generateAheadUnit}
                    options={aheadUnitOptions}
                    onChange={(unit) => {
                      const value = aheadValue(draft);
                      onChange({
                        ...draft,
                        generateAheadUnit: unit,
                        generateAheadMinutes: value * (unit === "days" ? 1440 : 60),
                      });
                    }}
                    ariaLabel="提前创建单位"
                  />
                </div>
              </label>

              {frequency === "weekly" && (
                <div className="form-field recurrence-weekdays form-grid-full">
                  <span>执行星期</span>
                  <div className="weekday-picker" role="group" aria-label="执行星期">
                    {weekdayOptions.map((day) => {
                      const selected = draft.recurrenceWeekdays.includes(day.value);
                      return (
                        <button
                          key={day.value}
                          type="button"
                          className={selected ? "selected" : ""}
                          aria-pressed={selected}
                          onClick={() => toggleWeekday(draft, day.value, onChange)}
                        >
                          {day.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {(frequency === "monthly" || frequency === "quarterly") && (
                <label className="form-field compact-number-field">
                  <span>每期日期</span>
                  <div className="inline-number-control">
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={draft.recurrenceMonthDay}
                      onChange={(event) =>
                        onChange({
                          ...draft,
                          recurrenceMonthDay: Math.min(
                            31,
                            Math.max(1, Number(event.target.value) || 1),
                          ),
                        })
                      }
                      aria-label="每期日期"
                    />
                    <span>日</span>
                  </div>
                </label>
              )}

              <div className="form-field">
                <span>结束条件</span>
                <Select<string>
                  value={draft.recurrenceEndAt ? "date" : "never"}
                  options={[
                    { value: "never", label: "永不结束" },
                    { value: "date", label: "指定时间结束" },
                  ]}
                  onChange={(value) =>
                    onChange({
                      ...draft,
                      recurrenceEndAt:
                        value === "never" ? "" : defaultEndAt(draft.dueAt),
                    })
                  }
                  ariaLabel="循环结束条件"
                />
              </div>

              {draft.recurrenceEndAt && (
                <TaskDateTimeField
                  label="结束日期时间"
                  value={draft.recurrenceEndAt}
                  onChange={(recurrenceEndAt) =>
                    onChange({ ...draft, recurrenceEndAt })
                  }
                />
              )}
            </div>

            {(frequency === "monthly" || frequency === "quarterly") && (
              <p className="recurrence-month-end-note">
                每月 29、30、31 日遇到短月份时，自动安排在当月最后一天。
              </p>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function frequencyUnit(frequency: RecurrenceFrequency): string {
  if (frequency === "daily") return "天";
  if (frequency === "weekly") return "周";
  if (frequency === "quarterly") return "季度";
  return "月";
}

function aheadValue(draft: TaskDraft): number {
  return draft.generateAheadMinutes / (draft.generateAheadUnit === "days" ? 1440 : 60);
}

function toggleWeekday(
  draft: TaskDraft,
  day: number,
  onChange: (draft: TaskDraft) => void,
) {
  const selected = draft.recurrenceWeekdays.includes(day);
  const weekdays = selected
    ? draft.recurrenceWeekdays.filter((value) => value !== day)
    : [...draft.recurrenceWeekdays, day];
  if (weekdays.length > 0) onChange({ ...draft, recurrenceWeekdays: weekdays });
}

function defaultEndAt(dueAt: string): string {
  const end = new Date(dueAt || Date.now());
  end.setFullYear(end.getFullYear() + 1);
  return new Date(end.getTime() - end.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}
