import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { Check, ChevronDown, type LucideIcon } from "lucide-react";
import { usePresence } from "../../hooks/usePresence";

export interface SelectOption<T extends string | number> {
  value: T;
  label: string;
  dotColor?: string;
  icon?: LucideIcon;
}

export function Select<T extends string | number>({
  value,
  options,
  onChange,
  placeholder = "请选择",
  ariaLabel,
  className = "",
  disabled = false,
}: {
  value: T | null;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const activeOpen = open && !disabled;
  const presence = usePresence(activeOpen, 180);

  const selected = options.find((option) => option.value === value) ?? null;

  useEffect(() => {
    if (!disabled || !open) return;
    const timer = window.setTimeout(() => setOpen(false), 0);
    return () => window.clearTimeout(timer);
  }, [disabled, open]);

  useEffect(() => {
    if (!activeOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [activeOpen]);

  function toggle() {
    if (disabled) return;
    setOpen((current) => !current);
    setHighlight(
      Math.max(
        0,
        options.findIndex((o) => o.value === value),
      ),
    );
  }

  function handleKeyDown(event: ReactKeyboardEvent) {
    if (disabled) return;
    if (!activeOpen) {
      if (
        event.key === "Enter" ||
        event.key === " " ||
        event.key === "ArrowDown"
      ) {
        event.preventDefault();
        toggle();
      }
      return;
    }

    if (event.key === "Escape") {
      event.stopPropagation();
      setOpen(false);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((current) => (current + 1) % options.length);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight(
        (current) => (current - 1 + options.length) % options.length,
      );
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const option = options[highlight];
      if (option) {
        onChange(option.value);
        setOpen(false);
      }
    }
  }

  function renderTriggerIcon(option: SelectOption<T> | null): ReactNode {
    if (!option) return null;
    const Icon = option.icon;
    if (option.dotColor) {
      return (
        <span
          className="select-dot"
          style={{ backgroundColor: option.dotColor }}
          aria-hidden="true"
        />
      );
    }
    if (Icon) {
      return <Icon aria-hidden="true" className="icon-sm" />;
    }
    return null;
  }

  return (
    <div
      ref={containerRef}
      className={`select-root ${disabled ? "disabled" : ""} ${className}`}
      onKeyDown={handleKeyDown}
    >
      <button
        type="button"
        className={`select-trigger ${activeOpen ? "active" : ""}`}
        onClick={toggle}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={activeOpen}
        aria-label={ariaLabel}
      >
        {renderTriggerIcon(selected)}
        <span className={selected ? "" : "placeholder"}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`select-chevron ${open ? "rotated" : ""}`}
        />
      </button>

      {presence.rendered && (
        <div
          className={`select-panel ${presence.className}`}
          role="listbox"
          aria-label={ariaLabel}
        >
          {options.map((option, index) => {
            const Icon = option.icon;
            const isSelected = option.value === value;
            return (
              <button
                key={String(option.value)}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={[
                  "select-option",
                  isSelected ? "selected" : "",
                  index === highlight && activeOpen ? "highlighted" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                {option.dotColor ? (
                  <span
                    className="select-dot"
                    style={{ backgroundColor: option.dotColor }}
                    aria-hidden="true"
                  />
                ) : Icon ? (
                  <Icon aria-hidden="true" className="icon-sm" />
                ) : null}
                <span>{option.label}</span>
                {isSelected && (
                  <Check aria-hidden="true" className="icon-sm select-check" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
