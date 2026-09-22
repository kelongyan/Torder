import { describe, expect, it } from "vitest";
import { isSettingsPanelId, SETTINGS_PANEL_IDS } from "../types/settings";

/**
 * 托盘「设置」子菜单的 id 契约。
 *
 * 面板 id 由 Rust（`src-tauri/src/tray.rs`）拼成 `settings:<id>` 传到前端，
 * Rust 侧只做前缀切分、不校验合法性，所以白名单守卫是唯一拦截点。这组用例
 * 与 Rust 侧 `tray_settings_panels_match_frontend_contract` 成对：Rust 保证
 * 「发得对」，这里保证「收得住」。
 */
describe("isSettingsPanelId（托盘与设置深链的入参守卫）", () => {
  it("接受全部合法面板 id", () => {
    for (const panel of SETTINGS_PANEL_IDS) {
      expect(isSettingsPanelId(panel)).toBe(true);
    }
  });

  it("拒绝未知面板 id", () => {
    expect(isSettingsPanelId("unknown")).toBe(false);
    expect(isSettingsPanelId("General")).toBe(false); // 大小写敏感
    expect(isSettingsPanelId("")).toBe(false);
  });

  it("拒绝非字符串输入", () => {
    expect(isSettingsPanelId(null)).toBe(false);
    expect(isSettingsPanelId(undefined)).toBe(false);
    expect(isSettingsPanelId(42)).toBe(false);
    expect(isSettingsPanelId({ panel: "sync" })).toBe(false);
    expect(isSettingsPanelId(["sync"])).toBe(false);
  });

  it("拒绝从 Rust 前缀里带出来的空串与残留冒号", () => {
    // `settings:` 切分后是空串，`settings::sync` 切分后是 `:sync`——
    // 两者都不该被当成合法面板。
    expect(isSettingsPanelId(":sync")).toBe(false);
  });

  it("白名单不含重复项", () => {
    expect(new Set(SETTINGS_PANEL_IDS).size).toBe(SETTINGS_PANEL_IDS.length);
  });
});
