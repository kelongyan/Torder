import type { SyncConflict } from "../types/sync";

/**
 * P1-05c：同步冲突的字段级解析/格式化纯函数，从 SettingsSyncSection 抽出。
 * 无 React 依赖，可直接单测；新增冲突字段语义时同步更新 conflictFieldLabel。
 */

/** 冲突每字段的选择偏好：冲突 id → 字段 → local/remote。 */
export type MergeChoiceMap = Record<string, Record<string, "local" | "remote">>;

export function conflictLabel(conflict: SyncConflict): string {
  try {
    const payload = JSON.parse(conflict.localPayloadJson) as {
      title?: string;
      name?: string;
    };
    return (
      payload.title ??
      payload.name ??
      `${conflict.entity} · ${conflict.objectId}`
    );
  } catch {
    return `${conflict.entity} · ${conflict.objectId}`;
  }
}

export function conflictFieldValues(
  conflict: SyncConflict,
): Array<[string, unknown, unknown]> {
  const local = JSON.parse(conflict.localPayloadJson) as Record<
    string,
    unknown
  >;
  const remote = JSON.parse(conflict.remotePayloadJson) as Record<
    string,
    unknown
  >;
  return [...new Set([...Object.keys(local), ...Object.keys(remote)])]
    .filter(
      (key) =>
        key !== "id" &&
        JSON.stringify(local[key]) !== JSON.stringify(remote[key]),
    )
    .map((key) => [key, local[key], remote[key]]);
}

export function conflictDiffs(
  conflict: SyncConflict,
): Array<[string, string, string]> {
  try {
    return conflictFieldValues(conflict)
      .slice(0, 8)
      .map(([key, local, remote]) => [
        key,
        formatConflictValue(local),
        formatConflictValue(remote),
      ]);
  } catch {
    return [];
  }
}

/** 基于当前逐字段选择构造合并后的远端覆盖结果；字段解析失败返回 undefined。 */
export function mergedConflictPayload(
  conflict: SyncConflict,
  mergeChoices: MergeChoiceMap,
): Record<string, unknown> | undefined {
  try {
    const local = JSON.parse(conflict.localPayloadJson) as Record<
      string,
      unknown
    >;
    const merged = { ...local };
    for (const [field, , remoteValue] of conflictFieldValues(conflict)) {
      if (mergeChoices[conflict.id]?.[field] !== "local") {
        merged[field] = remoteValue;
      }
    }
    return merged;
  } catch {
    return undefined;
  }
}

export function formatConflictValue(value: unknown): string {
  if (value === undefined) return "（未设置）";
  if (value === null) return "（空）";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export function conflictFieldLabel(field: string): string {
  const labels: Record<string, string> = {
    title: "标题",
    name: "名称",
    note: "备注",
    status: "状态",
    priority: "优先级",
    listId: "清单",
    scheduledDate: "计划日期",
    dueAt: "截止时间",
    completedAt: "完成时间",
    remindBefore: "提前提醒",
    repeatRule: "重复规则",
    frequency: "频率",
    intervalCount: "间隔",
    weekdays: "星期",
    monthDay: "日期",
    nextDueAt: "下次生成",
    enabled: "启用状态",
    eventType: "事件类型",
    startDate: "开始日期",
    endDate: "结束日期",
    deletedAt: "删除状态",
  };
  return labels[field] ?? field;
}
