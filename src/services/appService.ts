import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import packageJson from "../../package.json";
import type { AppInfo, UpdateInfo } from "../types/settings";

// 更新源顺序：Gitee 国内直连稳定（服务器在国内，实测 0.2s 级响应），为主源；
// GitHub 兜底——已发布的旧客户端只会查 GitHub，且 Gitee 故障时保持可用。
// 响应结构与 GitHub Releases API 兼容（tag_name / assets[].browser_download_url），
// 同一个解析器两个源通用。
type UpdateSource = "gitee" | "github";

const UPDATE_SOURCE_URLS: Record<UpdateSource, string> = {
  // Gitee 必须用列表接口：它的 /releases/latest 按 release 创建时间取"最新"，
  // 回填历史版本时会把旧版排在前面（v2.7.1 附件后补，创建时间晚于 v2.7.5）。
  // 列表取回后由 pickLatestRelease 按 semver 挑最高的非预发布版本。
  gitee:
    "https://gitee.com/api/v5/repos/yankelong/Torder/releases?per_page=100",
  github: "https://api.github.com/repos/kelongyan/Torder/releases/latest",
};

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
  /** 清单本身无哈希时（Gitee 不提供 digest），随包发布的 .sha256 校验文件地址。 */
  sha256Url?: string | null;
}

interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
  digest?: string | null;
}

