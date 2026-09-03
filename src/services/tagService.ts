import { invoke, isTauri } from "@tauri-apps/api/core";

export type TagManageAction = "rename" | "merge" | "remove";

/**
 * 标签管理（T-07 二期）：批量改写 tasks.tags。
 * 返回受影响任务数。浏览器预览模式无 SQLite 持久层，返回 0 并由调用方
 * 提示「桌面端可用」；桌面端失败向上抛（弹窗展示诊断）。
 */
export async function manageTag(
  action: TagManageAction,
  fromTag: string,
  toTag?: string,
): Promise<number> {
  if (!isTauri()) {
    throw new Error("标签管理在浏览器预览中不可用，请用桌面应用");
  }
  const affected = (await invoke("manage_tag", {
    action,
    fromTag,
    toTag: toTag ?? null,
  })) as number;
  return affected;
}
