import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  CalendarEvent,
  CalendarEventType,
  CreateCalendarEventInput,
  UpdateCalendarEventInput,
} from "../types/database";

function isoDate(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function mockEvent(
  id: string,
  title: string,
  eventType: CalendarEventType,
  startOffset: number,
  endOffset: number,
  note: string | null,
): CalendarEvent {
  const timestamp = new Date().toISOString();
  return {
    id,
    title,
    eventType,
    startDate: isoDate(startOffset),
    endDate: isoDate(endOffset),
    note,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
}

let browserEvents: CalendarEvent[] = [
  mockEvent("mock-leave-1", "领导休假", "leave", 3, 3, "请提前提交审批"),
  mockEvent("mock-trip-1", "领导出差", "trip", 8, 12, "上海客户拜访"),
  mockEvent("mock-other-1", "部门会议", "other", 1, 1, "会议室确认"),
];

export function listCalendarEvents(): Promise<CalendarEvent[]> {
  if (!isTauri()) {
    return Promise.resolve(browserEvents.map((event) => ({ ...event })));
  }
  return invoke<CalendarEvent[]>("list_calendar_events");
}

export async function createCalendarEvent(
  input: CreateCalendarEventInput,
): Promise<CalendarEvent> {
  if (!isTauri()) {
    validateBrowserEventInput(input);
    const timestamp = new Date().toISOString();
    const event: CalendarEvent = {
      id: `event-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title: input.title.trim(),
      eventType: input.eventType,
      startDate: input.startDate,
      endDate: input.endDate,
      note: input.note?.trim() || null,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    };
    browserEvents = [...browserEvents, event].sort(compareEvents);
    return Promise.resolve({ ...event });
  }
  return invoke<CalendarEvent>("create_calendar_event", { input });
}

export async function updateCalendarEvent(
  input: UpdateCalendarEventInput,
): Promise<CalendarEvent> {
  if (!isTauri()) {
    validateBrowserEventInput(input);
    const index = browserEvents.findIndex((event) => event.id === input.id);
    if (index < 0) return Promise.reject(new Error("日程事件不存在"));
    const next: CalendarEvent = {
      ...browserEvents[index],
      title: input.title.trim(),
      eventType: input.eventType,
      startDate: input.startDate,
      endDate: input.endDate,
      note: input.note?.trim() || null,
      updatedAt: new Date().toISOString(),
    };
    browserEvents = browserEvents
      .map((event, eventIndex) => (eventIndex === index ? next : event))
      .sort(compareEvents);
    return Promise.resolve({ ...next });
  }
  return invoke<CalendarEvent>("update_calendar_event", { input });
}

export function deleteCalendarEvent(id: string): Promise<void> {
  if (!isTauri()) {
    const event = browserEvents.find((item) => item.id === id);
    if (!event) return Promise.reject(new Error("日程事件不存在"));
    browserEvents = browserEvents.filter((item) => item.id !== id);
    return Promise.resolve();
  }
  return invoke<void>("delete_calendar_event", { id });
}

function compareEvents(left: CalendarEvent, right: CalendarEvent): number {
  if (left.startDate !== right.startDate)
    return left.startDate.localeCompare(right.startDate);
  return left.createdAt.localeCompare(right.createdAt);
}

/** 镜像 Rust calendar_event_repository::validate_input。 */
function validateBrowserEventInput(input: {
  title: string;
  eventType: CalendarEventType;
  startDate: string;
  endDate: string;
}): void {
  if (!input.title.trim()) throw new Error("日程标题不能为空");
  if (
    input.eventType !== "leave" &&
    input.eventType !== "trip" &&
    input.eventType !== "other"
  ) {
    throw new Error("日程类型必须是 leave、trip 或 other");
  }
  if (!isIsoDate(input.startDate) || !isIsoDate(input.endDate)) {
    throw new Error("日程日期必须是 YYYY-MM-DD 格式");
  }
  if (input.endDate < input.startDate) {
    throw new Error("结束日期不能早于开始日期");
  }
}

/** 与 Rust is_iso_date 一致：严格 YYYY-MM-DD 且是真实存在的日期。 */
function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}
