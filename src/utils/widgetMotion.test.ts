import { describe, expect, it } from "vitest";
import {
  easeOutCubic,
  leaveClassName,
  navDirectionFromDelta,
} from "./widgetMotion";

/**
 * 便签动效纯函数测试（方案书 docx/widget-ux-polish-plan-2026-09-08.md
 * W1-3 方向映射 + W2-1 高度插值 easing）。
 */

describe("navDirectionFromDelta", () => {
  it("负 delta（上一天 ←）为 prev", () => {
    expect(navDirectionFromDelta(-1)).toBe("prev");
    expect(navDirectionFromDelta(-7)).toBe("prev");
  });

  it("正 delta（下一天 →）为 next", () => {
    expect(navDirectionFromDelta(1)).toBe("next");
    expect(navDirectionFromDelta(7)).toBe("next");
  });

  it("0 delta 归入 next（无位移场景的兜底方向）", () => {
    expect(navDirectionFromDelta(0)).toBe("next");
  });
});

describe("leaveClassName", () => {
  it("prev 旧内容向右滑出（is-leaving-prev）", () => {
    expect(leaveClassName("prev")).toBe("is-leaving-prev");
  });

  it("next 旧内容向左滑出（is-leaving-next）", () => {
    expect(leaveClassName("next")).toBe("is-leaving-next");
  });
});

describe("easeOutCubic", () => {
  it("边界：0→0、1→1", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
  });

  it("越界输入夹取到 [0,1]", () => {
    expect(easeOutCubic(-0.5)).toBe(0);
    expect(easeOutCubic(1.5)).toBe(1);
  });

  it("中点超过 0.5（先快后慢）", () => {
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });

  it("t=0.25 处等于 1-(0.75)^3 ≈ 0.5781", () => {
    expect(easeOutCubic(0.25)).toBeCloseTo(0.578125, 6);
  });

  it("曲线单调不减", () => {
    let previous = 0;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const value = easeOutCubic(Math.min(1, t));
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });
});
