/**
 * mobile/parts/sheets.tsx — 移动端底部浮层（M-B 预置 M-C 体系）
 * 语义对齐 `设计稿/phone/js/core/sheet.js`：
 *  - ActionSheet：操作菜单（items: label/icon/danger/onSelect）
 *  - ConfirmSheet：居中确认（Promise<bool>）
 *  - BottomSheet：通用带进退场过渡的底部抽屉外壳
 * 进退场生命周期闭环：入场平滑上升，退场优雅滑落后卸载。
 */
/* eslint-disable react-refresh/only-export-components */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from "react";
import { X } from "lucide-react";

export interface SheetActionItem {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  onSelect: () => void;
}

function useLockScroll(open: boolean) {
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);
}

/** 拦截关闭以执行退场动画的 hook */
export function useSheetTransition(onClose: () => void, duration = 240) {
  const [exiting, setExiting] = useState(false);
  const closingRef = useRef(false);

  const requestClose = useCallback(
    (afterClose?: () => void) => {
      if (closingRef.current) return;
      closingRef.current = true;
      setExiting(true);
      window.setTimeout(() => {
        onClose();
        afterClose?.();
      }, duration);
    },
    [onClose, duration],
  );

  return { exiting, requestClose };
}

/** 通用底部抽屉外壳（带遮罩与滑入滑出动画闭环） */
export function BottomSheet({
  title,
  children,
  cancelText = "取消",
  onClose,
}: {
  title?: ReactNode;
  children: ReactNode;
  cancelText?: string;
  onClose: () => void;
}): JSX.Element {
  useLockScroll(true);
  const { exiting, requestClose } = useSheetTransition(onClose);

  return (
    <div
      className={`m-scrim ${exiting ? "is-exiting" : ""}`}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div className="m-sheet" role="dialog" aria-modal="true">
        {title ? <div className="m-sheet-title">{title}</div> : null}
        <div className="m-sheet-body">{children}</div>
        <button
          type="button"
          className="m-sheet-cancel"
          onClick={() => requestClose()}
        >
          {cancelText}
        </button>
      </div>
    </div>
  );
}

export function ActionSheet({
  title,
  items,
  onClose,
}: {
  title?: string;
  items: SheetActionItem[];
  onClose: () => void;
}): JSX.Element | null {
  useLockScroll(true);
  const { exiting, requestClose } = useSheetTransition(onClose);

  const pick = (item: SheetActionItem) => {
    requestClose(() => item.onSelect());
  };

  return (
    <div
      className={`m-scrim ${exiting ? "is-exiting" : ""}`}
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div className="m-sheet" role="dialog" aria-modal="true">
        {title ? <div className="m-sheet-title">{title}</div> : null}
        <div className="m-sheet-body">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              className={`m-sheet-action ${item.danger ? "danger" : ""}`}
              onClick={() => pick(item)}
            >
              {item.icon ? (
                <span className="m-sheet-action-icon">{item.icon}</span>
              ) : null}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="m-sheet-cancel"
          onClick={() => requestClose()}
        >
          取消
        </button>
      </div>
    </div>
  );
}

export function ConfirmSheet({
  title,
  body,
  confirmText = "确定",
  cancelText = "取消",
  danger = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  body?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}): JSX.Element {
  useLockScroll(true);
  const { exiting, requestClose } = useSheetTransition(onCancel, 200);

  const handleConfirm = () => {
    requestClose(() => onConfirm());
  };

  return (
    <div
      className={`m-scrim ${exiting ? "is-exiting" : ""}`}
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div className="m-modal" role="alertdialog" aria-modal="true">
        <div className="m-modal-title">{title}</div>
        {body ? <div className="m-modal-body">{body}</div> : null}
        <div className="m-modal-actions">
          <button
            type="button"
            className="m-modal-btn"
            onClick={() => requestClose()}
          >
            {cancelText}
          </button>
          <button
            type="button"
            className={`m-modal-btn primary ${danger ? "danger" : ""}`}
            onClick={handleConfirm}
          >
            {confirmText}
          </button>
        </div>
        <button
          type="button"
          className="m-modal-close"
          aria-label="关闭"
          onClick={() => requestClose()}
        >
          <X aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
