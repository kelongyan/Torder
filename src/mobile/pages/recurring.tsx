/**
 * mobile/pages/recurring.tsx — 循环规则列表页（M-B）
 * M-B 为只读浏览（卡片 + 规则语义描述）；规则的创建/编辑/启停
 * 在桌面端完成（涉及 interval/weekdays/monthDay 的高级字段，归入后续批次）。
 */
import type { JSX } from "react";
import { Repeat2 } from "lucide-react";
import { describeRecurringRule } from "../../utils/recurringHelpers";
import { useMobilePage } from "../router";
import { useMobileProps } from "../context";
import { EmptyView, ScreenShell, TopBar } from "../ui";

export function RecurringScreen(): JSX.Element {
  const { nav } = useMobilePage();
  const props = useMobileProps();
  const rules = props.recurringRules;

  return (
    <ScreenShell
      topbar={
        <TopBar
          back
          onBack={() => nav.back()}
          title="循环任务"
          sub={`${rules.length} 条规则`}
        />
      }
    >
      {rules.length === 0 ? (
        <EmptyView
          icon={<Repeat2 aria-hidden="true" />}
          title="还没有循环规则"
          body="在桌面端为重复任务创建循环规则"
        />
      ) : (
        <div className="m-recurring-list">
          {rules.map((rule) => (
            <div key={rule.id} className="m-recurring-card">
              <div className="m-recurring-head">
                <span className={`m-status-dot ${rule.enabled ? "on" : ""}`} />
                <span className="m-recurring-title">{rule.title}</span>
              </div>
              <div className="m-recurring-meta">
                {describeRecurringRule(rule)}
              </div>
            </div>
          ))}
          <p className="m-inline-note">编辑与启停规则请在桌面端进行</p>
        </div>
      )}
    </ScreenShell>
  );
}
