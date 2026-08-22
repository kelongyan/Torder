import { useState, type FormEvent } from "react";
import { CalendarDays, Plane, Sun } from "lucide-react";
import { calendarEventTypeCopy } from "../../constants/calendarEventConfig";
import type { PresencePhase } from "../../hooks/usePresence";
import type { CalendarEvent, CalendarEventType } from "../../types/database";
import { SegmentedControl } from "../common/SegmentedControl";
import { DialogShell } from "./DialogShell";
import { DialogFooter } from "./DialogFooter";

export function CalendarEventDialog({
  event,
  defaultDate,
  presence,
  onClose,
  onSubmit,
  onDelete,
}: {
  event: CalendarEvent | null;
  defaultDate: string;
  presence: PresencePhase;
  onClose: () => void;
  onSubmit: (data: {
    id?: string;
    title: string;
    eventType: CalendarEventType;
    startDate: string;
    endDate: string;
    note: string | null;
  }) => Promise<void> | void;
  onDelete?: (event: CalendarEvent) => void;
}) {
  const [prevEvent, setPrevEvent] = useState(event);
  const [prevDefaultDate, setPrevDefaultDate] = useState(defaultDate);
  const [title, setTitle] = useState(event?.title ?? "");
  const [eventType, setEventType] = useState<CalendarEventType>(
    event?.eventType ?? "leave",
  );
  const [startDate, setStartDate] = useState(event?.startDate ?? defaultDate);
  const [endDate, setEndDate] = useState(event?.endDate ?? defaultDate);
  const [note, setNote] = useState(event?.note ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (prevEvent !== event || prevDefaultDate !== defaultDate) {
    setPrevEvent(event);
    setPrevDefaultDate(defaultDate);
    setTitle(event?.title ?? "");
    setEventType(event?.eventType ?? "leave");
    setStartDate(event?.startDate ?? defaultDate);
    setEndDate(event?.endDate ?? defaultDate);
    setNote(event?.note ?? "");
    setError(null);
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setError("请填写事件标题");
      return;
    }
    if (!startDate || !endDate) {
      setError("请填写开始和结束日期");
      return;
    }
    if (endDate < startDate) {
      setError("结束日期不能早于开始日期");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        id: event?.id,
        title: trimmed,
        eventType,
        startDate,
        endDate,
        note: note.trim() || null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const isEditing = Boolean(event);

  return (
    <DialogShell
      title={isEditing ? "编辑日程事件" : "新建日程事件"}
      icon={CalendarDays}
      presence={presence}
      onClose={onClose}
      width="440px"
    >
      <form onSubmit={handleSubmit} className="dialog-form">
        {error && <div className="dialog-error-msg">{error}</div>}

        <div className="form-field">
          <label>事件类型</label>
          <SegmentedControl
            value={eventType}
            onChange={setEventType}
            ariaLabel="事件类型"
            options={[
              {
                value: "leave",
                label: calendarEventTypeCopy.leave.label,
                color: calendarEventTypeCopy.leave.color,
                icon: Sun,
              },
              {
                value: "trip",
                label: calendarEventTypeCopy.trip.label,
                color: calendarEventTypeCopy.trip.color,
                icon: Plane,
              },
            ]}
          />
        </div>

        <div className="form-field">
          <label htmlFor="event-title-input">标题</label>
          <input
            id="event-title-input"
            type="text"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (error) setError(null);
            }}
            placeholder="标题"
            autoFocus
            maxLength={40}
          />
        </div>

        <div className="form-grid">
          <div className="form-field">
            <label htmlFor="event-start-date">开始日期</label>
            <input
              id="event-start-date"
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                if (error) setError(null);
              }}
            />
          </div>
          <div className="form-field">
            <label htmlFor="event-end-date">结束日期</label>
            <input
              id="event-end-date"
              type="date"
              value={endDate}
              min={startDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                if (error) setError(null);
              }}
            />
          </div>
        </div>

        <div className="form-field">
          <label htmlFor="event-note-input">备注</label>
          <input
            id="event-note-input"
            type="text"
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              if (error) setError(null);
            }}
            placeholder="备注"
            maxLength={100}
          />
        </div>

        <DialogFooter
          onCancel={onClose}
          submitLabel={
            submitting ? "保存中..." : isEditing ? "完成修改" : "创建事件"
          }
        />
        {isEditing && event && (
          <button
            type="button"
            className="btn-danger dialog-delete-btn"
            onClick={() => onDelete?.(event)}
          >
            删除事件
          </button>
        )}
      </form>
    </DialogShell>
  );
}
