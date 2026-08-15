import type { CalendarEventType } from "../types/database";

export const calendarEventTypeCopy: Record<
  CalendarEventType,
  { label: string; color: string }
> = {
  leave: { label: "休假", color: "#50fa7b" },
  trip: { label: "出差", color: "#8be9fd" },
};
