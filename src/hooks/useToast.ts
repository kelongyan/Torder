import { useCallback, useState } from "react";
import type { ToastAction, ToastKind, ToastMessage } from "../types/ui";

export function useToast() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) =>
      current.map((toast) =>
        toast.id === id ? { ...toast, leaving: true } : toast,
      ),
    );
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 320);
  }, []);

  const pushToast = useCallback(
    (
      message: string,
      type: ToastKind,
      action?: ToastAction | ToastAction[],
    ) => {
      const id = Date.now() + Math.random();
      const actions = Array.isArray(action) ? action : action ? [action] : [];
      setToasts((current) => [
        ...current,
        {
          id,
          type,
          message,
          actionLabel: actions[0]?.label,
          onAction: actions[0]?.onClick,
          actions,
        },
      ]);
      window.setTimeout(
        () => dismissToast(id),
        actions.length > 0 ? 7200 : 2200,
      );
    },
    [dismissToast],
  );

  return { toasts, pushToast };
}
