import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import packageJson from "../../package.json";
import type { AppInfo, UpdateInfo } from "../types/settings";

const UPDATE_MANIFEST_URL = "https://kelongyan.github.io/Torder/latest.json";

// P0-03：更新清单与外部 URL 是远程信任根，格式异常时必须显式拒绝，
// 不能把未经校验的字符串直接交给 openUrl（避免打开 file://、自定义
// scheme 或钓鱼地址）。https 之外一律拒绝。
const HTTPS_URL_PATTERN = /^https:\/\/\S+$/i;
// 用户自填的外部链接（附件 webLink 等）允许 http，但拒绝其他协议。
const WEB_URL_PATTERN = /^https?:\/\/\S+$/i;
// 版本号：major.minor.patch 三段数字，允许 -预发布 / +构建 后缀（比较时忽略）。
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

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

interface UpdateTarget {
  version: string;
  notes?: string | null;
  downloadUrl: string;
  sha256?: string | null;
}

// 检查更新：Tauri 桌面端走 Rust 原生网络请求（不受 WebView CSP 限制，继承系统代理），
// 浏览器 mock 模式走前端 fetch。
export async function checkForUpdate(): Promise<UpdateInfo> {
  let raw: unknown;
  if (isTauri()) {
    const text = await invoke<string>("fetch_update_manifest");
    raw = JSON.parse(text);
  } else {
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
      raw = await response.json();
    } finally {
      window.clearTimeout(timeout);
    }
  }

  const appInfo = await getAppInfo();
  const target = parseUpdateManifest(raw, appInfo.platform);
  return {
    hasUpdate: compareSemver(target.version, appInfo.version) > 0,
    latestVersion: target.version,
    notes: target.notes ?? null,
    downloadUrl: target.downloadUrl,
    sha256: target.sha256 ?? null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 校验并提取单个平台目标；字段缺失/类型错误时抛出可诊断错误。 */
function parseUpdateTarget(raw: unknown, source: string): UpdateTarget {
  if (!isRecord(raw)) {
    throw new Error(`更新清单格式非法：${source} 不是对象`);
  }
  const { version, notes, downloadUrl, sha256 } = raw;
  if (typeof version !== "string" || !SEMVER_PATTERN.test(version)) {
    throw new Error(
      `更新清单格式非法：${source}.version 无效（${String(version)}）`,
    );
  }
  if (typeof downloadUrl !== "string" || !HTTPS_URL_PATTERN.test(downloadUrl)) {
    throw new Error(
      `更新清单格式非法：${source}.downloadUrl 必须为 https:// 链接`,
    );
  }
  if (notes !== undefined && notes !== null && typeof notes !== "string") {
    throw new Error(`更新清单格式非法：${source}.notes 必须为字符串`);
  }
  if (sha256 !== undefined && sha256 !== null && typeof sha256 !== "string") {
    throw new Error(`更新清单格式非法：${source}.sha256 必须为字符串`);
  }
  return {
    version,
    notes,
    downloadUrl,
    sha256,
  };
}

/**
 * 从原始 JSON 中解析当前平台对应的更新目标。
 *
 * 平台选择规则：清单提供 platforms 且非空时必须包含当前平台键，
 * 缺失视为非法清单（不再回退顶层，避免把平台化清单的顶层元数据
 * 误当作下载目标）；无 platforms 时按平铺结构读取顶层字段。
 */
export function parseUpdateManifest(
  raw: unknown,
  platform: string,
): UpdateTarget {
  if (!isRecord(raw)) {
    throw new Error("更新清单格式非法：根节点不是对象");
  }
  const platforms = raw.platforms;
  if (platforms !== undefined && platforms !== null) {
    if (!isRecord(platforms)) {
      throw new Error("更新清单格式非法：platforms 必须为对象");
    }
    if (Object.keys(platforms).length > 0) {
      if (!(platform in platforms)) {
        throw new Error(`更新清单格式非法：缺少当前平台（${platform}）的目标`);
      }
      return parseUpdateTarget(platforms[platform], `platforms.${platform}`);
    }
  }
  return parseUpdateTarget(raw, "清单顶层");
}

/**
 * 打开更新下载页：仅接受 https:// 链接。清单来源为远程 manifest，
 * 属于远程信任根，即使 schema 校验已通过，打开前仍再次校验（纵深防御）。
 */
export async function openDownloadPage(url: string): Promise<void> {
  if (!HTTPS_URL_PATTERN.test(url)) {
    throw new Error("下载地址必须为 https:// 链接");
  }
  if (!isTauri()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  // 跨平台打开外链：桌面用默认浏览器，Android/iOS 用系统 intent
  await openUrl(url);
}

/**
 * 打开用户自填的外部链接（附件 webLink 等）：允许 http/https，
 * 拒绝 file://、自定义 scheme 等非 Web 协议。内容由用户输入，
 * 与远程清单的 https 强制策略分开控制，避免破坏内网 http 链接。
 */
export async function openExternalLink(url: string): Promise<void> {
  if (!WEB_URL_PATTERN.test(url)) {
    throw new Error("外部链接仅支持 http(s):// 地址");
  }
  if (!isTauri()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  await openUrl(url);
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

export interface DownloadProgress {
  downloadedBytes: number;
  totalBytes: number;
  percentage: number;
  speedBps: number;
}

/**
 * 原生流式下载安装包并校验：Tauri 走 Rust 原生网络栈，
 * 通过 Channel 实时向前端反馈下载进度；mock 模式模拟进度条。
 */
export async function downloadUpdate(
  url: string,
  expectedSha256: string | null,
  onProgress: (progress: DownloadProgress) => void,
): Promise<string> {
  if (!HTTPS_URL_PATTERN.test(url)) {
    throw new Error("下载地址必须为 https:// 链接");
  }

  if (!isTauri()) {
    const total = 17.5 * 1024 * 1024;
    for (let step = 1; step <= 20; step += 1) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      const downloaded = (total * step) / 20;
      onProgress({
        downloadedBytes: downloaded,
        totalBytes: total,
        percentage: step * 5,
        speedBps: 2.8 * 1024 * 1024,
      });
    }
    return "C:\\MockPath\\Torder_update_setup.exe";
  }

  const channel = new Channel<DownloadProgress>();
  channel.onmessage = (progress) => {
    onProgress(progress);
  };

  return invoke<string>("download_update_file", {
    url,
    expectedSha256: expectedSha256 ?? null,
    onProgress: channel,
  });
}

/**
 * 启动已下载的安装程序并退出当前程序，完成自动升级
 */
export async function launchInstallerAndExit(
  installerPath: string,
): Promise<void> {
  if (!isTauri()) {
    return;
  }
  return invoke("launch_installer_and_exit", { installerPath });
}

