import { Plus } from "lucide-react";

export function TaskQuickAdd({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="quick-add" onClick={onClick}>
      <Plus aria-hidden="true" className="icon-sm" />
      <span>添加新任务...</span>
      <kbd>Ctrl+N</kbd>
    </button>
  );
}
