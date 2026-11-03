import { useState } from "react";
import {
  ChevronRight,
  FileText,
  GitBranch,
  MessageSquare,
  ScrollText,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { DialogShell } from "./DialogShell";
import { usePresence } from "../../hooks/usePresence";
import { CHANGELOG, LICENSES } from "../../constants/changelog";
import { openExternalLink } from "../../services/appService";
import type { ToastKind } from "../../types/ui";

type AboutDialog = "changelog" | "licenses" | null;

/**
 * F2 · T-11：关于 pane 的更新日志 / 开源许可入口（原灰显行转正）。
 * 内容为静态数据（constants/changelog.ts），弹层挂在设置对话框之上。
 */
export function SettingsAboutExtras({
  onToast,
}: {
  onToast: (message: string, type: ToastKind) => void;
}) {
  const [requested, setRequested] = useState<AboutDialog>(null);
  const presence = usePresence<Exclude<AboutDialog, null>>(requested, 220);
  const openDialog = presence.value;

  const entries: Array<{
    id: Exclude<AboutDialog, null>;
    label: string;
    icon: LucideIcon;
  }> = [
    { id: "changelog", label: "更新日志", icon: ScrollText },
    { id: "licenses", label: "开源许可", icon: FileText },
  ];

  const externalLinks: Array<{ label: string; url: string; icon: LucideIcon }> =
    [
      {
        label: "GitHub 仓库",
        url: "https://github.com/kelongyan/Torder",
        icon: GitBranch,
      },
      {
        label: "问题反馈",
        url: "https://github.com/kelongyan/Torder/issues",
        icon: MessageSquare,
      },
    ];

  async function handleOpenExternal(url: string) {
    try {
      await openExternalLink(url);
    } catch (error) {
      onToast(`打开链接失败: ${String(error)}`, "error");
    }
  }

  return (
    <section className="settings-section">
      <h3 className="settings-section-title">更多信息</h3>
      {/* 子级入口 = 行 + 尾部 chevron，不再是 5 个 btn-secondary 方框 */}
      {externalLinks.map(({ label, url, icon: Icon }) => (
        <button
          key={url}
          type="button"
          className="settings-row settings-row-nav"
          onClick={() => void handleOpenExternal(url)}
        >
          <span className="settings-row-label settings-row-nav-label">
            <Icon aria-hidden="true" className="icon-sm" />
            {label}
          </span>
          <span className="settings-row-control">
            <ChevronRight aria-hidden="true" className="settings-row-chevron" />
          </span>
        </button>
      ))}
      {entries.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          className="settings-row settings-row-nav"
          onClick={() => setRequested(id)}
        >
          <span className="settings-row-label settings-row-nav-label">
            <Icon aria-hidden="true" className="icon-sm" />
            {label}
          </span>
          <span className="settings-row-control">
            <ChevronRight aria-hidden="true" className="settings-row-chevron" />
          </span>
        </button>
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
              基于以下开源项目构建，许可全文以各官方仓库为准。
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
