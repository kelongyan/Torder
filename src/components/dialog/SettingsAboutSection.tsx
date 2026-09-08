import { useEffect, useState } from "react";
import { ExternalLink, Info, RefreshCw } from "lucide-react";
import type { ToastKind } from "../../types/ui";
import { isMobile } from "../../utils/platform";
import {
  checkForUpdate,
  getAppInfo,
  openDownloadPage,
} from "../../services/appService";
import type { AppInfo, UpdateInfo } from "../../types/settings";

type UpdateState =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "none" }
  | { state: "found"; info: UpdateInfo }
  | { state: "error"; message: string };

export function SettingsAboutSection({
  onToast,
}: {
  onToast: (message: string, type: ToastKind) => void;
}) {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [updateState, setUpdateState] = useState<UpdateState>({
    state: "idle",
  });

  useEffect(() => {
    let cancelled = false;
    void getAppInfo()
      .then((info) => {
        if (!cancelled) setAppInfo(info);
      })
      .catch(() => {
        if (!cancelled) setAppInfo(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCheckUpdate() {
    setUpdateState({ state: "checking" });
    try {
      const info = await checkForUpdate();
      setUpdateState(
        info.hasUpdate ? { state: "found", info } : { state: "none" },
      );
      onToast(
        info.hasUpdate
          ? `发现新版本 v${info.latestVersion}`
          : "当前已是最新版本",
        info.hasUpdate ? "info" : "success",
      );
    } catch (error) {
      setUpdateState({ state: "error", message: String(error) });
      onToast(`检查失败: ${String(error)}`, "error");
    }
  }

  async function handleOpenDownload(info: UpdateInfo) {
    try {
      await openDownloadPage(info.downloadUrl);
    } catch (error) {
      onToast(`打开下载页失败: ${String(error)}`, "error");
    }
  }

  return (
    <section className="settings-section">
      <h3 className="settings-section-title">
        <Info aria-hidden="true" className="icon-sm" />
        关于
      </h3>
      <div className="settings-row settings-action-row">
        <span className="settings-version">
          {appInfo ? `当前版本 v${appInfo.version}` : ""}
        </span>
        {!isMobile() && (
          <button
            type="button"
            className="btn-secondary"
            disabled={updateState.state === "checking"}
            onClick={() => void handleCheckUpdate()}
          >
            <RefreshCw
              aria-hidden="true"
              className={`icon-sm ${
                updateState.state === "checking" ? "is-spinning" : ""
              }`}
            />
            {updateState.state === "checking" ? "检查中…" : "检查更新"}
          </button>
        )}
      </div>
      {!isMobile() && updateState.state === "none" && (
        <p className="settings-status-note success">当前已是最新版本。</p>
      )}
      {!isMobile() && updateState.state === "found" && (
        <div className="settings-update-card">
          <div className="settings-list-label">
            发现新版本 v{updateState.info.latestVersion}
          </div>
          {updateState.info.notes && (
            <p className="settings-update-notes">{updateState.info.notes}</p>
          )}
          <button
            type="button"
            className="btn-primary btn-sm"
            onClick={() => void handleOpenDownload(updateState.info)}
          >
            <ExternalLink aria-hidden="true" className="icon-xs" />
            打开下载页
          </button>
        </div>
      )}
      {!isMobile() && updateState.state === "error" && (
        <p className="settings-status-note danger">
          检查失败（{updateState.message}）。
        </p>
      )}
    </section>
  );
}
