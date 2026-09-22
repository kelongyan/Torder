import { describe, expect, it } from "vitest";
import {
  fontStackFor,
  isNoteFontId,
  isNoteFontPresetId,
  normalizeAppearance,
  noteFontIds,
  noteFontOptions,
} from "./widgetAppearance";

/**
 * 便签字体从「固定枚举」放宽为「预设 ∪ 任意系统字体家族名」后的契约。
 *
 * 放宽的动机：用户要能选电脑上装的任何字体（`list_system_fonts` 枚举出的
 * 家族名）。风险也随之转移——旧的白名单守卫能挡住一切脏值，现在必须靠
 * 「非空字符串 + 长度上限」这一条底线，任何放松都会让脏数据流进 CSS 变量。
 */
describe("isNoteFontId（放宽后的字体守卫）", () => {
  it("接受全部内置预设 id", () => {
    for (const preset of noteFontIds) {
      expect(isNoteFontId(preset)).toBe(true);
    }
  });

  it("接受任意系统字体家族名", () => {
    expect(isNoteFontId("微软雅黑")).toBe(true);
    expect(isNoteFontId("Source Han Sans SC")).toBe(true);
    expect(isNoteFontId("Arial")).toBe(true);
    // 带空格、标点、非 ASCII 的家族名都要放行
    expect(isNoteFontId("Noto Sans CJK SC")).toBe(true);
    expect(isNoteFontId("华文彩云")).toBe(true);
  });

  it("拒绝空串与纯空白（会让整条 font-family 声明失效）", () => {
    expect(isNoteFontId("")).toBe(false);
    expect(isNoteFontId("   ")).toBe(false);
    expect(isNoteFontId("\t\n")).toBe(false);
  });

  it("拒绝非字符串", () => {
    expect(isNoteFontId(null)).toBe(false);
    expect(isNoteFontId(undefined)).toBe(false);
    expect(isNoteFontId(42)).toBe(false);
    expect(isNoteFontId({ font: "Arial" })).toBe(false);
    expect(isNoteFontId(["Arial"])).toBe(false);
  });

  it("拒绝超长值（防脏数据把 CSS 变量撑爆）", () => {
    expect(isNoteFontId("a".repeat(256))).toBe(true);
    expect(isNoteFontId("a".repeat(257))).toBe(false);
  });
});

describe("isNoteFontPresetId（预设判定）", () => {
  it("只认内置预设，系统字体名与已移除的 custom 都不算", () => {
    expect(isNoteFontPresetId("handwriting")).toBe(true);
    expect(isNoteFontPresetId("sans")).toBe(true);
    expect(isNoteFontPresetId("system")).toBe(true);
    expect(isNoteFontPresetId("custom")).toBe(false);
    expect(isNoteFontPresetId("微软雅黑")).toBe(false);
    expect(isNoteFontPresetId("Arial")).toBe(false);
  });

  it("预设列表已移除 custom（导入字体功能下线）", () => {
    expect(noteFontIds).not.toContain("custom");
    expect(noteFontOptions.map((option) => option.id)).not.toContain("custom");
  });

  it("与 isNoteFontId 的包含关系：预设 ⊆ 全部合法值", () => {
    for (const preset of noteFontIds) {
      expect(isNoteFontId(preset)).toBe(true);
      expect(isNoteFontPresetId(preset)).toBe(true);
    }
  });
});

describe("fontStackFor（字体栈生成）", () => {
  it("预设走固定分支", () => {
    expect(fontStackFor("handwriting")).toBe(`"Torder Note", var(--font-ui)`);
    expect(fontStackFor("sans")).toBe("var(--font-ui)");
    expect(fontStackFor("system")).toContain("sans-serif");
  });

  it("历史 custom 值按系统字体名处理（不再有专属分支）", () => {
    // 旧值已被 normalizeAppearance 回退成 handwriting，但万一透传到
    // fontStackFor，也不该崩——它只是个普通的家族名而已。
    expect(fontStackFor("custom")).toBe(`"custom", var(--font-ui)`);
  });

  it("系统字体名被引号包裹并追加 UI 兜底", () => {
    // 家族名常含空格/中文，裸写会被 CSS 当成多个标识符
    expect(fontStackFor("微软雅黑")).toBe(`"微软雅黑", var(--font-ui)`);
    expect(fontStackFor("Source Han Sans SC")).toBe(
      `"Source Han Sans SC", var(--font-ui)`,
    );
  });

  it("转义家族名里的引号与反斜杠（防注入破坏整条声明）", () => {
    expect(fontStackFor(`My"Font`)).toBe(`"My\\"Font", var(--font-ui)`);
    expect(fontStackFor("Back\\slash")).toBe(
      `"Back\\\\slash", var(--font-ui)`,
    );
  });

  it("剔除换行符（CSS 字符串里换行非法，会让声明提前终止）", () => {
    expect(fontStackFor("Bad\nFont")).toBe(`"BadFont", var(--font-ui)`);
    expect(fontStackFor("Bad\r\nFont")).toBe(`"BadFont", var(--font-ui)`);
  });

  it("非预设字体名以 var(--font-ui) 兜底收尾", () => {
    // 用户可能选了一个本机没有的字体（跨机器同步来的设置），
    // 兜底保证不会掉到浏览器默认 serif 把便签排版搞崩。
    // 预设项各有各的既有兜底（system 走 sans-serif 通用族），不在此列。
    const samples = ["微软雅黑", "Source Han Sans SC", "Nonexistent Font XYZ"];
    for (const font of samples) {
      expect(fontStackFor(font)).toContain("var(--font-ui)");
    }
  });

  it("每个结果都带兜底（通用族或 UI 变量）", () => {
    const samples = [
      "handwriting",
      "sans",
      "system",
      "微软雅黑",
      "Nonexistent Font XYZ",
    ];
    for (const font of samples) {
      const stack = fontStackFor(font);
      expect(
        stack.includes("var(--font-ui)") || stack.includes("sans-serif"),
      ).toBe(true);
    }
  });
});

/**
 * 兼容性：导入字体功能已下线（2026-09-22），但老用户的设置里可能仍存着
 * `noteFont: "custom"`。这条锁住回退行为——不透传会让便签落到一个不存在的
 * 家族名上，设置面板也会显示一个点不到的选项。
 */
describe("normalizeAppearance：历史 custom 值回退", () => {
  it("custom 回退为 handwriting", () => {
    const appearance = normalizeAppearance({ noteFont: "custom" });
    expect(appearance.noteFont).toBe("handwriting");
  });

  it("其它合法值不受影响", () => {
    expect(normalizeAppearance({ noteFont: "sans" }).noteFont).toBe("sans");
    expect(normalizeAppearance({ noteFont: "Calibri Light" }).noteFont).toBe(
      "Calibri Light",
    );
    expect(normalizeAppearance({ noteFont: "微软雅黑" }).noteFont).toBe(
      "微软雅黑",
    );
  });

  it("非法值同样回退到 handwriting", () => {
    expect(normalizeAppearance({ noteFont: "" }).noteFont).toBe("handwriting");
    expect(normalizeAppearance({ noteFont: 42 }).noteFont).toBe("handwriting");
    expect(normalizeAppearance({}).noteFont).toBe("handwriting");
  });

  it("归一化结果不再含 noteCustomFontName 字段", () => {
    // 字段已随功能移除；旧设置里带的这个键应被忽略而非透传
    const appearance = normalizeAppearance({
      noteFont: "custom",
      noteCustomFontName: "MyFont",
    });
    expect("noteCustomFontName" in appearance).toBe(false);
  });
});
