/**
 * mobile/parts/sheets.tsx — 移动端底部浮层（M-B 预置 M-C 体系）
 * 语义对齐 `设计稿/phone/js/core/sheet.js`：
 *  - ActionSheet：操作菜单（items: label/icon/danger/onSelect）
 *  - ConfirmSheet：居中确认（Promise<bool>）
 * 结构复用 openSheet 的 scrim + 底部 Sheet 骨架；下拉关闭手柄后续批次补。
 */
import { useEffect, type JSX, type ReactNode } from "react";
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
  const pick = (item: SheetActionItem) => {
    onClose();
    item.onSelect();
  };
  return (
    <div
      className="m-scrim m-scrim-open"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
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
        <button type="button" className="m-sheet-cancel" onClick={onClose}>
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
  return (
    <div
      className="m-scrim m-scrim-open"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="m-modal" role="alertdialog" aria-modal="true">
        <div className="m-modal-title">{title}</div>
        {body ? <div className="m-modal-body">{body}</div> : null}
        <div className="m-modal-actions">
          <button type="button" className="m-modal-btn" onClick={onCancel}>
            {cancelText}
          </button>
          <button
            type="button"
            className={`m-modal-btn primary ${danger ? "danger" : ""}`}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
        <button
          type="button"
          className="m-modal-close"
          aria-label="关闭"
          onClick={onCancel}
        >
          <X aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
