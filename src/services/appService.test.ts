import { describe, expect, it } from "vitest";
import { compareSemver, parseUpdateManifest, pickLatestRelease } from "./appService";

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

describe("parseUpdateManifest · GitHub Releases API", () => {
  it("从最新 Release 选择 Windows 安装包并读取摘要与摘要哈希", () => {
    const target = parseUpdateManifest(
      {
        tag_name: "v2.7.5",
        body: "修复更新检查",
        assets: [
          {
            name: "Torder_2.7.5_x64-setup.exe",
            browser_download_url:
              "https://github.com/kelongyan/Torder/releases/download/v2.7.5/Torder_2.7.5_x64-setup.exe",
            digest:
              "sha256:adcc488d66dd689512e0cfb0d1fab890977be47480129c470c352b79b10df5b7",
          },
        ],
      },
      "windows",
    );
    expect(target.version).toBe("2.7.5");
    expect(target.notes).toBe("修复更新检查");
    expect(target.sha256).toBe(
      "adcc488d66dd689512e0cfb0d1fab890977be47480129c470c352b79b10df5b7",
    );
  });

  it("拒绝没有当前平台安装包的 Release", () => {
    expect(() =>
      parseUpdateManifest(
        {
          tag_name: "v2.7.5",
          assets: [{ name: "Torder_2.7.5_universal-release.apk", browser_download_url: "https://example.com/a.apk" }],
        },
        "windows",
      ),
    ).toThrow(/缺少当前平台/);
  });

  it("Gitee Release 无 digest 时读取 .sha256 sidecar 附件地址", () => {
    const target = parseUpdateManifest(
      {
        tag_name: "v2.7.5",
        body: "Gitee 发布",
        assets: [
          {
            name: "Torder_2.7.5_x64-setup.exe",
            browser_download_url:
              "https://gitee.com/yankelong/Torder/releases/download/v2.7.5/Torder_2.7.5_x64-setup.exe",
          },
          {
            name: "Torder_2.7.5_x64-setup.exe.sha256",
            browser_download_url:
              "https://gitee.com/yankelong/Torder/releases/download/v2.7.5/Torder_2.7.5_x64-setup.exe.sha256",
          },
        ],
      },
      "windows",
    );
    expect(target.version).toBe("2.7.5");
    expect(target.sha256).toBeNull();
    expect(target.sha256Url).toBe(
      "https://gitee.com/yankelong/Torder/releases/download/v2.7.5/Torder_2.7.5_x64-setup.exe.sha256",
    );
  });
});

describe("pickLatestRelease · Gitee 列表归一化", () => {
  it("从创建时间乱序的列表中按 semver 挑最高版本", () => {
    // 真实事故：v2.7.1 的 release 后补，created_at 比 v2.7.5 晚，
    // Gitee 的 /releases/latest 据此返回旧版，导致客户端"检查不到新版本"。
    const picked = pickLatestRelease([
      { tag_name: "v2.7.5", prerelease: false, created_at: "2026-09-09T21:23:48+08:00" },
      { tag_name: "v2.7.1", prerelease: false, created_at: "2026-09-09T21:26:26+08:00" },
    ]);
    expect((picked as { tag_name: string }).tag_name).toBe("v2.7.5");
  });

  it("过滤预发布版本；空列表报错；单对象原样通过", () => {
    const withPrerelease = pickLatestRelease([
      { tag_name: "v3.0.0", prerelease: true },
      { tag_name: "v2.7.5", prerelease: false },
    ]);
    expect((withPrerelease as { tag_name: string }).tag_name).toBe("v2.7.5");
    expect(() => pickLatestRelease([{ tag_name: "v1.0.0", prerelease: true }])).toThrow(
      /Release 列表为空/,
    );
    const single = { tag_name: "v2.7.5" };
    expect(pickLatestRelease(single)).toBe(single);
  });
});

describe("compareSemver", () => {
  it("不会把低版本测试包当成升级", () => {
    expect(compareSemver("2.5.0", "2.7.4")).toBeLessThan(0);
    expect(compareSemver("2.7.5", "2.7.4")).toBeGreaterThan(0);
  });
});
