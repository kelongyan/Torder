/**
 * F2 · T-10：设置开关（真实控件）。视觉沿用设计稿 34×20 胶囊规格
 * （样式见 settings.css 的 .set-ph-switch / .switch-toggle 共用块）。
 * 2026-09-14 起为设置内唯一开关实现——原 .settings-toggle checkbox
 * 胶囊（34×19）已全部迁移到本组件，两套视觉并存问题消除。
 */
export function ToggleSwitch({
  checked,
  label,
  disabled = false,
  onChange,
}: {
  checked: boolean;
  label: string;
  /** 操作进行中锁定（迁移自原 checkbox 的 disabled={busy}）。 */
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-disabled={disabled}
      className={`switch-toggle ${checked ? "is-on" : ""}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <i aria-hidden="true" />
    </button>
  );
}
