import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import {
  Check,
  Database,
  Download,
  Laptop,
  Moon,
  RotateCcw,
  Sun,
  Upload,
} from "lucide-react";
import torderLogo from "../../assets/torder-logo.png";
import {
  chooseBackupForImport,
  exportBackup,
  inspectBrowserBackup,
  restoreBackup,
} from "../../services/backupService";
import type { PendingBackupImport } from "../../types/backup";
import type { DatabaseStatus, TaskView } from "../../types/database";
import type {
  AppInfo,
  AppSettings,
  ThemePreference,
} from "../../types/settings";

interface SettingsPageProps {
  settings: AppSettings;
  appInfo: AppInfo | null;
  databaseStatus: DatabaseStatus | null;
  onSettingChange: (
    key: keyof AppSettings,
    value: AppSettings[keyof AppSettings],
  ) => Promise<void>;
  onRestoreComplete: () => Promise<void>;
}

const themes: Array<{
  value: ThemePreference;
  label: string;
  description: string;
  icon: typeof Sun;
  preview: { bg: string; card: string; accent: string };
}> = [
  {
    value: "system",
    label: "跟随系统",
    description: "随 Windows 外观自动切换",
    icon: Laptop,
    preview: { bg: "#e8ece8", card: "#ffffff", accent: "#0d7a5f" },
  },
  {
    value: "light",
    label: "浅色",
    description: "始终使用明亮界面",
    icon: Sun,
    preview: { bg: "#f0f2f0", card: "#ffffff", accent: "#0d7a5f" },
  },
  {
    value: "dark",
    label: "深色",
    description: "始终使用深色界面",
    icon: Moon,
    preview: { bg: "#12141b", card: "#1e212b", accent: "#34d399" },
  },
];

const viewOptions: Array<{ value: TaskView; label: string }> = [
  { value: "today", label: "今日" },
  { value: "all", label: "全部任务" },
  { value: "completed", label: "已完成" },
  { value: "overdue", label: "过期" },
];

