import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { isMobile } from "../utils/platform";

interface ReminderEvent {
  taskId: string;
  title: string;
  dueAt: string | null;
}

const NOTIFICATION_TITLE = "⏰ 任务即将到期";

function reminderBody(title: string, dueAt: string | null): string {
  return dueAt ? `「${title}」即将到期` : `「${title}」已到期`;
}

// 移动端：Android WebView 无 Web Notification API，走原生通知通道。
// Android 13+ 需先授权 POST_NOTIFICATIONS（插件已自带权限声明）。
async function sendMobileNotification(body: string) {
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      const permission = await requestPermission();
      granted = permission === "granted";
    }
    if (granted) {
      sendNotification({ title: NOTIFICATION_TITLE, body });
    }
  } catch (error) {
    console.error("mobile notification failed:", error);
  }
}

// 桌面端：沿用 Web Notification API。
function showWebNotification(body: string) {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") {
    new Notification(NOTIFICATION_TITLE, { body });
  } else if (Notification.permission !== "denied") {
    Notification.requestPermission().then((permission) => {
      if (permission === "granted") {
        new Notification(NOTIFICATION_TITLE, { body });
      }
    });
  }
}

export function useTaskReminder() {
  useEffect(() => {
    if (!isTauri()) return;

    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void listen<ReminderEvent>("task-reminder", (event) => {
      const { title, dueAt } = event.payload;
      const body = reminderBody(title, dueAt);
      if (isMobile()) {
        void sendMobileNotification(body);
      } else {
        showWebNotification(body);
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
