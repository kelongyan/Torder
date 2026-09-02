import { Keyboard } from "lucide-react";
import { SHORTCUT_GROUPS } from "../../constants/shortcuts";

/**
 * F2 · T-10 甲组：快捷键 pane——只读真实表（方案书定稿）。
 * 数据源 `constants/shortcuts.ts`，与 useKeyboardShortcuts 实际注册项
 * 一一对应；未实现的键位不上表。自定义键位需要冲突检测与持久化，另行排期。
 */
export function SettingsShortcutsSection() {
  return (
    <section className="settings-section">
      <h3 className="settings-section-title">
        <Keyboard aria-hidden="true" className="icon-sm" />
        快捷键
      </h3>
      {SHORTCUT_GROUPS.map((group) => (
        <div key={group.title} className="shortcut-group">
          <h4 className="shortcut-group-title">{group.title}</h4>
          {group.entries.map((entry) => (
            <div key={entry.label} className="shortcut-row">
              <span className="shortcut-label">{entry.label}</span>
              <span className="shortcut-keys">
                {entry.keys.split(" ").map((key, index) => (
                  // 组合键按空格拆分逐段渲染为 kbd 胶囊
                  <kbd key={`${entry.label}-${index}`}>{key}</kbd>
                ))}
              </span>
            </div>
          ))}
        </div>
      ))}
      <div className="set-ph-note ui-placeholder" aria-disabled="true">
        快捷键自定义 · 暂未开放
      </div>
    </section>
  );
}
