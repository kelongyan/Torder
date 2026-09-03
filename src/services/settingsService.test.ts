import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Setting } from "../types/database";

/**
 * P1-04：设置解析与损坏回退测试。
 * loadAppSettings 的解析函数未导出，通过 mock Tauri invoke 注入任意
 * 原始 value 字符串（含损坏 JSON、非法枚举），覆盖「损坏值回退默认」
 * 的语义——与 Rust 端 settings_repository 的宽松读取策略对应。
 */
const rows: Setting[] = [];

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string) => {
    if (command === "list_settings") return [...rows];
    throw new Error(`unexpected invoke: ${command}`);
  }),
  // 强制走 Tauri 数据分支（浏览器分支是内存单例，无法注入损坏值）
  isTauri: () => true,
}));

import { defaultAppSettings } from "../types/settings";
import { loadAppSettings } from "./settingsService";

function row(key: string, value: string): Setting {
  return { key, value, updatedAt: "2026-09-03T00:00:00Z" };
}

beforeEach(() => {
  rows.length = 0;
});

describe("loadAppSettings · 损坏回退", () => {
  it("合法值正确解析", async () => {
    rows.push(
      row("theme", '"dark"'),
      row("notificationsEnabled", "false"),
      row("notificationSound", '"silent"'),
      row("defaultReminderMinutes", "30"),
      row("defaultPriority", "2"),
    );
    const settings = await loadAppSettings();
    expect(settings.theme).toBe("dark");
    expect(settings.notificationsEnabled).toBe(false);
    expect(settings.notificationSound).toBe("silent");
    expect(settings.defaultReminderMinutes).toBe(30);
    expect(settings.defaultPriority).toBe(2);
  });

  it("损坏 JSON 回退默认值而非抛错", async () => {
    rows.push(row("theme", "not-json"), row("notificationsEnabled", "{broken"));
    const settings = await loadAppSettings();
    expect(settings.theme).toBe(defaultAppSettings.theme);
    expect(settings.notificationsEnabled).toBe(
      defaultAppSettings.notificationsEnabled,
    );
  });

  it("非法枚举值回退默认值", async () => {
    rows.push(
      row("theme", '"sepia"'),
      row("accent", '"gold"'),
      row("notificationSound", '"bass"'),
      row("defaultPriority", "9"),
      row("defaultDueDate", '"yesterday"'),
    );
    const settings = await loadAppSettings();
    expect(settings.theme).toBe(defaultAppSettings.theme);
    expect(settings.accent).toBe(defaultAppSettings.accent);
    expect(settings.notificationSound).toBe(
      defaultAppSettings.notificationSound,
    );
    expect(settings.defaultPriority).toBe(defaultAppSettings.defaultPriority);
    expect(settings.defaultDueDate).toBe(defaultAppSettings.defaultDueDate);
  });

  it("缺失键时返回全默认设置", async () => {
    const settings = await loadAppSettings();
    expect(settings).toEqual(defaultAppSettings);
  });

  it("null 值视为损坏并回退（trashRetentionDays 例外，null 为合法语义）", async () => {
    rows.push(row("theme", "null"), row("trashRetentionDays", "null"));
    const settings = await loadAppSettings();
    expect(settings.theme).toBe(defaultAppSettings.theme);
    expect(settings.trashRetentionDays).toBeNull();
  });
});
