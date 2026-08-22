import {
  CalendarClock,
  Pencil,
  Plus,
  Repeat2,
  SkipForward,
  Sparkles,
  Trash2,
} from "lucide-react";
import { formatTaskDateTime } from "../../utils/taskDates";
import { DEFAULT_LIST_COLOR } from "../../constants/listConfig";
import type { RecurringRule, TaskList } from "../../types/database";
import {
  describeGenerationLead,
  describeRecurringRule,
} from "../../utils/recurringHelpers";

export function RecurringRulesView({
  rules,
  lists,
  loading,
  onCreate,
  onEdit,
  onToggle,
  onSkip,
  onGenerate,
  onDelete,
}: {
  rules: RecurringRule[];
  lists: TaskList[];
  loading: boolean;
  onCreate: () => void;
  onEdit: (rule: RecurringRule) => void;
  onToggle: (rule: RecurringRule) => void;
  onSkip: (rule: RecurringRule) => void;
  onGenerate: (rule: RecurringRule) => void;
  onDelete: (rule: RecurringRule) => void;
}) {
  return (
    <div className="recurring-workspace">
      <div className="recurring-toolbar">
        <div>
          <strong>{rules.length} 条循环规则</strong>
        </div>
        <button type="button" className="primary-action" onClick={onCreate}>
          <Plus aria-hidden="true" className="icon-sm" />
          新建循环任务
        </button>
      </div>

      {loading ? (
        <div className="recurring-empty" role="status">
          <Repeat2 aria-hidden="true" />
          <span>读取中...</span>
        </div>
      ) : rules.length === 0 ? (
        <div className="recurring-empty">
          <Repeat2 aria-hidden="true" />
          <strong>还没有循环任务</strong>
          <button type="button" className="primary-action" onClick={onCreate}>
            新建循环任务
          </button>
        </div>
      ) : (
        <div className="recurring-rule-list">
          {rules.map((rule) => {
            const list = lists.find((item) => item.id === rule.listId);
            return (
              <article
                key={rule.id}
                className={`recurring-rule-row ${rule.enabled ? "" : "paused"}`}
              >
                <div className="recurring-rule-main">
                  <span
                    className="recurring-list-dot"
                    style={{ background: list?.color ?? DEFAULT_LIST_COLOR }}
                  />
                  <div>
                    <strong>{rule.title}</strong>
                    {rule.note && <span>{rule.note}</span>}
                  </div>
                </div>

                <div className="recurring-rule-schedule">
                  <span>{describeRecurringRule(rule)}</span>
                  <small>
                    {describeGenerationLead(rule.generateAheadMinutes)}
                  </small>
                </div>

                <div className="recurring-rule-next">
                  <CalendarClock aria-hidden="true" className="icon-sm" />
                  <div>
                    <span>下次截止</span>
                    <strong>
                      {rule.nextDueAt
                        ? formatTaskDateTime(rule.nextDueAt)
                        : "已结束"}
                    </strong>
                  </div>
                </div>

                <div className="recurring-rule-list-name">
                  <span>{list?.name ?? "未分类"}</span>
                </div>

                <div className="recurring-rule-actions">
                  <label
                    className="rule-switch"
                    title={rule.enabled ? "暂停" : "恢复"}
                  >
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={() => onToggle(rule)}
                      aria-label={
                        rule.enabled ? "暂停循环任务" : "恢复循环任务"
                      }
                    />
                    <span />
                  </label>
                  <button
                    type="button"
                    className="icon-button compact"
                    onClick={() => onGenerate(rule)}
                    title="立即生成下一次"
                    aria-label="立即生成下一次"
                    disabled={!rule.enabled || !rule.nextDueAt}
                  >
                    <Sparkles aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="icon-button compact"
                    onClick={() => onSkip(rule)}
                    title="跳过下一次"
                    aria-label="跳过下一次"
                    disabled={!rule.nextDueAt}
                  >
                    <SkipForward aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="icon-button compact"
                    onClick={() => onEdit(rule)}
                    title="编辑规则"
                    aria-label="编辑规则"
                  >
                    <Pencil aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="icon-button compact danger"
                    onClick={() => onDelete(rule)}
                    title="删除规则"
                    aria-label="删除规则"
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