export function SettingsPage({
  settings,
  appInfo,
  databaseStatus,
  onSettingChange,
  onRestoreComplete,
}: SettingsPageProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingImport, setPendingImport] =
    useState<PendingBackupImport | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!pendingImport) return;
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setPendingImport(null);
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [pendingImport]);

  /* Auto-dismiss success feedback */
  useEffect(() => {
    if (!feedback || feedback.type !== "success") return;
    const timer = window.setTimeout(() => setFeedback(null), 3000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  async function updateSetting(
    key: keyof AppSettings,
    value: AppSettings[keyof AppSettings],
  ) {
    setBusy(true);
    setFeedback(null);
    try {
      await onSettingChange(key, value);
      setFeedback({ type: "success", message: "设置已保存" });
    } catch (error) {
      setFeedback({ type: "error", message: normalizeError(error) });
    } finally {
      setBusy(false);
    }
  }

  async function handleExport() {
    setBusy(true);
    setFeedback(null);
    try {
      const result = await exportBackup();
      if (result) {
        setFeedback({
          type: "success",
          message: `已导出 ${result.preview.taskCount} 条任务到 ${result.path}`,
        });
      }
    } catch (error) {
      setFeedback({ type: "error", message: normalizeError(error) });
    } finally {
      setBusy(false);
    }
  }

  async function handleChooseImport() {
    setFeedback(null);
    if (!isTauri()) {
      fileInputRef.current?.click();
      return;
    }
    setBusy(true);
    try {
      setPendingImport(await chooseBackupForImport());
    } catch (error) {
      setFeedback({ type: "error", message: normalizeError(error) });
    } finally {
      setBusy(false);
    }
  }

  async function handleBrowserFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setFeedback(null);
    try {
      setPendingImport(await inspectBrowserBackup(file));
    } catch (error) {
      setFeedback({ type: "error", message: normalizeError(error) });
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleRestore() {
    if (!pendingImport) return;
    setBusy(true);
    setFeedback(null);
    try {
      const result = await restoreBackup(pendingImport.source);
      await onRestoreComplete();
      setPendingImport(null);
      setFeedback({
        type: "success",
        message: `恢复成功：${result.preview.taskCount} 条任务已写入`,
      });
    } catch (error) {
      setFeedback({ type: "error", message: normalizeError(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-5 py-6 sm:px-7 lg:px-10 lg:py-8">
      <header>
        <p className="eyebrow">偏好设置</p>
        <h1 className="page-title mt-1">设置</h1>
        <p className="body-copy mt-1">管理外观、默认行为和本地数据。</p>
      </header>

      {feedback && (
        <div
          role={feedback.type === "error" ? "alert" : "status"}
          className={`mt-4 rounded-[var(--radius-lg)] px-4 py-3 text-sm transition-colors ${
            feedback.type === "success"
              ? "border border-[color-mix(in_srgb,var(--status-success)_30%,transparent)] bg-[var(--status-success-soft)] text-[var(--status-success)]"
              : "border border-[color-mix(in_srgb,var(--status-danger)_30%,transparent)] bg-[var(--status-danger-soft)] text-[var(--status-danger)]"
          }`}
        >
          {feedback.message}
        </div>
      )}

      <div className="mt-5 space-y-4">
        {/* Appearance */}
        <SettingsSection
          title="外观"
          description="主题会立即生效，并保存到本地数据库。"
        >
          <div className="grid gap-2.5 sm:grid-cols-3">
            {themes.map(
              ({ value, label, description, icon: Icon, preview }) => {
                const selected = settings.theme === value;
                return (
                  <button
                    key={value}
                    type="button"
                    disabled={busy}
                    onClick={() => void updateSetting("theme", value)}
                    aria-pressed={selected}
                    className={`glass-button relative rounded-[var(--radius-lg)] p-3.5 text-left transition-all duration-[var(--duration-fast)] ${
                      selected
                        ? "border-[color-mix(in_srgb,var(--accent)_40%,transparent)] bg-[var(--accent-soft)] shadow-[inset_0_1px_0_var(--glass-highlight),0_4px_16px_color-mix(in_srgb,var(--accent)_12%,transparent)]"
                        : "border-[var(--glass-border-muted)] bg-[var(--glass-control)]"
                    }`}
                  >
                    {/* Mini preview */}
                    <span
                      aria-hidden="true"
                      className="mb-3 flex h-10 overflow-hidden rounded-[var(--radius-sm)] border border-black/5 dark:border-white/10"
                    >
                      {value === "system" ? (
                        <>
                          <span
                            className="flex-1"
                            style={{ background: "#f0f2f0" }}
                          >
                            <span
                              className="mx-auto mt-2 block h-3 w-6 rounded-sm"
                              style={{ background: "#ffffff" }}
                            />
                          </span>
                          <span
                            className="flex-1"
                            style={{ background: "#12141b" }}
                          >
                            <span
                              className="mx-auto mt-2 block h-3 w-6 rounded-sm"
                              style={{ background: "#1e212b" }}
                            />
                          </span>
                        </>
                      ) : (
                        <span
                          className="flex-1"
                          style={{ background: preview.bg }}
                        >
                          <span
                            className="mx-auto mt-2 block h-3 w-8 rounded-sm"
                            style={{ background: preview.card }}
                          />
                          <span
                            className="mx-auto mt-1 block h-1.5 w-4 rounded-full"
                            style={{ background: preview.accent }}
                          />
                        </span>
                      )}
                    </span>

                    <span className="flex items-center gap-1.5">
                      <Icon
                        aria-hidden="true"
                        className={`size-3.5 ${selected ? "text-[var(--accent)]" : "text-[var(--text-muted)]"}`}
                      />
                      <span className="text-[13px] font-semibold text-[var(--text-primary)]">
                        {label}
                      </span>
                    </span>
                    <span className="meta-copy mt-0.5 block">
                      {description}
                    </span>
                    {selected && (
                      <Check
                        aria-hidden="true"
                        className="absolute top-2.5 right-2.5 size-3.5 text-[var(--accent)]"
                      />
                    )}
                  </button>
                );
              },
            )}
          </div>
        </SettingsSection>

        {/* Default behavior */}
        <SettingsSection
          title="默认行为"
          description="这些选项将在下次启动或后续提醒流程中使用。"
        >
          <div className="divide-y divide-[var(--glass-border-muted)]">
            <SettingRow
              label="启动默认视图"
              description="应用启动后首先打开的任务视图"
            >
              <select
                aria-label="启动默认视图"
                value={settings.defaultView}
                disabled={busy}
                onChange={(event) =>
                  void updateSetting(
                    "defaultView",
                    event.target.value as TaskView,
                  )
                }
                className="field-control max-w-44"
              >
                {viewOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </SettingRow>

            <SettingRow
              label="默认提醒时间"
              description="创建今日任务时使用的默认提前量"
            >
              <select
                aria-label="默认提醒时间"
                value={settings.defaultReminderMinutes ?? "none"}
                disabled={busy}
                onChange={(event) =>
                  void updateSetting(
                    "defaultReminderMinutes",
                    event.target.value === "none"
                      ? null
                      : Number(event.target.value),
                  )
                }
                className="field-control max-w-44"
              >
                <option value="none">不自动设置</option>
                <option value="0">到期时</option>
                <option value="15">提前 15 分钟</option>
                <option value="30">提前 30 分钟</option>
                <option value="60">提前 1 小时</option>
              </select>
            </SettingRow>

            <SettingRow
              label="开机自动启动"
              description={
                isTauri()
                  ? "登录 Windows 后自动启动 Torder"
                  : "浏览器预览仅模拟此设置"
              }
            >
              <button
                type="button"
                role="switch"
                aria-checked={settings.launchAtStartup}
                aria-label="开机自动启动"
                disabled={busy}
                onClick={() =>
                  void updateSetting(
                    "launchAtStartup",
                    !settings.launchAtStartup,
                  )
                }
                className={`relative h-6 w-11 rounded-full transition-colors duration-[var(--duration-fast)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
                  settings.launchAtStartup
                    ? "bg-[var(--accent)]"
                    : "bg-[var(--glass-control)] border border-[var(--glass-border-muted)]"
                }`}
              >
                <span
                  className={`absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform duration-[var(--duration-fast)] ease-[var(--ease-out-expo)] ${
                    settings.launchAtStartup
                      ? "translate-x-[22px]"
                      : "translate-x-0.5"
                  }`}
                />
              </button>
            </SettingRow>
          </div>
        </SettingsSection>

        {/* Local data + About */}
        <div className="grid gap-4 md:grid-cols-2">
          <SettingsSection
            title="本地数据"
            description="备份包含任务、清单、标签、关联关系和设置。"
          >
            <div className="glass-surface rounded-[var(--radius-lg)] p-3.5">
              <div className="flex items-start gap-3">
                <span className="glass-surface grid size-9 shrink-0 place-items-center rounded-[var(--radius-md)] text-[var(--text-muted)]">
                  <Database aria-hidden="true" className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-[var(--text-primary)]">
                    数据存储位置
                  </p>
                  <p className="meta-copy mt-0.5 break-all font-mono">
                    {databaseStatus?.databasePath ?? "正在读取…"}
                  </p>
                  {databaseStatus && (
                    <p className="meta-copy tabular-nums mt-1.5">
                      schema v{databaseStatus.schemaVersion} ·{" "}
                      {databaseStatus.taskCount} 条任务 ·{" "}
                      {databaseStatus.listCount} 个清单
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2.5">
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleExport()}
                className="btn-primary"
              >
                <Download aria-hidden="true" className="size-4" />
                导出 JSON 备份
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleChooseImport()}
                className="btn-secondary"
              >
                <Upload aria-hidden="true" className="size-4" />
                导入 JSON 备份
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                aria-label="选择备份文件"
                className="sr-only"
                onChange={(event) =>
                  void handleBrowserFile(event.target.files?.[0])
                }
              />
            </div>

            {pendingImport && (
              <div
                role="alertdialog"
                aria-label="确认整体恢复"
                className="mt-3 rounded-[var(--radius-lg)] border border-[color-mix(in_srgb,var(--status-warning)_35%,transparent)] bg-[var(--status-warning-soft)] p-3.5 text-[var(--status-warning)]"
              >
                <div className="flex items-start gap-2.5">
                  <RotateCcw
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0"
                  />
                  <div>
                    <p className="text-[13px] font-semibold">确认整体恢复？</p>
                    <p className="meta-copy mt-1">
                      {pendingImport.source.name} ·{" "}
                      {pendingImport.preview.taskCount} 条任务 ·{" "}
                      {pendingImport.preview.listCount} 个清单 ·{" "}
                      {pendingImport.preview.tagCount} 个标签
                    </p>
                    <p className="meta-copy mt-1.5">
                      当前数据会在单个事务中被完整替换；任何一步失败都会保留原数据。
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleRestore()}
                        className="inline-flex min-h-8 items-center rounded-[var(--radius-sm)] bg-[var(--status-warning)] px-3 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        确认恢复
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setPendingImport(null)}
                        className="btn-secondary min-h-8 px-3 text-xs"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </SettingsSection>

          <SettingsSection
            title="关于"
            description="本地优先，不上传任务内容。"
          >
            <div className="glass-surface flex items-center gap-3 rounded-[var(--radius-lg)] p-3.5">
              <img
                src={torderLogo}
                alt=""
                aria-hidden="true"
                className="size-10 shrink-0 rounded-[var(--radius-md)] shadow-sm shadow-black/10 dark:shadow-black/30"
              />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--text-primary)]">
                  今序{" "}
                  <span className="meta-copy font-normal">
                    v{appInfo?.version ?? "…"}
                  </span>
                </p>
                <p className="meta-copy mt-0.5">
                  {formatPlatform(appInfo?.platform)} · 让今天的任务更有顺序
                </p>
              </div>
            </div>
          </SettingsSection>
        </div>
      </div>
    </div>
  );
}

function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="glass-surface rounded-[var(--radius-xl)] p-4 sm:p-5">
      <h2 className="section-title">{title}</h2>
      <p className="body-copy mt-0.5">{description}</p>
      <div className="mt-3.5">{children}</div>
    </section>
  );
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-[13px] font-medium text-[var(--text-primary)]">
          {label}
        </p>
        <p className="meta-copy mt-0.5">{description}</p>
      </div>
      {children}
    </div>
  );
}

function formatPlatform(platform: string | undefined): string {
  if (platform === "windows") return "Windows";
  if (platform === "browser-preview") return "浏览器预览";
  return platform ?? "读取中";
}

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
