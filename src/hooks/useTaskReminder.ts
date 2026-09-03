import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface ReminderEvent {
  taskId: string;
  title: string;
  dueAt: string | null;
}

/**
 * 任务提醒事件订阅：仅负责应用内提示（toast/跳转）与 UI 刷新。
 *
 * P0-02：系统通知的唯一权威是 Rust 后台 notifier——原生通知的发送与
 * notificationsEnabled 门控都由后端完成，后端关闭通知时不再 emit 本事件。
 * 前端若在此重复发送系统通知（Web Notification / 插件通道），会造成同一
 * 任务出现两条系统通知，因此此处严禁再接入任何系统通知通道。
 */
export function useTaskReminder(
  onReminder: ((event: ReminderEvent) => void) | undefined,
): void {
  useEffect(() => {
    if (!isTauri()) return;

    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void listen<ReminderEvent>("task-reminder", (event) => {
      onReminder?.(event.payload);
    }).then((nextUnlisten) => {
      if (cancelled) nextUnlisten();
      else unlisten = nextUnlisten;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [onReminder]);
}
