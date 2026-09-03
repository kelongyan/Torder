import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Task } from "../types/database";
import type { ConfirmState, ToastAction, ToastKind } from "../types/ui";
import { useTaskStore } from "../stores/taskStore";

/**
 * P1-05：单任务/批量任务动作（删除确认、恢复、永久删除、清空回收站、
 * 批量完成/删除/恢复/永久删除/更新），从 App.tsx 提取。
 * store actions 直接在此订阅；撤销逻辑经 getState() 回读最新 store，
 * 与原 App 内联实现语义一致。
 */
export interface TaskActionsDeps {
  /** 当前视图已派生任务（回收站计数等用途）。 */
  tasks: Task[];
  allTasks: Task[];
  batchSelectedIds: string[];
  setConfirmState: Dispatch<SetStateAction<ConfirmState | null>>;
  pushToast: (
    message: string,
    type: ToastKind,
    action?: ToastAction | ToastAction[],
  ) => void;
}

export function useTaskActions({
  tasks,
  allTasks,
  batchSelectedIds,
  setConfirmState,
  pushToast,
}: TaskActionsDeps) {
  const removeTask = useTaskStore((state) => state.removeTask);
  const restoreTask = useTaskStore((state) => state.restoreTask);
  const permanentDeleteTask = useTaskStore(
    (state) => state.permanentDeleteTask,
  );
  const emptyTrash = useTaskStore((state) => state.emptyTrash);
  const batchDelete = useTaskStore((state) => state.batchDelete);
  const batchComplete = useTaskStore((state) => state.batchComplete);
  const batchRestore = useTaskStore((state) => state.batchRestore);
  const batchPermanentDelete = useTaskStore(
    (state) => state.batchPermanentDelete,
  );
  const batchUpdate = useTaskStore((state) => state.batchUpdate);

  const requestDeleteTask = useCallback(
    (task: Task) => {
      setConfirmState({
        title: "确认删除任务",
        body: `删除“${task.title}”？可恢复。`,
        confirmText: "删除",
        danger: true,
        onConfirm: async () => {
          await removeTask(task.id);
          setConfirmState(null);
          pushToast("任务已移入回收站", "info", {
            label: "撤销",
            onClick: async () => {
              await restoreTask(task.id);
              pushToast("已撤销删除", "success");
            },
          });
        },
      });
    },
    [pushToast, removeTask, restoreTask, setConfirmState],
  );

  const handleRestoreTask = useCallback(
    async (task: Task) => {
      await restoreTask(task.id);
      pushToast(`已恢复"${task.title}"`, "success", {
        label: "撤销",
        onClick: async () => {
          await removeTask(task.id);
          pushToast("已撤销恢复", "info");
        },
      });
    },
    [pushToast, removeTask, restoreTask],
  );

  const requestPermanentDeleteTask = useCallback(
    (task: Task) => {
      setConfirmState({
        title: "永久删除任务",
        body: `永久删除“${task.title}”？此操作不可撤销。`,
        confirmText: "永久删除",
        danger: true,
        onConfirm: async () => {
          await permanentDeleteTask(task.id);
          setConfirmState(null);
          pushToast("任务已永久删除", "info");
        },
      });
    },
    [permanentDeleteTask, pushToast, setConfirmState],
  );

  const requestEmptyTrash = useCallback(() => {
    if (tasks.length === 0) return;
    setConfirmState({
      title: "清空回收站",
      body: `永久删除回收站内 ${tasks.length} 项任务？此操作不可撤销。`,
      confirmText: "清空回收站",
      danger: true,
      onConfirm: async () => {
        const count = await emptyTrash();
        setConfirmState(null);
        pushToast(`已清空 ${count} 项任务`, "info");
      },
    });
  }, [emptyTrash, pushToast, setConfirmState, tasks.length]);

  const requestBatchDelete = useCallback(() => {
    if (batchSelectedIds.length === 0) return;
    const selectedIds = [...batchSelectedIds];
    setConfirmState({
      title: "确认批量删除",
      body: `删除已选 ${batchSelectedIds.length} 项？可从回收站恢复。`,
      confirmText: "删除",
      danger: true,
      onConfirm: async () => {
        await batchDelete();
        setConfirmState(null);
        pushToast("已删除选中任务", "info", {
          label: "撤销",
          onClick: async () => {
            for (const id of selectedIds) {
              await useTaskStore.getState().restoreTask(id);
            }
            pushToast("已撤销批量删除", "success");
          },
        });
      },
    });
  }, [batchDelete, batchSelectedIds, pushToast, setConfirmState]);

  const handleBatchComplete = useCallback(async () => {
    if (batchSelectedIds.length === 0) return;
    const selectedIds = [...batchSelectedIds];
    const lookup = new Map(
      [...allTasks, ...tasks].map((task) => [task.id, task] as const),
    );
    const restoreTodoIds = selectedIds.filter(
      (id) => lookup.get(id)?.status !== "done",
    );
    await batchComplete();
    pushToast("已完成选中任务", "success", {
      label: "撤销",
      onClick: async () => {
        for (const id of restoreTodoIds) {
          await useTaskStore.getState().toggleTask(id, false);
        }
        pushToast("已撤销批量完成", "info");
      },
    });
  }, [allTasks, batchComplete, batchSelectedIds, pushToast, tasks]);

  const handleBatchRestore = useCallback(async () => {
    if (batchSelectedIds.length === 0) return;
    const selectedIds = [...batchSelectedIds];
    await batchRestore();
    pushToast("已恢复选中任务", "success", {
      label: "撤销",
      onClick: async () => {
        for (const id of selectedIds) {
          await useTaskStore.getState().removeTask(id);
        }
        pushToast("已撤销批量恢复", "info");
      },
    });
  }, [batchRestore, batchSelectedIds, pushToast]);

  const requestBatchPermanentDelete = useCallback(() => {
    if (batchSelectedIds.length === 0) return;
    setConfirmState({
      title: "永久删除选中任务",
      body: `永久删除已选 ${batchSelectedIds.length} 项？此操作不可撤销。`,
      confirmText: "永久删除",
      danger: true,
      onConfirm: async () => {
        await batchPermanentDelete();
        setConfirmState(null);
        pushToast("已永久删除选中任务", "info");
      },
    });
  }, [batchPermanentDelete, batchSelectedIds, pushToast, setConfirmState]);

  const handleBatchUpdate = useCallback(
    async (patch: Parameters<typeof batchUpdate>[0]) => {
      await batchUpdate(patch);
      pushToast("已更新选中任务", "success");
    },
    [batchUpdate, pushToast],
  );

  return {
    requestDeleteTask,
    handleRestoreTask,
    requestPermanentDeleteTask,
    requestEmptyTrash,
    requestBatchDelete,
    handleBatchComplete,
    handleBatchRestore,
    requestBatchPermanentDelete,
    handleBatchUpdate,
  };
}
