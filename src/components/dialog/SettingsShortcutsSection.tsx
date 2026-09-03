import { Keyboard } from "lucide-react";
import { SHORTCUT_GROUPS } from "../../constants/shortcuts";

/**
 * F2 · T-10 甲组：快捷键 pane——只读真实表（方案书定稿）。
 * 数据源 `constants/shortcuts.ts`，与 useKeyboardShortcuts 实际注册项
 * 一一对应；未实现的键位不上表。
 *
 * 「快捷键自定义」**暂不开发（2026-09-03 决策）**，保持下方灰显提示。
 * 未来重启此项的既有结论见 docx/feature-roadmap-2026-09-01.md §5.1 尾注：
 * useKeyboardShortcuts 需先重构为声明式绑定表 + 冲突检测 + AppSettings
 * 持久化；全局热键（Rust lib.rs 注册）与应用内键位是两套机制，一期只做
 * 应用内键位并在设置页注明范围。
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
