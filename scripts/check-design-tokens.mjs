#!/usr/bin/env node
/**
 * 设计 token 合规检查（设计稿/DESIGN.md §13 规则 2 / 决策 D1，2026-09-01 重写）。
 *
 * 基准切换：UI 重构以设计稿渲染结果为唯一视觉基准——
 * 字号采用设计稿 16 档（9–25px，含半档）、间距采用 2px 阶梯 + 半档（奇数合法）。
 * 旧「8 档字号 / 禁奇数间距」精修基线（docs/ui-refinement-plan.md）已废除。
 *
 * 检查三类：
 *  1. fontSizes        ——【硬门禁】font-size 值必须在设计稿 16 档白名单内。
 *                         迁移期的存量档 18/20px 已于 F2（TD-2）全部收敛，白名单随之收紧，
 *                         防止存量档回流（--report 输出档位占比）。
 *  2. spacing          ——【硬门禁】padding/margin/gap 的 px 值必须为整数
 *                         （2px 阶梯 + 半档 = 奇数合法；小数 px 非法）
 *  3. controlHeights   ——【仅报告】16–64px 控件带 + 超带高度列示，不拦截：
 *                         结构件（弹窗头 84px 等）与控件高度由各区域按 §5 组件规格迁移保证，
 *                         全局数值门禁不区分结构件/控件，只做度量。
 *
 * widget.css 被排除：桌面便签自成体系，不受主应用约束。
 *
 * 用法：
 *   node scripts/check-design-tokens.mjs            # 检查（CI / 提交前）
 *   node scripts/check-design-tokens.mjs --report   # 打印统计与设计稿档占比，用于迁移度量
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const stylesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "styles",
);
const EXCLUDE = new Set(["widget.css"]);

/** 设计稿字号阶梯（设计稿/styles/tokens/type.css，16 档） */
const DESIGN_TIERS = new Set([
  "9",
  "10",
  "10.5",
  "11",
  "11.5",
  "12",
  "12.5",
  "13",
  "13.5",
  "14",
  "15",
  "16",
  "17",
  "19",
  "22",
  "25",
]);
/** 控件高度合法带 */
const HEIGHT_BAND = { min: 16, max: 64 };

function collect() {
  const fontSizes = new Set();
  const fontHits = [];
  let fontTotal = 0;
  let fontDesignCount = 0;
  const badHeights = [];
  const controlHeights = new Set();
  const badSpacing = [];

  for (const file of readdirSync(stylesDir)) {
    if (!file.endsWith(".css") || EXCLUDE.has(file)) continue;
    const css = readFileSync(join(stylesDir, file), "utf8");

    for (const match of css.matchAll(/font-size:\s*([\d.]+)px/g)) {
      const value = match[1];
      fontSizes.add(value);
      fontTotal += 1;
      if (DESIGN_TIERS.has(value)) fontDesignCount += 1;
      else fontHits.push(`${file}: font-size: ${value}px`);
    }

    // (?<![-a-z]) 排除 line-height / max-height 等同名前缀属性。
    // 16-64px 记为控件带档位；仅拦截 >64px 的异常控件高度——
    // <16px 的小高度是进度条/指示点/图标等装饰件，合法。
    for (const match of css.matchAll(
      /(?<![-a-z])(?:min-height|height):\s*(\d+(?:\.\d+)?)px/g,
    )) {
      const value = Number(match[1]);
      if (value >= HEIGHT_BAND.min && value <= HEIGHT_BAND.max) {
        controlHeights.add(String(value));
      } else if (value > HEIGHT_BAND.max) {
        badHeights.push(`${file}: ${match[0]}`);
      }
    }

    for (const match of css.matchAll(
      /(?:padding|margin|gap)[a-z-]*:\s*([^;{}]+)[;{}]/g,
    )) {
      for (const px of match[1].matchAll(/(\d+(?:\.\d+)?)px/g)) {
        const value = Number(px[1]);
        if (!Number.isInteger(value)) {
          badSpacing.push(`${file}: ${match[1].trim()}`);
        }
      }
    }
  }

  return {
    fontSizes: [...fontSizes].sort((a, b) => a - b),
    fontHits,
    fontTotal,
    fontDesignCount,
    controlHeights: [...controlHeights]
      .map(Number)
      .sort((a, b) => a - b)
      .map(String),
    badHeights,
    badSpacing,
  };
}

const stats = collect();

if (process.argv.includes("--report")) {
  const ratio = stats.fontTotal
    ? Math.round((stats.fontDesignCount / stats.fontTotal) * 100)
    : 100;
  console.log("font-size 档位:", stats.fontSizes.join(", "));
  console.log(
    `设计稿档占比: ${stats.fontDesignCount}/${stats.fontTotal} 声明（${ratio}%，未达 100% 即有白名单外档位，见 fontHits）`,
  );
  console.log("控件高度档位(16-64px):", stats.controlHeights.join(", "));
  if (stats.badHeights.length > 0)
    console.log(`超 64px 结构件高度（仅报告）: ${stats.badHeights.length} 处`);
  process.exit(0);
}

const failures = [];
const offTiers = stats.fontSizes.filter((v) => !DESIGN_TIERS.has(v));
if (offTiers.length > 0) {
  failures.push(
    `font-size 出现白名单外的档位: ${offTiers.join(", ")}（允许 = 设计稿 16 档；来源示例: ${stats.fontHits.slice(0, 3).join(" | ")}）`,
  );
}
if (stats.badSpacing.length > 0) {
  failures.push(
    `padding/margin/gap 出现小数 px ${stats.badSpacing.length} 处（设计稿间距为整数 2px 阶梯含半档；示例: ${stats.badSpacing.slice(0, 3).join(" | ")}）`,
  );
}

if (failures.length > 0) {
  console.error("设计 token 检查未通过（设计稿/DESIGN.md §13 规则 2 / D1）:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(
  `设计 token 检查通过: fontSizes ${stats.fontSizes.length} 档（白名单内）, spacing 全整数（控件高度仅报告，见 --report）`,
);
