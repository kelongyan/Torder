export function DialogFooter({
  onCancel,
  submitLabel,
  submitting = false,
}: {
  onCancel: () => void;
  submitLabel: string;
  submitting?: boolean;
}) {
  return (
    <footer className="dialog-footer">
      <button
        type="button"
        className="btn-secondary"
        disabled={submitting}
        onClick={onCancel}
      >
        取消
      </button>
      <button
        type="submit"
        className="btn-primary"
        disabled={submitting}
        aria-busy={submitting}
      >
        {submitting ? "处理中..." : submitLabel}
      </button>
    </footer>
  );
}
