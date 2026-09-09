import { useEffect, useRef, useState } from "react";
import {
  ArrowUpCircle,
  CheckCircle2,
  Download,
  ExternalLink,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import type { PresencePhase } from "../../hooks/usePresence";
import {
  downloadUpdate,
  launchInstallerAndExit,
  openDownloadPage,
  type DownloadProgress,
} from "../../services/appService";
import type { UpdateInfo } from "../../types/settings";
import type { ToastKind } from "../../types/ui";

type UpdateStep = "ready" | "downloading" | "ready_to_install" | "error";

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatSpeed(bps: number): string {
  if (bps <= 0) return "0 B/s";
  return `${formatBytes(bps)}/s`;
}

export function UpdateDialog({
  updateInfo,
  currentVersion,
  presence,
  onClose,
  onToast,
}: {
  updateInfo: UpdateInfo | null;
  currentVersion: string;
  presence: PresencePhase;
  onClose: () => void;
  onToast?: (message: string, kind: ToastKind) => void;
}) {
  const [step, setStep] = useState<UpdateStep>("ready");
  const [progress, setProgress] = useState<DownloadProgress>({
    downloadedBytes: 0,
    totalBytes: 0,
    percentage: 0,
    speedBps: 0,
  });
  const [installerPath, setInstallerPath] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const cancelRef = useRef(false);

  // 当外部换了更新信息，重置内部状态
  useEffect(() => {
    setStep("ready");
    setProgress({
      downloadedBytes: 0,
      totalBytes: 0,
      percentage: 0,
      speedBps: 0,
    });
    setInstallerPath(null);
    setErrorMsg(null);
    cancelRef.current = false;
  }, [updateInfo?.latestVersion]);

  if (!updateInfo) return null;

  async function handleStartDownload() {
    if (!updateInfo) return;
    cancelRef.current = false;
    setStep("downloading");
    setErrorMsg(null);

    try {
      const path = await downloadUpdate(
        updateInfo.downloadUrl,
        updateInfo.sha256,
        (p) => {
          if (!cancelRef.current) {
            setProgress(p);
          }
        },
      );

      if (cancelRef.current) return;
      setInstallerPath(path);
      setStep("ready_to_install");
      onToast?.("更新包已就绪，可立即安装并重启", "success");
    } catch (err) {
      if (cancelRef.current) return;
      setStep("error");
      setErrorMsg(String(err));
      onToast?.(`下载更新失败: ${String(err)}`, "error");
    }
  }

  function handleCancelDownload() {
    cancelRef.current = true;
    setStep("ready");
    onToast?.("已取消下载更新", "info");
  }

  async function handleInstallAndRestart() {
    if (!installerPath) return;
    try {
      await launchInstallerAndExit(installerPath);
    } catch (err) {
      onToast?.(`启动安装程序失败: ${String(err)}`, "error");
    }
  }

  return (
    <div
      className={`dialog-overlay ${presence === "exit" ? "is-exiting" : "is-entering"}`}
      role="presentation"
    >
      <section
        className="dialog-card update-dialog-card"
        role="dialog"
        aria-modal="true"
        aria-label="软件更新"
      >
        <header className="dialog-header">
          <span className="dialog-icon update-dialog-icon">
            <Sparkles aria-hidden="true" />
          </span>
          <div>
            <h2>发现新版本 v{updateInfo.latestVersion}</h2>
            <p>当前版本 v{currentVersion}</p>
          </div>
          <button
            type="button"
            className="icon-button"
            disabled={step === "downloading"}
            onClick={onClose}
            aria-label="关闭"
          >
            <X aria-hidden="true" />
          </button>
        </header>

        <div className="dialog-body update-dialog-body">
          {updateInfo.notes && (
            <div className="update-notes-section">
              <span className="update-section-label">更新内容：</span>
              <div className="update-notes-box">
                {updateInfo.notes.split("\n").map((line, idx) => (
                  <p key={idx}>{line}</p>
                ))}
              </div>
            </div>
          )}

          {step === "downloading" && (
            <div className="update-progress-card">
              <div className="update-progress-head">
                <span className="update-progress-title">
                  正在下载更新安装包…
                </span>
                <span className="update-progress-percent">
                  {progress.percentage.toFixed(0)}%
                </span>
              </div>
              <div className="update-progress-bar-wrap">
                <div
                  className="update-progress-bar-fill"
                  style={{ width: `${Math.min(100, Math.max(0, progress.percentage))}%` }}
                />
              </div>
              <div className="update-progress-foot">
                <span>
                  {formatBytes(progress.downloadedBytes)}
                  {progress.totalBytes > 0 && ` / ${formatBytes(progress.totalBytes)}`}
                </span>
                <span>{formatSpeed(progress.speedBps)}</span>
              </div>
            </div>
          )}

          {step === "ready_to_install" && (
            <div className="update-status-banner success">
              <CheckCircle2 size={16} />
              <span>安装包下载完毕并通过完整性校验，点击下方按钮立即安装并重启。</span>
            </div>
          )}

          {step === "error" && (
            <div className="update-status-banner danger">
              <span>{errorMsg || "下载过程中遇到网络问题，请重试或通过浏览器下载。"}</span>
            </div>
          )}
        </div>

        <footer className="dialog-footer update-dialog-footer">
          <div className="update-footer-left">
            <button
              type="button"
              className="update-link-btn"
              onClick={() => void openDownloadPage(updateInfo.downloadUrl)}
            >
              <ExternalLink size={12} />
              <span>浏览器下载</span>
            </button>
          </div>

          <div className="update-footer-actions">
            {step === "ready" && (
              <>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={onClose}
                >
                  稍后提醒
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void handleStartDownload()}
                >
                  <Download size={14} />
                  <span>立即更新</span>
                </button>
              </>
            )}

            {step === "downloading" && (
              <>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleCancelDownload}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled
                >
                  <RefreshCw size={14} className="is-spinning" />
                  <span>下载中…</span>
                </button>
              </>
            )}

            {step === "ready_to_install" && (
              <>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={onClose}
                >
                  稍后安装
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void handleInstallAndRestart()}
                >
                  <ArrowUpCircle size={14} />
                  <span>立即安装并重启</span>
                </button>
              </>
            )}

            {step === "error" && (
              <>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={onClose}
                >
                  关闭
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void handleStartDownload()}
                >
                  <RefreshCw size={14} />
                  <span>重试下载</span>
                </button>
              </>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}
