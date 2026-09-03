/**
 * F2 · T-10：设置开关（真实控件）。视觉沿用设计稿 34×20 胶囊规格
 * （样式见 settings.css 的 .set-ph-switch / .switch-toggle 共用块）。
 */
export function ToggleSwitch({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch-toggle ${checked ? "is-on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <i aria-hidden="true" />
    </button>
  );
}
