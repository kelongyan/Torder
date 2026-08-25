import { CalendarDays, X } from "lucide-react";
import { formatTaskScheduleDate } from "../../utils/taskDates";

export function TaskDateField({
  value,
  onChange,
  label = "计划日期",
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  const displayValue = formatTaskScheduleDate(value) ?? "未安排";

  return (
    <div className="form-field task-date-field">
      <span>{label}</span>
      <div className={`task-date-control ${value ? "has-value" : ""}`}>
        <CalendarDays aria-hidden="true" className="icon-sm" />
        <input
          type="date"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label={label}
          title={displayValue}
        />
        {value && (
          <button
            type="button"
            className="task-date-clear"
            onClick={() => onChange("")}
            aria-label={`清除${label}`}
          >
            <X aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
