export type ToastKind = "success" | "error" | "info";

export interface ToastAction {
  label: string;
  onClick: () => void | Promise<void>;
}

export interface ToastMessage {
  id: number;
  type: ToastKind;
  message: string;
  actions: ToastAction[];
  leaving?: boolean;
}

export interface ConfirmState {
  title: string;
  body: string;
  confirmText: string;
  danger?: boolean;
  secondaryText?: string;
  onSecondary?: () => Promise<void>;
  onConfirm: () => Promise<void>;
}
