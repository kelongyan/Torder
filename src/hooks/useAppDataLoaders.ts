import { useCallback, useEffect, useState } from "react";
import { listCalendarEvents } from "../services/calendarEventService";
import { listRecurringRules } from "../services/recurringService";
import type { CalendarEvent, RecurringRule } from "../types/database";

export interface AppDataLoaders {
  calendarEvents: CalendarEvent[];
  setCalendarEvents: (events: CalendarEvent[]) => void;
  recurringRules: RecurringRule[];
  setRecurringRules: (rules: RecurringRule[]) => void;
  recurringLoading: boolean;
  loadRecurringRules: () => Promise<void>;
}

export function useAppDataLoaders(
  onError: (error: string) => void,
): AppDataLoaders {
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [recurringRules, setRecurringRules] = useState<RecurringRule[]>([]);
  const [recurringLoading, setRecurringLoading] = useState(false);

  const loadRecurringRules = useCallback(async () => {
    setRecurringLoading(true);
    try {
      setRecurringRules(await listRecurringRules());
    } finally {
      setRecurringLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void listCalendarEvents()
      .then((events) => {
        if (!cancelled) setCalendarEvents(events);
      })
      .catch((nextError: unknown) => {
        if (!cancelled) onError(String(nextError));
      });
    return () => {
      cancelled = true;
    };
  }, [onError]);

  useEffect(() => {
    let cancelled = false;
    void listRecurringRules()
      .then((rules) => {
        if (!cancelled) setRecurringRules(rules);
      })
      .catch((nextError: unknown) => {
        if (!cancelled) onError(String(nextError));
      });
    return () => {
      cancelled = true;
    };
  }, [onError]);

  return {
    calendarEvents,
    setCalendarEvents,
    recurringRules,
    setRecurringRules,
    recurringLoading,
    loadRecurringRules,
  };
}
