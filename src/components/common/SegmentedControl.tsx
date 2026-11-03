import type { LucideIcon } from "lucide-react";

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: string;
  color?: string;
  icon?: LucideIcon;
  /** 单项不可用（向导里「远端已有数据」之类的互斥条件）。 */
  disabled?: boolean;
}

export function SegmentedControl<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="segmented-control" role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => {
        const Icon = option.icon;
        const selected = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            className={`segmented-option ${selected ? "selected" : ""}`}
            style={
              selected && option.color ? { color: option.color } : undefined
            }
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
          >
            {Icon ? <Icon aria-hidden="true" className="icon-sm" /> : null}
            {option.color && (
              <span
                className="segmented-dot"
                style={{ backgroundColor: option.color }}
                aria-hidden="true"
              />
            )}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
