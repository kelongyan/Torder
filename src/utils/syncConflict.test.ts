import { describe, expect, it } from "vitest";
import type { SyncConflict } from "../types/sync";
import {
  conflictDiffs,
  conflictFieldLabel,
  conflictFieldValues,
  conflictLabel,
  formatConflictValue,
  mergedConflictPayload,
} from "./syncConflict";

function makeConflict(overrides: Partial<SyncConflict> = {}): SyncConflict {
  return {
    id: "c-1",
    entity: "task",
    objectId: "task-1",
    localRevision: 1,
    remoteRevision: 2,
    localPayloadJson: JSON.stringify({ title: "本地标题", priority: 1 }),
    remotePayloadJson: JSON.stringify({ title: "远端标题", priority: 1 }),
    detectedAt: "2026-09-01T00:00:00Z",
    resolvedAt: null,
    resolution: null,
    ...overrides,
  };
}

describe("conflictLabel", () => {
  it("优先取 payload 的 title/name", () => {
    expect(conflictLabel(makeConflict())).toBe("本地标题");
    expect(
      conflictLabel(
        makeConflict({
          localPayloadJson: JSON.stringify({ name: "清单名" }),
        }),
      ),
    ).toBe("清单名");
  });

  it("payload 损坏时回退到 entity · objectId", () => {
    expect(conflictLabel(makeConflict({ localPayloadJson: "{broken" }))).toBe(
      "task · task-1",
    );
    expect(
      conflictLabel(
        makeConflict({
          localPayloadJson: JSON.stringify({}),
          remotePayloadJson: JSON.stringify({}),
        }),
      ),
    ).toBe("task · task-1");
  });
});

describe("conflictFieldValues", () => {
  it("只列本地/远端有差异的字段，排除 id", () => {
    const conflict = makeConflict({
      localPayloadJson: JSON.stringify({ id: "x", title: "A", note: "同" }),
      remotePayloadJson: JSON.stringify({ id: "x", title: "B", note: "同" }),
    });
    const fields = conflictFieldValues(conflict).map(([key]) => key);
    expect(fields).toEqual(["title"]);
  });

  it("字段类型不同（string vs null）视为差异", () => {
    const conflict = makeConflict({
      localPayloadJson: JSON.stringify({ dueAt: null }),
      remotePayloadJson: JSON.stringify({ dueAt: "2026-09-04T04:00:00Z" }),
    });
    expect(conflictFieldValues(conflict).map(([key]) => key)).toEqual([
      "dueAt",
    ]);
  });
});

describe("conflictDiffs", () => {
  it("格式化本地/远端值并限制最多 8 行", () => {
    const many = Object.fromEntries(
      Array.from({ length: 10 }, (_, index) => [`f${index}`, index]),
    );
    const conflict = makeConflict({
      localPayloadJson: JSON.stringify(many),
      remotePayloadJson: JSON.stringify(
        Object.fromEntries(
          Array.from({ length: 10 }, (_, index) => [`f${index}`, index + 1]),
        ),
      ),
    });
    expect(conflictDiffs(conflict)).toHaveLength(8);
    expect(conflictDiffs(conflict)[0][1]).toBe("0");
    expect(conflictDiffs(conflict)[0][2]).toBe("1");
  });

  it("JSON 损坏时返回空数组", () => {
    expect(
      conflictDiffs(
        makeConflict({ localPayloadJson: "{broken", remotePayloadJson: "x" }),
      ),
    ).toEqual([]);
  });
});

describe("mergedConflictPayload", () => {
  const conflict = makeConflict({
    localPayloadJson: JSON.stringify({
      title: "本地",
      dueAt: "2026-09-04T00:00:00Z",
    }),
    remotePayloadJson: JSON.stringify({ title: "远端", dueAt: null }),
  });

  it("默认以远端覆盖本地；字段选 local 则保留本地", () => {
    const merged = mergedConflictPayload(conflict, {});
    expect(merged).toEqual({ title: "远端", dueAt: null });

    const keepTitle = mergedConflictPayload(conflict, {
      "c-1": { title: "local" },
    });
    expect(keepTitle).toEqual({ title: "本地", dueAt: null });
  });

  it("无差异字段时原样返回本地 payload", () => {
    const same = makeConflict({
      localPayloadJson: JSON.stringify({ title: "相同" }),
      remotePayloadJson: JSON.stringify({ title: "相同" }),
    });
    expect(mergedConflictPayload(same, {})).toEqual({ title: "相同" });
  });

  it("损坏时返回 undefined", () => {
    expect(
      mergedConflictPayload(makeConflict({ localPayloadJson: "{broken" }), {}),
    ).toBeUndefined();
  });
});

describe("formatConflictValue / conflictFieldLabel", () => {
  it("格式化各类型值", () => {
    expect(formatConflictValue(undefined)).toBe("（未设置）");
    expect(formatConflictValue(null)).toBe("（空）");
    expect(formatConflictValue("文本")).toBe("文本");
    expect(formatConflictValue(2)).toBe("2");
    expect(formatConflictValue({ a: 1 })).toBe('{"a":1}');
  });

  it("字段中文标签映射，未知名回退原文", () => {
    expect(conflictFieldLabel("title")).toBe("标题");
    expect(conflictFieldLabel("startDate")).toBe("开始日期");
    expect(conflictFieldLabel("customField")).toBe("customField");
  });
});
