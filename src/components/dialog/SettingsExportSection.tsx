import { useState } from "react";
import { Download, FileJson, FileText, Table2 } from "lucide-react";
import type { ToastKind } from "../../types/ui";
import { Select, type SelectOption } from "../common/Select";
import { exportTasks, type ExportFormat } from "../../services/backupService";

const exportFormatOptions: SelectOption<ExportFormat>[] = [
  { value: "json", label: "JSON", icon: FileJson },
  { value: "markdown", label: "Markdown", icon: FileText },
  { value: "csv", label: "CSV", icon: Table2 },
];

const exportDoneCopy: Record<ExportFormat, string> = {
  json: "已导出 JSON",
  markdown: "已导出 Markdown",
  csv: "已导出 CSV",
};

export function SettingsExportSection({
  onToast,
}: {
  onToast: (message: string, type: ToastKind) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("json");

  async function handleExport(format: ExportFormat) {
    setBusy(true);
    try {
      await exportTasks(format);
      onToast(exportDoneCopy[format], "success");
    } catch (error) {
      onToast(`导出失败: ${String(error)}`, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-section">
      <h3 className="settings-section-title">
        <Download aria-hidden="true" className="icon-sm" />
        导出
      </h3>
      <div className="settings-export-panel">
        <span className="settings-export-label">导出格式</span>
        <div className="settings-export-control">
          <Select<ExportFormat>
            value={exportFormat}
            options={exportFormatOptions}
            onChange={setExportFormat}
            ariaLabel="选择导出格式"
            className="settings-export-select"
            disabled={busy}
          />
          <button
            type="button"
            className="btn-primary settings-export-btn"
            disabled={busy}
            onClick={() => void handleExport(exportFormat)}
          >
            <Download aria-hidden="true" className="icon-sm" />
            导出
          </button>
        </div>
      </div>
    </section>
  );
}
