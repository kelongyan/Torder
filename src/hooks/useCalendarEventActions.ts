import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { CalendarEvent } from "../types/database";
import type { ConfirmState, ToastAction, ToastKind } from "../types/ui";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  listCalendarEvents,
  updateCalendarEvent,
} from "../services/calendarEventService";

/**
 * P1-05：日历事件（日程）的新建/更新/删除动作，从 App.tsx 提取。
 * store 之外的数据由调用方持有（setCalendarEvents），保持无循环依赖。
 */
export interface CalendarEventActionsDeps {
  /** useAppDataLoaders 的 setter：直接以新数组替换，不是 Dispatch。 */
  setCalendarEvents: (events: CalendarEvent[]) => void;
  setCalendarEventDialogOpen: (open: boolean) => void;
  setConfirmState: Dispatch<SetStateAction<ConfirmState | null>>;
  pushToast: (
    message: string,
    type: ToastKind,
    action?: ToastAction | ToastAction[],
  ) => void;
}

export interface CalendarEventInput {
  id?: string;
  title: string;
  eventType: CalendarEvent["eventType"];
  startDate: string;
  endDate: string;
  note: string | null;
}

export function useCalendarEventActions({
  setCalendarEvents,
  setCalendarEventDialogOpen,
  setConfirmState,
  pushToast,
}: CalendarEventActionsDeps) {
  const handleSaveCalendarEvent = useCallback(
    async (data: CalendarEventInput) => {
      if (data.id) {
        await updateCalendarEvent({ ...data, id: data.id });
        pushToast("日程事件已更新", "success");
      } else {
        await createCalendarEvent(data);
        pushToast("日程事件已创建", "success");
      }
      setCalendarEvents(await listCalendarEvents());
      setCalendarEventDialogOpen(false);
    },
    [pushToast, setCalendarEventDialogOpen, setCalendarEvents],
  );

  const requestDeleteCalendarEvent = useCallback(
    (event: CalendarEvent) => {
      setCalendarEventDialogOpen(false);
      setConfirmState({
        title: "确认删除日程事件",
        body: `删除“${event.title}”？不可撤销。`,
        confirmText: "删除",
        danger: true,
        onConfirm: async () => {
          await deleteCalendarEvent(event.id);
          setCalendarEvents(await listCalendarEvents());
          setConfirmState(null);
          pushToast("日程事件已删除", "info");
        },
      });
    },
    [pushToast, setCalendarEventDialogOpen, setCalendarEvents, setConfirmState],
  );

  return { handleSaveCalendarEvent, requestDeleteCalendarEvent };
}
