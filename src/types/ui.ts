export type ToastKind = "success" | "error" | "info";

export interface ToastMessage {
  id: number;
  type: ToastKind;
  message: string;
  leaving?: boolean;
}

export interface ConfirmState {
  title: string;
  body: string;
  confirmText: string;
  danger?: boolean;
  onConfirm: () => Promise<void>;
}
