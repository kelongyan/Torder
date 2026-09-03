import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import type {
  CreateRecurringRuleInput,
  RecurringRule,
  Task,
  UpdateRecurringRuleInput,
} from "../types/database";
import type { ConfirmState, ToastAction, ToastKind } from "../types/ui";
import {
  createRecurringRule,
  deleteRecurringRule,
  generateNextRecurringOccurrence,
  setRecurringRuleEnabled,
  skipNextRecurringOccurrence,
  updateRecurringRule,
} from "../services/recurringService";
import { useTaskStore } from "../stores/taskStore";

/**
 * P1-05：循环任务（规则 CRUD/启停/跳过一次/手动生成）动作，从 App.tsx 提取。
 * 规则数据由 useAppDataLoaders 持有（loadRecurringRules/recurringRules 经 deps 注入）；
 * 任务重拉走 taskStore.getState()，避免把整个 store 挂进 hook 依赖。
 */
export interface RecurringActionsDeps {
  recurringRules: RecurringRule[];
  loadRecurringRules: () => Promise<void>;
  selectTask: (taskId: string | null) => void;
  setCreateOpen: (open: boolean) => void;
  setRecurringDialogOpen: (open: boolean) => void;
  setEditingRecurringRule: Dispatch<SetStateAction<RecurringRule | null>>;
  setRecurringSourceTask: Dispatch<SetStateAction<Task | null>>;
  setCreateScheduledDate: (date: string) => void;
  setConfirmState: Dispatch<SetStateAction<ConfirmState | null>>;
  pushToast: (
    message: string,
    type: ToastKind,
    action?: ToastAction | ToastAction[],
  ) => void;
}

export function useRecurringActions({
  recurringRules,
  loadRecurringRules,
  selectTask,
  setCreateOpen,
  setRecurringDialogOpen,
  setEditingRecurringRule,
  setRecurringSourceTask,
  setCreateScheduledDate,
  setConfirmState,
  pushToast,
}: RecurringActionsDeps) {
  const reloadRulesAndTasks = useCallback(async () => {
    await Promise.all([
      loadRecurringRules(),
      useTaskStore.getState().loadTasks(),
    ]);
  }, [loadRecurringRules]);

  const handleCreateRecurring = useCallback(
    async (input: CreateRecurringRuleInput) => {
      await createRecurringRule(input);
      await reloadRulesAndTasks();
      setCreateOpen(false);
      setRecurringDialogOpen(false);
      setCreateScheduledDate("");
      pushToast("循环任务已创建", "success");
    },
    [
      pushToast,
      reloadRulesAndTasks,
      setCreateOpen,
      setCreateScheduledDate,
      setRecurringDialogOpen,
    ],
  );

  const handleUpdateRecurring = useCallback(
    async (input: UpdateRecurringRuleInput) => {
      await updateRecurringRule(input);
      await reloadRulesAndTasks();
      setRecurringDialogOpen(false);
      pushToast("循环规则已更新", "success");
    },
    [pushToast, reloadRulesAndTasks, setRecurringDialogOpen],
  );

  const openTaskRecurring = useCallback(
    (task: Task) => {
      selectTask(null);
      setRecurringSourceTask(task.recurringRuleId ? null : task);
      setEditingRecurringRule(
        task.recurringRuleId
          ? (recurringRules.find((rule) => rule.id === task.recurringRuleId) ??
              null)
          : null,
      );
      setRecurringDialogOpen(true);
    },
    [
      recurringRules,
      selectTask,
      setEditingRecurringRule,
      setRecurringDialogOpen,
      setRecurringSourceTask,
    ],
  );

  const requestDeleteRecurring = useCallback(
    (rule: RecurringRule) => {
      setConfirmState({
        title: "删除循环规则",
        body: `删除“${rule.title}”。已生成任务保留。`,
        confirmText: "仅删除规则",
        secondaryText: "删除未来实例",
        danger: true,
        onConfirm: async () => {
          await deleteRecurringRule(rule.id, false);
          await loadRecurringRules();
          setConfirmState(null);
          pushToast("循环规则已删除", "info");
        },
        onSecondary: async () => {
          await deleteRecurringRule(rule.id, true);
          await reloadRulesAndTasks();
          setConfirmState(null);
          pushToast("规则和未来实例已删除", "info");
        },
      });
    },
    [loadRecurringRules, pushToast, reloadRulesAndTasks, setConfirmState],
  );

  const handleToggleRecurring = useCallback(
    async (rule: RecurringRule) => {
      await setRecurringRuleEnabled(rule.id, !rule.enabled);
      await loadRecurringRules();
      pushToast(rule.enabled ? "循环任务已暂停" : "循环任务已恢复", "info");
    },
    [loadRecurringRules, pushToast],
  );

  const handleSkipRecurring = useCallback(
    async (rule: RecurringRule) => {
      await skipNextRecurringOccurrence(rule.id);
      await loadRecurringRules();
      pushToast("下一次循环已跳过", "info");
    },
    [loadRecurringRules, pushToast],
  );

  const handleGenerateRecurring = useCallback(
    async (rule: RecurringRule) => {
      await generateNextRecurringOccurrence(rule.id);
      await reloadRulesAndTasks();
      pushToast("下一次任务已生成", "success");
    },
    [pushToast, reloadRulesAndTasks],
  );

  return {
    handleCreateRecurring,
    handleUpdateRecurring,
    openTaskRecurring,
    requestDeleteRecurring,
    handleToggleRecurring,
    handleSkipRecurring,
    handleGenerateRecurring,
  };
}
