import { describe, expect, it, vi } from "vitest";
import {
  applyTrayIntent,
  isTrayIntent,
  type TrayIntentDeps,
} from "./trayIntent";
import { SETTINGS_PANEL_IDS } from "../types/settings";

/**
 * 托盘意图的跨 IPC 边界守卫与派发决策。
 *
 * payload 形状由 Rust `tray::TrayIntent` 决定（camelCase 判别联合），
 * 到达前端时已丢失类型信息。这里验证两件事：
 *  1. 脏值不会漏进分支逻辑（尤其 `openSettings.panel` 必须是字符串）；
 *  2. 每条意图落到正确的回调，且非法面板被拦下并明确报错。
 *
 * 面板 id 的「Rust 发什么」由 src-tauri/src/tray.rs 的
 * `tray_settings_panels_match_frontend_contract` 钉住，两边成对。
 */
describe("isTrayIntent（托盘意图守卫）", () => {
  it("接受 Rust 实际产出的两种形状", () => {
    // 与 tray.rs::tray_intent_serializes_as_tagged_union 的输出逐字对应
    expect(
      isTrayIntent(JSON.parse('{"kind":"openSettings","panel":"sync"}')),
    ).toBe(true);
    expect(isTrayIntent(JSON.parse('{"kind":"checkUpdate"}'))).toBe(true);
  });

  it("拒绝缺失或非法的 kind", () => {
    expect(isTrayIntent({})).toBe(false);
    expect(isTrayIntent({ kind: "unknown" })).toBe(false);
    expect(isTrayIntent({ panel: "sync" })).toBe(false);
  });

  it("openSettings 的 panel 必须是字符串", () => {
    expect(isTrayIntent({ kind: "openSettings" })).toBe(false);
    expect(isTrayIntent({ kind: "openSettings", panel: 42 })).toBe(false);
    expect(isTrayIntent({ kind: "openSettings", panel: null })).toBe(false);
    expect(isTrayIntent({ kind: "openSettings", panel: { id: "sync" } })).toBe(
      false,
    );
  });

  it("拒绝非对象输入", () => {
    expect(isTrayIntent(null)).toBe(false);
    expect(isTrayIntent(undefined)).toBe(false);
    expect(isTrayIntent("openSettings")).toBe(false);
    expect(isTrayIntent(7)).toBe(false);
    expect(isTrayIntent([])).toBe(false);
  });

  it("空字符串 panel 通过守卫，交由白名单层拒绝", () => {
    // 守卫只保证「是字符串」，合法性判定属 isSettingsPanelId 的职责——
    // 两层分开是为了让「形状错」与「id 不认」在排查时可区分。
    expect(isTrayIntent({ kind: "openSettings", panel: "" })).toBe(true);
  });
});

function createDeps(
  overrides: Partial<TrayIntentDeps> = {},
): {
  deps: TrayIntentDeps;
  opened: string[];
  toasts: Array<{ message: string; kind: string }>;
  found: unknown[];
} {
  const opened: string[] = [];
  const toasts: Array<{ message: string; kind: string }> = [];
  const found: unknown[] = [];
  const deps: TrayIntentDeps = {
    openSettingsDialog: (panel) => opened.push(panel),
    checkUpdate: async () => ({ hasUpdate: false, latestVersion: "0.0.0" }),
    onFoundUpdate: (info) => found.push(info),
    onToast: (message, kind) => toasts.push({ message, kind }),
    ...overrides,
  };
  return { deps, opened, toasts, found };
}

describe("applyTrayIntent（派发决策）", () => {
  it("合法面板直达设置弹窗，不额外提示", () => {
    const { deps, opened, toasts } = createDeps();
    applyTrayIntent({ kind: "openSettings", panel: "sync" }, deps);
    expect(opened).toEqual(["sync"]);
    expect(toasts).toEqual([]);
  });

  it("全部白名单面板都能直达", () => {
    const { deps, opened } = createDeps();
    for (const panel of SETTINGS_PANEL_IDS) {
      applyTrayIntent({ kind: "openSettings", panel }, deps);
    }
    expect(opened).toEqual([...SETTINGS_PANEL_IDS]);
  });

  it("非法面板被拦下并给出可诊断提示", () => {
    const { deps, opened, toasts } = createDeps();
    applyTrayIntent({ kind: "openSettings", panel: "nope" }, deps);
    expect(opened).toEqual([]);
    expect(toasts).toEqual([
      { message: "无法识别的设置项：nope", kind: "error" },
    ]);
  });

  it("检查更新发现新版本：弹窗 + 提示", async () => {
    const { deps, toasts, found } = createDeps({
      checkUpdate: async () => ({ hasUpdate: true, latestVersion: "9.9.9" }),
    });
    applyTrayIntent({ kind: "checkUpdate" }, deps);
    await vi.waitFor(() => expect(found).toHaveLength(1));
    expect(toasts).toEqual([
      { message: "发现新版本 v9.9.9", kind: "info" },
    ]);
  });

  it("检查更新无新版本：只提示已是最新", async () => {
    const { deps, toasts, found } = createDeps();
    applyTrayIntent({ kind: "checkUpdate" }, deps);
    await vi.waitFor(() => expect(toasts).toHaveLength(1));
    expect(found).toEqual([]);
    expect(toasts).toEqual([
      { message: "当前已是最新版本", kind: "success" },
    ]);
  });

  it("检查更新失败：提示失败原因，不抛给调用方", async () => {
    const { deps, toasts, found } = createDeps({
      checkUpdate: async () => {
        throw new Error("network down");
      },
    });
    // 不应 reject：托盘交互失败不能打断主界面
    expect(() => applyTrayIntent({ kind: "checkUpdate" }, deps)).not.toThrow();
    await vi.waitFor(() => expect(toasts).toHaveLength(1));
    expect(found).toEqual([]);
    expect(toasts[0]?.kind).toBe("error");
    expect(toasts[0]?.message).toContain("network down");
  });
});
