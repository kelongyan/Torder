import { describe, expect, it } from "vitest";
import { parseUpdateManifest } from "./appService";

/**
 * P0-03 的正式回归测试（承诺于批次 A 记录）：更新清单运行时校验。
 * 合法清单通过、非法版本/非 https/缺平台/坏结构均需给出可诊断错误。
 */
const VALID_TARGET = {
  version: "2.7.0",
  downloadUrl: "https://example.com/Torder-2.7.0.exe",
};

describe("parseUpdateManifest · 平铺清单", () => {
  it("接受合法的顶层平铺清单", () => {
    const target = parseUpdateManifest(VALID_TARGET, "windows");
    expect(target.version).toBe("2.7.0");
    expect(target.downloadUrl).toBe("https://example.com/Torder-2.7.0.exe");
  });

  it("接受带预发布后缀的版本与可选字段", () => {
    const target = parseUpdateManifest(
      {
        ...VALID_TARGET,
        version: "2.8.0-beta.1",
        notes: "修复若干问题",
        sha256: "abc123",
      },
      "windows",
    );
    expect(target.version).toBe("2.8.0-beta.1");
    expect(target.notes).toBe("修复若干问题");
    expect(target.sha256).toBe("abc123");
  });
});

describe("parseUpdateManifest · 平台化清单", () => {
  it("命中当前平台时优先采用平台目标", () => {
    const target = parseUpdateManifest(
      {
        version: "1.0.0",
        downloadUrl: "https://example.com/legacy.exe",
        platforms: {
          windows: VALID_TARGET,
          macos: {
            version: "3.0.0",
            downloadUrl: "https://example.com/Torder.dmg",
          },
        },
      },
      "windows",
    );
    expect(target.version).toBe("2.7.0");
  });

  it("platforms 非空但缺当前平台 → 拒绝（不回退顶层）", () => {
    expect(() =>
      parseUpdateManifest(
        {
          version: "1.0.0",
          downloadUrl: "https://example.com/a.exe",
          platforms: { macos: VALID_TARGET },
        },
        "windows",
      ),
    ).toThrow(/缺少当前平台/);
  });

  it("platforms 为空对象时回退顶层平铺结构（兼容既有清单）", () => {
    const target = parseUpdateManifest(
      { ...VALID_TARGET, platforms: {} },
      "windows",
    );
    expect(target.version).toBe("2.7.0");
  });
});

describe("parseUpdateManifest · 非法输入拒绝", () => {
  const cases: Array<[string, unknown, RegExp]> = [
    ["根不是对象", "string-root", /根节点不是对象/],
    ["根是数组", [VALID_TARGET], /根节点不是对象/],
    ["版本非法", { ...VALID_TARGET, version: "latest" }, /version 无效/],
    [
      "下载地址非 https",
      { ...VALID_TARGET, downloadUrl: "http://example.com/a.exe" },
      /https:\/\//,
    ],
    ["下载地址缺失", { version: "2.7.0" }, /downloadUrl/],
    ["notes 类型错误", { ...VALID_TARGET, notes: 42 }, /notes/],
    [
      "平台目标损坏",
      { platforms: { windows: { version: "oops" } } },
      /version 无效/,
    ],
  ];
  for (const [name, raw, pattern] of cases) {
    it(`拒绝：${name}`, () => {
      expect(() => parseUpdateManifest(raw, "windows")).toThrow(pattern);
    });
  }
});
