import { describe, expect, it } from "vitest";
import { filterAndSortTasks } from "./taskQuery";
import type { Task } from "../types/database";

/**
 * P2-02 前端查询性能基线（默认跳过；PERF=1 时运行）：
 *   PERF=1 vitest run src/services/perfQuery.test.ts
 * 覆盖 filterAndSortTasks 在 1k / 10k / 50k 任务下的全量过滤与文本搜索耗时，
 * 以及排序/派生路径的粗粒度基线。阈值宽松防机器差异 flaky；
 * 数值变化趋势以本文件输出的 console 报告为准，不是断言。
 */

const PERF_RUN = process.env.PERF === "1";

function makeBenchTask(index: number, dueOffset: number): Task {
  const createdAt = `2026-0${(index % 9) + 1}-${String((index % 27) + 1).padStart(2, "0")}T00:00:00Z`;
  const dueAt =
    dueOffset > 0
      ? `2026-09-${String((index % 27) + 1).padStart(2, "0")}T0${index % 9}:00:00Z`
      : null;
  return {
    id: `bench-${index}`,
    title: `任务 ${index}：提交季度报告并同步 ${index % 7 === 0 ? "review" : "内容"}`,
    note: index % 3 === 0 ? `备注包含关键字 pr-${index}` : null,
    status: index % 11 === 0 ? "done" : "todo",
    priority: (index % 3) as 0 | 1 | 2,
    listId: index % 4 === 0 ? "personal" : "work",
    scheduledDate: index % 5 === 0 ? "2026-09-15" : null,
    dueAt,
    completedAt: index % 11 === 0 ? "2026-08-30T00:00:00Z" : null,
    sortOrder: index % 100,
    remindBefore: index % 7 === 0 ? 30 : null,
    remindAt: null,
    remindedAt: null,
    repeatRule: null,
    subtasks:
      index % 4 === 0
        ? [
            { id: `s-${index}-1`, title: "子任务一", completed: false, createdAt, completedAt: null, sortOrder: 0 },
            { id: `s-${index}-2`, title: "子任务二", completed: index % 2 === 0, createdAt, completedAt: index % 2 === 0 ? createdAt : null, sortOrder: 1 },
          ]
        : [],
    tags: index % 3 === 0 ? ["bench", "deep"] : ["bench"],
    recurringRuleId: null,
    occurrenceAt: null,
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
  };
}

function buildTasks(count: number): Task[] {
  return Array.from({ length: count }, (_, index) => makeBenchTask(index, index % 7));
}

function time(label: string, fn: () => void): number {
  const start = performance.now();
  fn();
  const elapsed = Math.round(performance.now() - start);
  // eslint-disable-next-line no-console
  console.log(`  ${label.padEnd(46)} ${String(elapsed).padStart(6)} ms`);
  return elapsed;
}

function runScenario(count: number) {
  const tasks = buildTasks(count);
  // eslint-disable-next-line no-console
  console.log(`\n[bench] 任务量 ${count.toLocaleString()}（含子任务/标签，真实任务结构）`);
  time(
    "scope=all + showCompleted 派生（含深拷贝）",
    () => {
      const result = filterAndSortTasks(tasks, {
        scope: { kind: "view", view: "all" },
        query: "",
        sortBy: "priority",
        showCompleted: true,
      });
      expect(result.length).toBe(count);
    },
  );
  time(
    "文本搜索「review」+ priority 排序",
    () => {
      const result = filterAndSortTasks(tasks, {
        scope: { kind: "view", view: "all" },
        query: "review",
        sortBy: "priority",
        showCompleted: false,
      });
      expect(result.length).toBeGreaterThan(0);
    },
  );
  time(
    "视图过滤 planned + 文本搜索组合",
    () => {
      filterAndSortTasks(tasks, {
        scope: { kind: "view", view: "planned" },
        query: "pr-",
        sortBy: "date",
        showCompleted: false,
      });
    },
  );
  time(
    "no-date 视图（遍历克隆最重路径之一）",
    () => {
      filterAndSortTasks(tasks, {
        scope: { kind: "view", view: "no-date" },
        query: "",
        sortBy: "created",
        showCompleted: false,
      });
    },
  );
}

describe.skipIf(!PERF_RUN)("P2-02 前端查询性能基线", () => {
  it("1k / 10k / 50k 任务过滤排序耗时", () => {
    for (const count of [1_000, 10_000, 50_000]) {
      runScenario(count);
    }
    expect(true).toBe(true);
  });
});
