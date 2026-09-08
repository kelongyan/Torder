/**
 * mobile/parts/TaskMoreMenu.tsx — 任务行「更多」操作（长按 / 行尾按钮触发）
 * 自包含：完成/恢复 · 编辑 · 移动清单 · 删除；导航用移动路由上下文。
 * 字段类修改复用 buildUpdateTaskInput（全量 UpdateTaskInput + onSaveTask）。
 */
/* eslint-disable react-refresh/only-export-components */
import { useState, type JSX } from "react";
import { Check, Folder, Pencil, RotateCcw, Trash2 } from "lucide-react";
import type { Task } from "../../types/database";
import { useMobilePage } from "../router";
import { useMobileProps } from "../context";
import { buildUpdateTaskInput } from "./taskEdits";
import { ActionSheet, ConfirmSheet } from "./sheets";

/** 列表页长按 / 更多 入口状态（页级） */
export function useTaskMore() {
  const [task, setTask] = useState<Task | null>(null);
  return {
    openMore: (t: Task) => setTask(t),
    moreMenu: task ? (
      <TaskMoreMenu task={task} onClose={() => setTask(null)} />
    ) : null,
  };
}

export function TaskMoreMenu({
  task,
  onClose,
}: {
  task: Task;
  onClose: () => void;
}): JSX.Element | null {
  const { nav } = useMobilePage();
  const props = useMobileProps();
  const [view, setView] = useState<"more" | "list" | "confirm">("more");
  const done = task.status === "done";

  if (view === "list") {
    return (
      <ActionSheet
        title="移动到清单"
        items={props.lists.map((list) => ({
          label: list.name,
          icon: <Folder aria-hidden="true" />,
          onSelect: () => {
            props.onSaveTask(buildUpdateTaskInput(task, { listId: list.id }));
          },
        }))}
        onClose={onClose}
      />
    );
  }

  if (view === "confirm") {
    return (
      <ConfirmSheet
        title="删除任务？"
        body="任务将移入回收站。"
        confirmText="删除"
        danger
        onCancel={onClose}
        onConfirm={() => {
          props.onDeleteTask(task);
          onClose();
        }}
      />
    );
  }

  return (
    <ActionSheet
      title={task.title}
      items={[
        {
          label: done ? "恢复为进行中" : "标记完成",
          icon: done ? (
            <RotateCcw aria-hidden="true" />
          ) : (
            <Check aria-hidden="true" />
          ),
          onSelect: () => {
            props.onToggleTask(task);
          },
        },
        {
          label: "编辑任务",
          icon: <Pencil aria-hidden="true" />,
          onSelect: () => {
            nav.push(`/task/${task.id}/edit`);
          },
        },
        {
          label: "移动到其他清单",
          icon: <Folder aria-hidden="true" />,
          onSelect: () => setView("list"),
        },
        {
          label: "删除任务",
          icon: <Trash2 aria-hidden="true" />,
          danger: true,
          onSelect: () => setView("confirm"),
        },
      ]}
      onClose={onClose}
    />
  );
}
