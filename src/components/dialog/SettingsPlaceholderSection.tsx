import type { ReactNode } from "react";

/**
 * R7 · T-10 乙组：显示偏好（密度/字号）灰显占位（DESIGN.md §13 规则 4）。
 * 随 F4 排期转正。
 *
 * F2 已转正的历史占位（勿再回填）：
 * - 事项默认值 / 提醒与通知 / 快捷键 → SettingsDefaultsSection /
 *   SettingsNotificationsSection / SettingsShortcutsSection
 * - 强调色板 → SettingsAppearanceSection
 * - 更新日志 / 开源许可 → SettingsAboutExtras
 * - 「完成后立刻归入已完成」语义与现有 done 视图行为重复，未收录（方案书 v1.3）
 */

function PhRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="set-ph-row ui-placeholder" aria-disabled="true">
      <span className="set-ph-label">{label}</span>
      {children}
    </div>
  );
}

function PhChips({
  items,
  activeIndex = 0,
}: {
  items: string[];
  activeIndex?: number;
}) {
  return (
    <span className="set-ph-chips">
      {items.map((item, index) => (
        <span
          key={item}
          className={`set-ph-chip ${index === activeIndex ? "is-on" : ""}`}
        >
          {item}
        </span>
      ))}
    </span>
  );
}
/** R7 · T-10 密度 / 字号灰显（外观 pane）。 */
export function SettingsDisplayPlaceholders() {
  return (
    <div className="set-ph-group ui-placeholder" aria-disabled="true">
      <h4 className="set-ph-title">显示偏好</h4>
      <PhRow label="界面密度">
        <PhChips items={["紧凑", "标准", "宽松"]} activeIndex={1} />
      </PhRow>
      <PhRow label="字号">
        <PhChips items={["小", "标准", "大"]} activeIndex={1} />
      </PhRow>
    </div>
  );
}
