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

/** F2 · T-10 甲组：通知门控（总开关 + 提示音）。 */
export interface ReminderGate {
  notificationsEnabled: boolean;
  notificationSound: "system" | "silent";
}

const NOTIFICATION_TITLE = "⏰ 任务即将到期";

function reminderBody(title: string, dueAt: string | null): string {
  return dueAt ? `「${title}」即将到期` : `「${title}」已到期`;
}

// 移动端：Android WebView 无 Web Notification API，走原生通知通道。
// Android 13+ 需先授权 POST_NOTIFICATIONS（插件已自带权限声明）。
// 提示音的静音语义由桌面 Web Notification 落地；插件通道仅门控发送与否。
async function sendMobileNotification(
  body: string,
  gate: ReminderGate,
): Promise<void> {
  if (!gate.notificationsEnabled) return;
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
function showWebNotification(body: string, gate: ReminderGate): void {
  if (!gate.notificationsEnabled) return;
  if (!("Notification" in window)) return;
  const options: NotificationOptions & { silent?: boolean } = {
    body,
    silent: gate.notificationSound === "silent",
  };
  if (Notification.permission === "granted") {
    new Notification(NOTIFICATION_TITLE, options);
  } else if (Notification.permission !== "denied") {
    Notification.requestPermission().then((permission) => {
      if (permission === "granted") {
        new Notification(NOTIFICATION_TITLE, options);
      }
    });
  }
}

export function useTaskReminder(
  onReminder: ((event: ReminderEvent) => void) | undefined,
  { notificationsEnabled, notificationSound }: ReminderGate,
): void {
  useEffect(() => {
    if (!isTauri()) return;

    let cancelled = false;
    let unlisten: (() => void) | undefined;

    const gate: ReminderGate = { notificationsEnabled, notificationSound };
    void listen<ReminderEvent>("task-reminder", (event) => {
      const { title, dueAt } = event.payload;
      const body = reminderBody(title, dueAt);
      onReminder?.(event.payload);
      if (isMobile()) {
        void sendMobileNotification(body, gate);
      } else {
        showWebNotification(body, gate);
      }
    }).then((nextUnlisten) => {
      if (cancelled) nextUnlisten();
      else unlisten = nextUnlisten;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
    // gate 字段变化时重挂监听以取到最新门控（监听本身幂等，代价可忽略）
  }, [onReminder, notificationsEnabled, notificationSound]);
}
