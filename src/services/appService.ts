import { invoke, isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import packageJson from "../../package.json";
import type { AppInfo, UpdateInfo } from "../types/settings";

const UPDATE_MANIFEST_URL = "https://kelongyan.github.io/Torder/latest.json";

export function getAppInfo(): Promise<AppInfo> {
  if (!isTauri()) {
    return Promise.resolve({
      name: "Torder（今序）",
      version: packageJson.version,
      platform: "browser-preview",
    });
  }
  return invoke<AppInfo>("get_app_info");
}

interface UpdateManifest {
  version: string;
  notes?: string | null;
  downloadUrl: string;
  sha256?: string | null;
  platforms?: Partial<Record<string, UpdateTarget>>;
}

interface UpdateTarget {
  version: string;
  notes?: string | null;
  downloadUrl: string;
  sha256?: string | null;
}

// 检查更新走 webview 的 fetch（异步、不阻塞 UI 线程；失败只产生 JS 错误，
// 不会像同步阻塞命令那样卡死或崩溃应用）。AbortController 兜底 10s 超时。
export async function checkForUpdate(): Promise<UpdateInfo> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(UPDATE_MANIFEST_URL, {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`清单请求失败（HTTP ${response.status}）`);
    }
    const manifest = (await response.json()) as UpdateManifest;
    const appInfo = await getAppInfo();
    const target = updateTargetForPlatform(manifest, appInfo.platform);
    return {
      hasUpdate: compareSemver(target.version, appInfo.version) > 0,
      latestVersion: target.version,
      notes: target.notes ?? null,
      downloadUrl: target.downloadUrl,
      sha256: target.sha256 ?? null,
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function openDownloadPage(url: string): Promise<void> {
  if (!isTauri()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  // 跨平台打开外链：桌面用默认浏览器，Android/iOS 用系统 intent
  await openUrl(url);
}

function updateTargetForPlatform(
  manifest: UpdateManifest,
  platform: string,
): UpdateTarget {
  const target = manifest.platforms?.[platform];
  return target ?? manifest;
}

/** 比较 "major.minor.patch" 三段数字；忽略预发布后缀（如 -beta.1）。 */
function compareSemver(left: string, right: string): number {
  const parts = (version: string) =>
    version
      .split(/[-+]/)[0]
      .split(".")
      .map((segment) => Number.parseInt(segment, 10) || 0);
  const leftParts = parts(left);
  const rightParts = parts(right);
  for (
    let index = 0;
    index < Math.max(leftParts.length, rightParts.length);
    index += 1
  ) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;
    if (leftValue !== rightValue) return leftValue - rightValue;
  }
  return 0;
}
