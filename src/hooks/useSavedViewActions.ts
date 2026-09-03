import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { AppSettings, SavedTaskView } from "../types/settings";
import type { ConfirmState, ToastAction, ToastKind } from "../types/ui";
import { saveAppSetting } from "../services/settingsService";
import { useTaskStore } from "../stores/taskStore";

/**
 * P1-05：已存视图（保存筛选/排序组合）的业务动作，从 App.tsx 提取。
 * 输入 = 视图对话框的本地状态与通知/确认依赖；输出 = 各动作 handler。
 * store 的 applyViewState / selectTask 直接在此订阅，App 组合层不再持有。
 */
export interface SavedViewActionsDeps {
  settings: AppSettings;
  editingSavedView: SavedTaskView | null;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
  setSavedViewDialogOpen: (open: boolean) => void;
  setEditingSavedView: Dispatch<SetStateAction<SavedTaskView | null>>;
  setConfirmState: Dispatch<SetStateAction<ConfirmState | null>>;
  pushToast: (
    message: string,
    type: ToastKind,
    action?: ToastAction | ToastAction[],
  ) => void;
  /** 打开已存视图时收起弹层与移动端侧栏（导航副作用）。 */
  setRecurringViewActive: (active: boolean) => void;
  setMenuOpen: (open: boolean) => void;
  setMobileSidebarOpen: (open: boolean) => void;
}

export function useSavedViewActions({
  settings,
  editingSavedView,
  setSettings,
  setSavedViewDialogOpen,
  setEditingSavedView,
  setConfirmState,
  pushToast,
  setRecurringViewActive,
  setMenuOpen,
  setMobileSidebarOpen,
}: SavedViewActionsDeps) {
  const applyViewState = useTaskStore((state) => state.applyViewState);
  const selectTask = useTaskStore((state) => state.selectTask);

  const handleOpenSavedView = useCallback(
    async (view: SavedTaskView) => {
      setRecurringViewActive(false);
      setMenuOpen(false);
      setMobileSidebarOpen(false);
      selectTask(null);
      await applyViewState({
        scope: view.scope,
        searchQuery: view.query,
        sortBy: view.sortBy,
        showCompleted: view.showCompleted,
        layout: view.layout,
      });
    },
    [
      applyViewState,
      selectTask,
      setMenuOpen,
      setMobileSidebarOpen,
      setRecurringViewActive,
    ],
  );

  const openCreateSavedViewDialog = useCallback(() => {
    setEditingSavedView(null);
    setSavedViewDialogOpen(true);
  }, [setEditingSavedView, setSavedViewDialogOpen]);

  const openEditSavedViewDialog = useCallback(
    (view: SavedTaskView) => {
      setEditingSavedView(view);
      setSavedViewDialogOpen(true);
    },
    [setEditingSavedView, setSavedViewDialogOpen],
  );

  const handleSaveSavedView = useCallback(
    async (view: SavedTaskView) => {
      const nextViews = editingSavedView
        ? settings.savedViews.map((item) => (item.id === view.id ? view : item))
        : [...settings.savedViews, view];
      await saveAppSetting("savedViews", nextViews);
      setSettings((current) => ({ ...current, savedViews: nextViews }));
      setSavedViewDialogOpen(false);
      pushToast(
        editingSavedView ? "保存视图已更新" : "筛选视图已保存",
        "success",
      );
    },
    [
      editingSavedView,
      pushToast,
      setSavedViewDialogOpen,
      setSettings,
      settings.savedViews,
    ],
  );

  const requestDeleteSavedView = useCallback(
    (view: SavedTaskView) => {
      setConfirmState({
        title: "删除保存视图",
        body: `删除“${view.name}”？不会删除任何任务。`,
        confirmText: "删除视图",
        danger: true,
        onConfirm: async () => {
          const nextViews = settings.savedViews.filter(
            (item) => item.id !== view.id,
          );
          await saveAppSetting("savedViews", nextViews);
          setSettings((current) => ({ ...current, savedViews: nextViews }));
          setConfirmState(null);
          pushToast("保存视图已删除", "info");
        },
      });
    },
    [pushToast, setConfirmState, setSettings, settings.savedViews],
  );

  return {
    handleOpenSavedView,
    openCreateSavedViewDialog,
    openEditSavedViewDialog,
    handleSaveSavedView,
    requestDeleteSavedView,
  };
}
