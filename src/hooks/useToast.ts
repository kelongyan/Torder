import { useCallback, useRef, useState } from "react";
import type { ToastAction, ToastKind, ToastMessage } from "../types/ui";

export function useToast() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const autoDismissTimerRef = useRef<number | null>(null);
  const clearLeavingTimerRef = useRef<number | null>(null);

  const dismissToast = useCallback((id?: number) => {
    if (autoDismissTimerRef.current !== null) {
      window.clearTimeout(autoDismissTimerRef.current);
      autoDismissTimerRef.current = null;
    }
    if (clearLeavingTimerRef.current !== null) {
      window.clearTimeout(clearLeavingTimerRef.current);
      clearLeavingTimerRef.current = null;
    }

    setToasts((current) =>
      current.map((t) =>
        id === undefined || t.id === id ? { ...t, leaving: true } : t,
      ),
    );

    clearLeavingTimerRef.current = window.setTimeout(() => {
      setToasts((current) =>
        id === undefined ? [] : current.filter((t) => t.id !== id),
      );
      clearLeavingTimerRef.current = null;
    }, 220);
  }, []);

  const pushToast = useCallback(
    (
      message: string,
      type: ToastKind,
      action?: ToastAction | ToastAction[],
    ) => {
      if (autoDismissTimerRef.current !== null) {
        window.clearTimeout(autoDismissTimerRef.current);
        autoDismissTimerRef.current = null;
      }
      if (clearLeavingTimerRef.current !== null) {
        window.clearTimeout(clearLeavingTimerRef.current);
        clearLeavingTimerRef.current = null;
      }

      const actions = Array.isArray(action) ? action : action ? [action] : [];
      const newId = Date.now();

      setToasts((current) => {
        const active = current.find((t) => !t.leaving);
        // 如果当前正在展示相同的通知，重用并触发轻微脉冲动效，不重复生成卡片
        if (active && active.message === message && active.type === type) {
          return [
            {
              ...active,
              actions,
              pulseKey: (active.pulseKey ?? 0) + 1,
              leaving: false,
            },
          ];
        }

        // 单实例模式：始终只保留最新的单个气泡，原地平滑接管，杜绝多条气泡堆叠连跳
        return [
          {
            id: newId,
            type,
            message,
            actions,
            leaving: false,
          },
        ];
      });

      // 有可点击操作时给予足够交互时间（4.5s），纯提示类 2.2s 即可
      const duration = actions.length > 0 ? 4500 : 2200;
      autoDismissTimerRef.current = window.setTimeout(() => {
        dismissToast(newId);
      }, duration);
    },
    [dismissToast],
  );

  return { toasts, pushToast, dismissToast };
}
