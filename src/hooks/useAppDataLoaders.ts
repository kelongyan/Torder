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
  /**
   * 重拉循环规则。**返回本次加载到的规则**：调用方若在 await 之后立刻要按
   * `recurringRuleId` 查规则，不能读 `recurringRules` state——setState 的重渲染
   * 是异步调度的，await 回来时组件可能仍是旧规则（便签右键「编辑循环规则」
   * 曾因此把既有规则误判为「无规则」而弹成新建）。取返回值即所见即所得。
   */
  loadRecurringRules: () => Promise<RecurringRule[]>;
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
      const rules = await listRecurringRules();
      setRecurringRules(rules);
      return rules;
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
