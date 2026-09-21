/**
 * 托盘意图的解析、校验与派发（纯函数，可单测）。
 *
 * 拆成独立文件而非塞进 `useTrayNavigation`：测试环境是 node（无 jsdom），
 * 混在 hook 里就只能连 React / Tauri IPC 一起拉进来；与 `utils/releaseNotes.ts`
 * 同一思路——决策层保持无副作用，适配层（hook）才碰框架。
 *
 * 形状契约来自 Rust `tray::TrayIntent` 的
 * `#[serde(tag = "kind", rename_all = "camelCase")]`，
 * 由 `src-tauri/src/tray.rs` 的 `tray_intent_serializes_as_tagged_union` 钉住。
 */
import { isSettingsPanelId, type SettingsPanelId } from "../types/settings";
import { normalizeError } from "./normalizeError";

export type TrayIntent =
  | { kind: "openSettings"; panel: string }
  | { kind: "checkUpdate" };

/**
 * 运行期守卫：事件 payload 与 `take_tray_intent` 返回值都可能为脏
 * （跨 IPC 边界、字段缺失、旧版残留），一律先过这里再分支。
 */
export function isTrayIntent(value: unknown): value is TrayIntent {
  if (!value || typeof value !== "object") return false;
  const { kind } = value as { kind?: unknown };
  if (kind === "checkUpdate") return true;
  return (
    kind === "openSettings" &&
    typeof (value as { panel?: unknown }).panel === "string"
  );
}

/**
 * `applyTrayIntent` 需要的外部能力（hook 负责注入真实实现，测试注入替身）。
 *
 * `TUpdate` 让调用方保留自己的完整 `UpdateInfo` 类型（含 notes/downloadUrl 等）：
 * 这里只用到 `hasUpdate` / `latestVersion`，不该把上层类型削窄成结构子集——
 * 那会逼调用方做无意义的类型转换。
 */
export interface TrayIntentDeps<TUpdate extends TrayUpdate = TrayUpdate> {
  /** 打开设置弹窗并直达面板。 */
  openSettingsDialog: (panel: SettingsPanelId) => void;
  /** 手动检查更新；发现新版本时由 `onFoundUpdate` 接管弹窗。 */
  checkUpdate: () => Promise<TUpdate>;
  /** 发现新版本：弹出更新弹窗。 */
  onFoundUpdate: (info: TUpdate) => void;
  /** 结果提示（无更新 / 失败 / 非法面板）。 */
  onToast: (message: string, kind: "info" | "success" | "error") => void;
}

/** 更新检查结果中本模块实际用到的字段。 */
export interface TrayUpdate {
  hasUpdate: boolean;
  latestVersion: string;
}

/**
 * 执行一条托盘意图。
 *
 * 与设置→关于里的「手动检查更新」同语义：用户主动点了就要看到结果，
 * 因此无更新与失败都给 toast——不走启动静默检查那套「自然日免打扰」。
 *
 * 面板 id 由 Rust 字符串拼出（`settings:<id>`），Rust 侧只做前缀切分、
 * 不校验合法性，所以白名单校验落在这里：非法 id 明确报错而非静默吞掉，
 * 否则表现成「点了完全没反应」，无迹可查。
 */
export function applyTrayIntent<TUpdate extends TrayUpdate>(
  intent: TrayIntent,
  deps: TrayIntentDeps<TUpdate>,
): void {
  if (intent.kind === "checkUpdate") {
    void deps
      .checkUpdate()
      .then((info) => {
        if (info.hasUpdate) {
          deps.onFoundUpdate(info);
          deps.onToast(`发现新版本 v${info.latestVersion}`, "info");
        } else {
          deps.onToast("当前已是最新版本", "success");
        }
      })
      .catch((error: unknown) => {
        deps.onToast(`检查更新失败：${normalizeError(error)}`, "error");
      });
    return;
  }

  if (isSettingsPanelId(intent.panel)) {
    deps.openSettingsDialog(intent.panel);
  } else {
    deps.onToast(`无法识别的设置项：${intent.panel}`, "error");
  }
}
