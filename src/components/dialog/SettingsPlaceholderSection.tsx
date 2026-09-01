import type { CSSProperties } from "react";

/**
 * R7 · T-10 灰显设置面板（DESIGN.md §13 规则 4）：
 * 事项默认值 / 提醒与通知 / 快捷键 三个分类暂未开发，
 * 按设计稿 settings-panes 的字段结构渲染纯灰显 UI——
 * 不绑回调、不写设置、无 toast；后续开发时逐字段替换为真实控件。
 */
type PlaceholderVariant = "defaults" | "notifications" | "shortcuts";

function PhRow({
  label,
  children,
}: {
  label: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="set-ph-row ui-placeholder" aria-disabled="true">
      <span className="set-ph-label">{label}</span>
      <span className="set-ph-control">{children}</span>
    </div>
  );
}

function PhGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="set-ph-group ui-placeholder" aria-disabled="true">
      <h4 className="set-ph-title">{title}</h4>
      {children}
    </div>
  );
}

function PhChips({ items, activeIndex = 0 }: { items: string[]; activeIndex?: number }) {
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

function PhSwitch({ on = false }: { on?: boolean }) {
  return (
    <span className={`set-ph-switch ${on ? "is-on" : ""}`} aria-hidden="true">
      <i />
    </span>
  );
}

function PhPicker({ value }: { value: string }) {
  return (
    <span className="set-ph-picker">
      {value}
      <i aria-hidden="true">▾</i>
    </span>
  );
}

function PhKbd({ combo }: { combo: { label: string; keys: string } }) {
  return (
    <span className="set-ph-kbd-row">
      <span className="set-ph-kbd-label">{combo.label}</span>
      <kbd>{combo.keys}</kbd>
    </span>
  );
}

export function SettingsPlaceholderSection({
  variant,
}: {
  variant: PlaceholderVariant;
}) {
  if (variant === "defaults") {
    return (
      <section className="settings-section">
        <PhGroup title="新建事项时">
          <PhRow label="默认项目">
            <PhPicker value="收件箱" />
          </PhRow>
          <PhRow label="默认截止">
            <PhChips items={["无", "今天", "明天", "下周一"]} />
          </PhRow>
          <PhRow label="默认优先级">
            <PhChips items={["无", "低", "中", "高"]} />
          </PhRow>
        </PhGroup>
        <PhGroup title="输入与完成">
          <PhRow label="识别自然语言速记">
            <PhSwitch on />
          </PhRow>
          <PhRow label="完成后立刻归入已完成">
            <PhSwitch on />
          </PhRow>
          <PhRow label="逾期自动顺延到明天">
            <PhSwitch />
          </PhRow>
        </PhGroup>
      </section>
    );
  }

  if (variant === "notifications") {
    return (
      <section className="settings-section">
        <PhGroup title="通知">
          <PhRow label="系统通知">
            <PhSwitch on />
          </PhRow>
          <PhRow label="提示音">
            <PhPicker value="轻柔" />
          </PhRow>
          <PhRow label="默认提前提醒">
            <PhChips items={["准时", "5 分钟", "15 分钟", "30 分钟"]} activeIndex={1} />
          </PhRow>
        </PhGroup>
        <PhGroup title="节奏">
          <PhRow label="每日回顾提醒">
            <PhPicker value="20:30" />
            <PhSwitch on />
          </PhRow>
          <PhRow label="专注时段免打扰">
            <PhSwitch />
          </PhRow>
        </PhGroup>
      </section>
    );
  }

  const groups: Array<{ title: string; keys: Array<{ label: string; keys: string }> }> = [
    {
      title: "全局",
      keys: [
        { label: "迷你窗速记", keys: "Alt Space" },
        { label: "打开设置", keys: "Ctrl ," },
      ],
    },
    {
      title: "事项",
      keys: [
        { label: "新建事项", keys: "Ctrl N" },
        { label: "保存并继续添加", keys: "Ctrl Enter" },
        { label: "勾选选中行", keys: "Space" },
      ],
    },
    {
      title: "导航",
      keys: [
        { label: "命令面板", keys: "Ctrl K" },
        { label: "列表 / 看板", keys: "Ctrl 1 / 2" },
        { label: "切换主题", keys: "T" },
        { label: "折叠侧栏", keys: "Ctrl B" },
      ],
    },
  ];

  return (
    <section className="settings-section">
      {groups.map((group) => (
        <PhGroup key={group.title} title={group.title}>
          {group.keys.map((combo) => (
            <PhKbd key={combo.label} combo={combo} />
          ))}
        </PhGroup>
      ))}
      <p className="set-ph-note ui-placeholder" aria-disabled="true">
        快捷键自定义 · 暂未开放
      </p>
    </section>
  );
}

/** R7 · T-11 关于页尾部灰显行（更新日志 / 开源许可）。 */
export function SettingsAboutPlaceholders() {
  return (
    <div className="settings-section ui-placeholder" aria-disabled="true">
      <PhRow label="更新日志">
        <PhPicker value="v2.6.3" />
      </PhRow>
      <PhRow label="开源许可">
        <span className="set-ph-link">MIT License</span>
      </PhRow>
    </div>
  );
}

/** R7 · T-09 强调色板灰显（6 色，静态预设即设计稿 --p-* 取值）。 */
const ACCENT_SWATCHES = ["#6e9bff", "#4bc0c8", "#43c48d", "#e8b04b", "#f2796b", "#a98af5"];

export function SettingsAccentPlaceholders() {
  return (
    <div className="set-ph-group ui-placeholder" aria-disabled="true">
      <h4 className="set-ph-title">强调色</h4>
      <div className="set-ph-swatches">
        {ACCENT_SWATCHES.map((color, index) => (
          <span
            key={color}
            className={`set-ph-swatch ${index === 0 ? "is-on" : ""}`}
            style={{ "--swatch": color } as CSSProperties}
          />
        ))}
      </div>
      <p className="set-ph-note">切换应用强调色 · 暂未开放</p>
    </div>
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