// 检查更新：按源顺序尝试（Gitee 主 / GitHub 兜底），任一源成功即返回；
// 全部失败时抛出最后一个源的原始错误。Tauri 端走 Rust 原生网络请求
// （不受 WebView CSP 限制，双路网络回退），浏览器 mock 模式走前端 fetch。
export async function checkForUpdate(): Promise<UpdateInfo> {
  const appInfo = await getAppInfo();
  const platform =
    appInfo.platform === "browser-preview" ? "windows" : appInfo.platform;
  let lastError: unknown = null;
  for (const source of Object.keys(UPDATE_SOURCE_URLS) as UpdateSource[]) {
    try {
      const raw = pickLatestRelease(await fetchUpdateSource(source));
      const target = parseUpdateManifest(raw, platform);
      const sha256 = await resolveSha256(target);
      return {
        hasUpdate: compareSemver(target.version, appInfo.version) > 0,
        latestVersion: target.version,
        notes: target.notes ?? null,
        downloadUrl: target.downloadUrl,
        sha256: sha256 ?? null,
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`检查更新失败：${String(lastError)}`);
}

async function fetchUpdateSource(source: UpdateSource): Promise<unknown> {
  if (isTauri()) {
    const text = await invoke<string>("fetch_update_manifest", { source });
    return JSON.parse(text);
  }
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(UPDATE_SOURCE_URLS[source], {
      signal: controller.signal,
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`清单请求失败（HTTP ${response.status}）`);
    }
    return await response.json();
  } finally {
    window.clearTimeout(timeout);
  }
}

/**
 * 列表型响应（Gitee /releases）归一化为单个 Release：过滤预发布后按
 * semver 取最高版本。平台的 latest 语义不可靠（Gitee 按创建时间排序），
 * 客户端自己挑版本才是稳定语义。单对象响应（GitHub /releases/latest）原样通过。
 */
export function pickLatestRelease(raw: unknown): unknown {
  if (!Array.isArray(raw)) {
    return raw;
  }
  const candidates = raw.filter(
    (item) =>
      isRecord(item) &&
      item.prerelease !== true &&
      typeof item.tag_name === "string",
  );
  if (candidates.length === 0) {
    throw new Error("更新清单格式非法：Release 列表为空或全部为预发布");
  }
  const versionOf = (item: Record<string, unknown>) =>
    String(item.tag_name).replace(/^v/i, "");
  return candidates.reduce((best, item) =>
    compareSemver(versionOf(item), versionOf(best)) > 0 ? item : best,
  );
}

/**
 * Gitee 不提供 GitHub 式的 digest 字段：完整性改为依赖随包发布的
 * .sha256 附件（发布脚本生成上传）。清单已带哈希时直接用；否则取
 * sidecar，取不到不阻断更新，只是跳过完整性校验。
 */
async function resolveSha256(target: UpdateTarget): Promise<string | null> {
  if (target.sha256) return target.sha256;
  if (!target.sha256Url) return null;
  try {
    const text = await fetchTextFile(target.sha256Url);
    return text.match(/[0-9a-f]{64}/i)?.[0] ?? null;
  } catch {
    return null;
  }
}

async function fetchTextFile(url: string): Promise<string> {
  if (!HTTPS_URL_PATTERN.test(url)) {
    throw new Error("地址必须为 https:// 链接");
  }
  if (isTauri()) {
    return invoke<string>("fetch_text", { url });
  }
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`请求失败（HTTP ${response.status}）`);
    }
    return await response.text();
  } finally {
    window.clearTimeout(timeout);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 净化更新说明文本：
 * 移除 GitHub / Gitee Release 页面末尾附带的裸露安装包表格与 SHA256 校验码区块
 * （应用内更新自带流式校验，无需向终端用户展示原始 Markdown 表格语法）。
 */
export function sanitizeReleaseNotes(notes: string): string {
  const cutIndex = notes.search(
    /(?:^|\n)\s*#{1,4}\s*(?:📦\s*)?安装包与校验信息/i,
  );
  const trimmed = cutIndex !== -1 ? notes.slice(0, cutIndex) : notes;
  return trimmed.replace(/(?:\r?\n\s*---\s*)*\s*$/, "").trim();
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
    notes: typeof notes === "string" ? sanitizeReleaseNotes(notes) : notes,
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
  if (typeof raw.tag_name === "string" || Array.isArray(raw.assets)) {
    return parseGitHubRelease(raw, platform);
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

/** 从 GitHub / Gitee Releases API 的最新发布记录中提取当前平台安装包。 */
function parseGitHubRelease(
  raw: Record<string, unknown>,
  platform: string,
): UpdateTarget {
  const tagName = raw.tag_name;
  if (typeof tagName !== "string") {
    throw new Error("更新清单格式非法：缺少 tag_name");
  }
  const version = tagName.replace(/^v/i, "");
  if (!SEMVER_PATTERN.test(version)) {
    throw new Error(`更新清单格式非法：tag_name 无效（${tagName}）`);
  }

  if (!Array.isArray(raw.assets)) {
    throw new Error("更新清单格式非法：assets 必须为数组");
  }
  const assets = raw.assets.filter(isRecord) as unknown as GitHubReleaseAsset[];
  const asset = assets.find((candidate) =>
    isReleaseAssetForPlatform(candidate, platform),
  );
  if (!asset) {
    throw new Error(`更新清单格式非法：缺少当前平台（${platform}）的安装包`);
  }
  if (
    typeof asset.name !== "string" ||
    typeof asset.browser_download_url !== "string"
  ) {
    throw new Error("更新清单格式非法：安装包字段无效");
  }

  const digest =
    typeof asset.digest === "string" &&
    /^sha256:[0-9a-f]{64}$/i.test(asset.digest)
      ? asset.digest.slice("sha256:".length)
      : null;
  // Gitee 无 digest 字段，完整性靠随包发布的 .sha256 sidecar 附件。
  const sidecar = assets.find(
    (candidate) =>
      typeof candidate.name === "string" &&
      candidate.name === `${asset.name}.sha256`,
  );
  const sha256Url =
    sidecar && typeof sidecar.browser_download_url === "string"
      ? sidecar.browser_download_url
      : null;
  const notes =
    typeof raw.body === "string" ? sanitizeReleaseNotes(raw.body) : null;
  return {
    version,
    notes,
    downloadUrl: asset.browser_download_url,
    sha256: digest,
    sha256Url,
  };
}

function isReleaseAssetForPlatform(
  asset: GitHubReleaseAsset,
  platform: string,
): boolean {
  if (
    typeof asset.name !== "string" ||
    typeof asset.browser_download_url !== "string"
  ) {
    return false;
  }
  const name = asset.name.toLowerCase();
  switch (platform) {
    case "windows":
      return name.endsWith(".exe");
    case "android":
      return name.endsWith(".apk");
    case "macos":
      return name.endsWith(".dmg") || name.endsWith(".app.tar.gz");
    case "linux":
      return (
        name.endsWith(".appimage") ||
        name.endsWith(".deb") ||
        name.endsWith(".rpm")
      );
    default:
      return false;
  }
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
export function compareSemver(left: string, right: string): number {
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
