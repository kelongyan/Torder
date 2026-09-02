import { useState } from "react";
import { FileText, Info, ScrollText } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { DialogShell } from "./DialogShell";
import { usePresence } from "../../hooks/usePresence";
import { CHANGELOG, LICENSES } from "../../constants/changelog";

type AboutDialog = "changelog" | "licenses" | null;

/**
 * F2 · T-11：关于 pane 的更新日志 / 开源许可入口（原灰显行转正）。
 * 内容为静态数据（constants/changelog.ts），弹层挂在设置对话框之上。
 */
export function SettingsAboutExtras() {
  const [requested, setRequested] = useState<AboutDialog>(null);
  const presence = usePresence<Exclude<AboutDialog, null>>(requested, 220);
  const openDialog = presence.value;

  const entries: Array<{ id: Exclude<AboutDialog, null>; label: string; icon: LucideIcon }> = [
    { id: "changelog", label: "更新日志", icon: ScrollText },
    { id: "licenses", label: "开源许可", icon: FileText },
  ];

  return (
    <section className="settings-section">
      <h3 className="settings-section-title">
        <Info aria-hidden="true" className="icon-sm" />
        更多信息
      </h3>
      {entries.map(({ id, label, icon: Icon }) => (
        <div key={id} className="settings-row settings-action-row">
          <span className="settings-version">{label}</span>
          <button
            type="button"
            className="btn-secondary"
            aria-label={`查看${label}`}
            onClick={() => setRequested(id)}
          >
            <Icon aria-hidden="true" className="icon-sm" />
            查看
          </button>
        </div>
      ))}

      {presence.rendered && openDialog === "changelog" && (
        <DialogShell
          title="更新日志"
          icon={ScrollText}
          width="560px"
          presence={presence.phase}
          overlayClassName="settings-subdialog"
          onClose={() => setRequested(null)}
        >
          <div className="changelog-list">
            {CHANGELOG.map((entry) => (
              <article key={entry.version} className="changelog-entry">
                <header>
                  <h4>v{entry.version}</h4>
                  <span>{entry.date}</span>
                </header>
                <ul>
                  {entry.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </DialogShell>
      )}

      {presence.rendered && openDialog === "licenses" && (
        <DialogShell
          title="开源许可"
          icon={FileText}
          width="560px"
          presence={presence.phase}
          overlayClassName="settings-subdialog"
          onClose={() => setRequested(null)}
        >
          <div className="license-list">
            <p className="license-note">
              本应用基于以下开源项目构建，感谢这些项目的作者与社区。许可证全文以各项目官方仓库为准。
            </p>
            {LICENSES.map((item) => (
              <div key={item.name} className="license-row">
                <span className="license-name">{item.name}</span>
                <span className="license-usage">{item.usage}</span>
                <span className="license-type">{item.license}</span>
              </div>
            ))}
          </div>
        </DialogShell>
      )}
    </section>
  );
}
