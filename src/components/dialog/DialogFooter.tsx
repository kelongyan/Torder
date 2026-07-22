export function DialogFooter({
  onCancel,
  submitLabel,
}: {
  onCancel: () => void;
  submitLabel: string;
}) {
  return (
    <footer className="dialog-footer">
      <button type="button" className="btn-secondary" onClick={onCancel}>
        取消
      </button>
      <button type="submit" className="btn-primary">
        {submitLabel}
      </button>
    </footer>
  );
}
