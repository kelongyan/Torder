#!/usr/bin/env node
/**
 * 设计 token 合规检查（docs/ui-refinement-plan.md §6「验证脚本」）。
 *
 * 统计 src/styles/*.css 中三类精修目标指标，超过基线阈值即退出 1，防止回潮：
 *  1. fontSizes      —— font-size 去重档位数（目标 8 档，见方案 §3.1）
 *  2. controlHeights —— 24–44px 区间内 min-height/height 去重档位数（控件高度档，
 *                       目标 3 档，见方案 §3.2；24–44 是控件带，网格/窗口等大尺寸不在此列）
 *  3. oddSpacing     —— padding/margin/gap 声明里奇数 px（>1px，1px 为分隔线）出现次数
 *                       （4px 栅格，见方案 §3.3）
 *
 * widget.css 被排除：桌面便签 v2.6.1–2.6.3 刚精修完，自成体系，不受主应用密度约束。
 *
 * 用法：
 *   node scripts/check-design-tokens.mjs            # 按下方基线阈值检查（CI / 提交前）
 *   node scripts/check-design-tokens.mjs --report   # 只打印当前统计，用于阶段后重定基线
 *
 * 基线随阶段收紧：每完成一个阶段，用 --report 重新测量并下调 THRESHOLDS。
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

/** 阶段基线（超过即失败）。P5 完成后的终值。 */
const THRESHOLDS = {
  fontSizes: 8, // P4 达成 §3.1 目标：10/11/12/13/14/16/18/20
  controlHeights: 11, // 24/26/28/30/32 目标档 + 34/36/40/42/44 存量（装饰 SVG、P6 移动端触控目标）
  oddSpacing: 0, // P5 达成：padding/margin/gap 无奇数 px（1px 分隔线豁免）
};

function collect() {
  const fontSizes = new Set();
  const controlHeights = new Set();
  let oddSpacing = 0;
  const oddHits = [];

  for (const file of readdirSync(stylesDir)) {
    if (!file.endsWith(".css") || EXCLUDE.has(file)) continue;
    const css = readFileSync(join(stylesDir, file), "utf8");

    for (const match of css.matchAll(/font-size:\s*([\d.]+)px/g)) {
      fontSizes.add(match[1]);
    }

    // (?<![-a-z]) 排除 line-height / max-height 等同名前缀属性
    for (const match of css.matchAll(
      /(?<![-a-z])(?:min-height|height):\s*(\d+)px/g,
    )) {
      const value = Number(match[1]);
      if (value >= 24 && value <= 44) controlHeights.add(String(value));
    }

    for (const match of css.matchAll(
      /(?:padding|margin|gap)[a-z-]*:\s*([^;{}]+)[;{}]/g,
    )) {
      for (const px of match[1].matchAll(/(\d+(?:\.\d+)?)px/g)) {
        const value = Number(px[1]);
        if (value > 1 && value % 2 === 1) {
          oddSpacing += 1;
          oddHits.push(`${file}: ${match[1].trim()}`);
        }
      }
    }
  }

  return {
    fontSizes: [...fontSizes].sort((a, b) => a - b),
    controlHeights: [...controlHeights]
      .map(Number)
      .sort((a, b) => a - b)
      .map(String),
    oddSpacing,
    oddHits,
  };
}

const stats = collect();

if (process.argv.includes("--report")) {
  console.log("font-size 档位:", stats.fontSizes.join(", "));
  console.log(
    `fontSizes: ${stats.fontSizes.length}（阈值 ${THRESHOLDS.fontSizes}）`,
  );
  console.log("控件高度档位(24-44px):", stats.controlHeights.join(", "));
  console.log(
    `controlHeights: ${stats.controlHeights.length}（阈值 ${THRESHOLDS.controlHeights}）`,
  );
  console.log(
    `oddSpacing: ${stats.oddSpacing}（阈值 ${THRESHOLDS.oddSpacing}）`,
  );
  for (const hit of stats.oddHits) console.log("  odd:", hit);
  process.exit(0);
}

const failures = [];
if (stats.fontSizes.length > THRESHOLDS.fontSizes)
  failures.push(
    `fontSizes ${stats.fontSizes.length} > ${THRESHOLDS.fontSizes}（当前档位: ${stats.fontSizes.join(", ")}）`,
  );
if (stats.controlHeights.length > THRESHOLDS.controlHeights)
  failures.push(
    `controlHeights ${stats.controlHeights.length} > ${THRESHOLDS.controlHeights}（当前档位: ${stats.controlHeights.join(", ")}）`,
  );
if (stats.oddSpacing > THRESHOLDS.oddSpacing)
  failures.push(
    `oddSpacing ${stats.oddSpacing} > ${THRESHOLDS.oddSpacing}（新增的奇数间距声明需归位到 4px 栅格）`,
  );

if (failures.length > 0) {
  console.error("设计 token 检查未通过（docs/ui-refinement-plan.md §6）:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(
  `设计 token 检查通过: fontSizes ${stats.fontSizes.length}/${THRESHOLDS.fontSizes}, controlHeights ${stats.controlHeights.length}/${THRESHOLDS.controlHeights}, oddSpacing ${stats.oddSpacing}/${THRESHOLDS.oddSpacing}`,
);
