import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { listCalendarEvents } from "../services/calendarEventService";
import { listLists } from "../services/listService";
import { listRecurringRules } from "../services/recurringService";
import { getSyncStatus, runSync } from "../services/syncService";
import { useTaskStore } from "../stores/taskStore";
import type { CalendarEvent, RecurringRule, TaskList } from "../types/database";
import type { SyncStatus } from "../types/sync";

const MIN_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const RETRY_DELAYS_MS = [60_000, 120_000, 300_000, 900_000, 1_800_000];

export function useSyncLifecycle({
  setLists,
  setRecurringRules,
  setCalendarEvents,
  setAppError,
  autoSyncEnabled,
  wifiOnly,
  onStatusChange,
}: {
  setLists: (lists: TaskList[]) => void;
  setRecurringRules: (rules: RecurringRule[]) => void;
  setCalendarEvents: (events: CalendarEvent[]) => void;
  setAppError: (error: string | null) => void;
  autoSyncEnabled: boolean;
  wifiOnly: boolean;
  onStatusChange: (status: SyncStatus) => void;
}) {
  useEffect(() => {
    if (!isTauri()) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;
    let retryTimer: number | undefined;
    let retryIndex = 0;
    let lastAttemptAt = 0;
    let running: Promise<void> | null = null;

    async function reloadData() {
      const [lists, rules, events] = await Promise.all([
        listLists(),
        listRecurringRules(),
        listCalendarEvents(),
        useTaskStore.getState().loadTasks(),
      ]);
      if (disposed) return;
      setLists(lists);
      setRecurringRules(rules);
      setCalendarEvents(events);
    }

    function shouldStopRetry(error: unknown): boolean {
      const message = String(error);
      return (
        message.includes("HTTP 401") ||
        message.includes("HTTP 403") ||
        message.includes("credential") ||
        message.includes("password is required") ||
        message.includes("revoked") ||
        message.includes("incompatible") ||
        message.includes("invalid remote") ||
        message.includes("invalid sync") ||
        message.includes("unsupported sync") ||
        message.includes("sync payload")
      );
    }

    function scheduleRetry() {
      if (disposed) return;
      window.clearTimeout(retryTimer);
      const delay =
        RETRY_DELAYS_MS[Math.min(retryIndex, RETRY_DELAYS_MS.length - 1)];
      retryIndex += 1;
      retryTimer = window.setTimeout(() => void triggerSync(true), delay);
    }

    async function performSync() {
      const status = await getSyncStatus();
      if (!disposed) onStatusChange(status);
      if (wifiOnly && !isWifiConnection()) return;
      // 注意：不要把 state === "incompatible" 也拦在这里。
      // 远端协议不兼容是可以被客户端升级修好的，一旦持久化的状态永久拦住自动同步，
      // 升级后仍然要用户手动点一次才能恢复。这里放行，由 shouldStopRetry 负责
      // 不做指数退避重试，靠前台/启动/网络恢复这些自然触发点重试即可。
      if (
        !autoSyncEnabled ||
        !status.configured ||
        status.state === "needsAuth" ||
        status.lastError?.includes("revoked")
      )
        return;
      lastAttemptAt = Date.now();
      try {
        await runSync();
        const nextStatus = await getSyncStatus();
        if (!disposed) onStatusChange(nextStatus);
        retryIndex = 0;
        window.clearTimeout(retryTimer);
      } catch (error) {
        void getSyncStatus()
          .then(onStatusChange)
          .catch(() => undefined);
        if (!shouldStopRetry(error)) scheduleRetry();
      }
    }

    function triggerSync(force = false) {
      if (disposed || document.visibilityState !== "visible")
        return Promise.resolve();
      if (!force && Date.now() - lastAttemptAt < MIN_SYNC_INTERVAL_MS) {
        return Promise.resolve();
      }
      if (!running) {
        running = performSync()
          .catch((error) => {
            if (!disposed) setAppError(String(error));
          })
          .finally(() => {
            running = null;
          });
      }
      return running;
    }

    const handleForeground = () => {
      if (document.visibilityState === "visible") void triggerSync();
    };
    const handleNetworkRecovery = () => {
      if (document.visibilityState === "visible") void triggerSync(true);
    };
    const connection = getNetworkConnection();
    connection?.addEventListener("change", handleNetworkRecovery);
    window.addEventListener("online", handleNetworkRecovery);

    void listen("sync-completed", () => {
      void Promise.all([
        reloadData(),
        getSyncStatus().then(onStatusChange),
      ]).catch((error) => {
        if (!disposed) setAppError(String(error));
      });
    }).then((dispose) => {
      if (disposed) dispose();
      else unlisten = dispose;
    });
    document.addEventListener("visibilitychange", handleForeground);
    window.addEventListener("focus", handleForeground);
    const startupTimer = window.setTimeout(() => void triggerSync(), 3_000);
    void getSyncStatus()
      .then(onStatusChange)
      .catch(() => undefined);

    return () => {
      disposed = true;
      unlisten?.();
      document.removeEventListener("visibilitychange", handleForeground);
      window.removeEventListener("focus", handleForeground);
      window.removeEventListener("online", handleNetworkRecovery);
      connection?.removeEventListener("change", handleNetworkRecovery);
      window.clearTimeout(startupTimer);
      window.clearTimeout(retryTimer);
    };
  }, [
    autoSyncEnabled,
    wifiOnly,
    onStatusChange,
    setAppError,
    setCalendarEvents,
    setLists,
    setRecurringRules,
  ]);
}

function isWifiConnection(): boolean {
  const connection = getNetworkConnection();
  if (!connection) return true;
  // Wi-Fi/以太网优先判定：安卓开了「省流量模式」时 saveData 恒为 true，
  // 若先看 saveData 会把 Wi-Fi 下的同步也一并拦掉，表现为「仅 Wi-Fi 同步」永不执行。
  if (connection.type === "wifi" || connection.type === "ethernet") return true;
  if (connection.type) return false;
  // 拿不到 type（桌面 Chromium 不暴露）时保守放行，但尊重省流量模式。
  return !connection.saveData;
}

function getNetworkConnection():
  (EventTarget & { type?: string; saveData?: boolean }) | undefined {
  return (
    navigator as Navigator & {
      connection?: EventTarget & { type?: string; saveData?: boolean };
    }
  ).connection;
}
