import { useEffect, useState } from "react";
import type { Task } from "../types/database";

export interface AnimatedTask {
  task: Task;
  leaving: boolean;
}

/**
 * 列表任务的离场动画：任务从派生结果消失后先标记 leaving 再移除，
 * 交给 .task-item.is-leaving 播放收起动画（280ms 与 CSS 保持同步）。
 */
export function useAnimatedTasks(tasks: Task[]): AnimatedTask[] {
  const [items, setItems] = useState<AnimatedTask[]>(
    tasks.map((task) => ({ task, leaving: false })),
  );

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const nextIds = new Set(tasks.map((task) => task.id));
      setItems((current) => [
        ...tasks.map((task) => ({ task, leaving: false })),
        ...current
          .filter((item) => !nextIds.has(item.task.id) && !item.leaving)
          .map((item) => ({ ...item, leaving: true })),
      ]);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [tasks]);

  useEffect(() => {
    if (!items.some((item) => item.leaving)) return;

    const timeoutId = window.setTimeout(() => {
      setItems((current) => current.filter((item) => !item.leaving));
    }, 280);

    return () => window.clearTimeout(timeoutId);
  }, [items]);

  return items;
}
