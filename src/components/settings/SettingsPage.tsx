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
}> = [
  {
    value: "system",
    label: "跟随系统",
    description: "随 Windows 外观自动切换",
    icon: Laptop,
  },
  { value: "light", label: "浅色", description: "始终使用明亮界面", icon: Sun },
  { value: "dark", label: "深色", description: "始终使用深色界面", icon: Moon },
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
    <div className="mx-auto max-w-5xl px-5 py-6 sm:px-8 lg:px-10 lg:py-10">
      <header>
        <p className="font-mono text-xs tracking-[0.16em] text-emerald-900 uppercase dark:text-emerald-400">
          偏好设置
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          设置
        </h1>
        <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
          管理外观、默认行为和本地数据。
        </p>
      </header>

      {feedback && (
        <div
          role={feedback.type === "error" ? "alert" : "status"}
          className={`mt-6 rounded-xl border px-4 py-3 text-sm ${
            feedback.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
              : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
          }`}
        >
          {feedback.message}
        </div>
      )}

      <div className="mt-8 space-y-6">
        <SettingsSection
          title="外观"
          description="主题会立即生效，并保存到本地数据库。"
        >
          <div className="grid gap-3 sm:grid-cols-3">
            {themes.map(({ value, label, description, icon: Icon }) => {
              const selected = settings.theme === value;
              return (
                <button
                  key={value}
                  type="button"
                  disabled={busy}
                  onClick={() => void updateSetting("theme", value)}
                  aria-pressed={selected}
                  className={`relative rounded-xl border p-4 text-left transition ${
                    selected
                      ? "border-emerald-800 bg-emerald-50 text-emerald-950 dark:border-emerald-500 dark:bg-emerald-950/40 dark:text-emerald-100"
                      : "border-stone-200 bg-white text-stone-700 hover:border-stone-300 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:border-stone-600"
                  }`}
                >
                  <Icon aria-hidden="true" className="size-5" />
                  <span className="mt-4 block text-sm font-semibold">
                    {label}
                  </span>
                  <span className="mt-1 block text-xs text-stone-500 dark:text-stone-400">
                    {description}
                  </span>
                  {selected && (
                    <Check
                      aria-hidden="true"
                      className="absolute top-3 right-3 size-4 text-emerald-800 dark:text-emerald-400"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </SettingsSection>

        <SettingsSection
          title="默认行为"
          description="这些选项将在下次启动或后续提醒流程中使用。"
        >
          <div className="divide-y divide-stone-200 dark:divide-stone-800">
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
                className="field-control max-w-48"
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
              description="阶段 7 创建提醒时使用的默认提前量"
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
                className="field-control max-w-48"
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
                className={`relative h-7 w-12 rounded-full transition ${
                  settings.launchAtStartup
                    ? "bg-emerald-800 dark:bg-emerald-600"
                    : "bg-stone-300 dark:bg-stone-700"
                }`}
              >
                <span
                  className={`absolute top-1 size-5 rounded-full bg-white shadow transition ${
                    settings.launchAtStartup ? "left-6" : "left-1"
                  }`}
                />
              </button>
            </SettingRow>
          </div>
        </SettingsSection>

        <SettingsSection
          title="本地数据"
          description="备份包含任务、清单、标签、关联关系和设置。"
        >
          <div className="rounded-xl border border-stone-200 bg-stone-50 p-4 dark:border-stone-700 dark:bg-stone-950/60">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-stone-500 shadow-sm dark:bg-stone-900 dark:text-stone-400">
                <Database aria-hidden="true" className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">数据存储位置</p>
                <p className="mt-1 break-all font-mono text-xs text-stone-500 dark:text-stone-400">
                  {databaseStatus?.databasePath ?? "正在读取…"}
                </p>
                {databaseStatus && (
                  <p className="mt-2 text-xs text-stone-400">
                    schema v{databaseStatus.schemaVersion} ·{" "}
                    {databaseStatus.taskCount} 条任务 ·{" "}
                    {databaseStatus.listCount} 个清单
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleExport()}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-900 px-4 text-sm font-semibold text-white hover:bg-emerald-950 disabled:opacity-50 dark:bg-emerald-700 dark:hover:bg-emerald-600"
            >
              <Download aria-hidden="true" className="size-4" />
              导出 JSON 备份
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleChooseImport()}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-stone-200 bg-white px-4 text-sm font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800"
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
              className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"
            >
              <div className="flex items-start gap-3">
                <RotateCcw
                  aria-hidden="true"
                  className="mt-0.5 size-5 shrink-0"
                />
                <div>
                  <p className="text-sm font-semibold">确认整体恢复？</p>
                  <p className="mt-1 text-xs leading-5">
                    {pendingImport.source.name} ·{" "}
                    {pendingImport.preview.taskCount} 条任务 ·{" "}
                    {pendingImport.preview.listCount} 个清单 ·{" "}
                    {pendingImport.preview.tagCount} 个标签
                  </p>
                  <p className="mt-2 text-xs leading-5">
                    当前数据会在单个事务中被完整替换；任何一步失败都会保留原数据。
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleRestore()}
                      className="rounded-lg bg-amber-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50 dark:bg-amber-700"
                    >
                      确认恢复
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setPendingImport(null)}
                      className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-medium dark:border-amber-800 dark:bg-stone-900"
                    >
                      取消
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </SettingsSection>

        <SettingsSection title="关于" description="本地优先，不上传任务内容。">
          <div className="mb-5 flex items-center gap-3 rounded-xl border border-stone-200 bg-stone-50 p-4 dark:border-stone-700 dark:bg-stone-950/60">
            <img
              src={torderLogo}
              alt=""
              aria-hidden="true"
              className="size-12 shrink-0 rounded-2xl shadow-sm shadow-stone-900/10 dark:shadow-black/30"
            />
            <div>
              <p className="text-lg font-semibold">今序</p>
              <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
                让今天的任务更有顺序。
              </p>
            </div>
          </div>
          <dl className="grid gap-4 text-sm sm:grid-cols-3">
            <InfoItem label="应用" value={appInfo?.name ?? "Torder（今序）"} />
            <InfoItem label="版本" value={appInfo?.version ?? "读取中"} />
            <InfoItem label="平台" value={formatPlatform(appInfo?.platform)} />
          </dl>
        </SettingsSection>
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
    <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm shadow-stone-900/3 dark:border-stone-800 dark:bg-stone-900 dark:shadow-black/10 sm:p-6">
      <h2 className="font-serif text-xl font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
        {description}
      </p>
      <div className="mt-5">{children}</div>
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
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
          {description}
        </p>
      </div>
      {children}
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-stone-400">{label}</dt>
      <dd className="mt-1 font-medium">{value}</dd>
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
