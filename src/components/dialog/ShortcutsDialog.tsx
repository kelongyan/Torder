import { Keyboard } from "lucide-react";
import { DialogShell } from "./DialogShell";

export function ShortcutsDialog({
  onClose,
}: {
  onClose: () => void;
}) {
  return (
    <DialogShell
      title="快捷键"
      subtitle="常用操作可以直接从键盘触发"
      icon={Keyboard}
      onClose={onClose}
      width="420px"
    >
      <div className="shortcut-list">
        <ShortcutRow keys="Ctrl+N" label="新建任务" />
        <ShortcutRow keys="Ctrl+Enter" label="提交表单" />
        <ShortcutRow keys="Esc" label="关闭弹窗" />
        <ShortcutRow keys="?" label="快捷键面板" />
        <ShortcutRow keys="B" label="批量选择" />
      </div>
    </DialogShell>
  );
}

function ShortcutRow({ keys, label }: { keys: string; label: string }) {
  return (
    <div className="shortcut-row">
      <kbd>{keys}</kbd>
      <span>{label}</span>
    </div>
  );
}
