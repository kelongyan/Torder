import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface ReminderEvent {
  taskId: string;
  title: string;
  dueAt: string | null;
}

export function useTaskReminder() {
  useEffect(() => {
    if (!isTauri()) return;

    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void listen<ReminderEvent>("task-reminder", (event) => {
      const { title, dueAt } = event.payload;
      const body = dueAt
        ? `「${title}」即将到期`
        : `「${title}」已到期`;

      if ("Notification" in window) {
        if (Notification.permission === "granted") {
          new Notification("⏰ 任务即将到期", { body });
        } else if (Notification.permission !== "denied") {
          Notification.requestPermission().then((permission) => {
            if (permission === "granted") {
              new Notification("⏰ 任务即将到期", { body });
            }
          });
        }
      }
    }).then((nextUnlisten) => {
      if (cancelled) nextUnlisten();
      else unlisten = nextUnlisten;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
