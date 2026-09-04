/**
 * mobile/types.ts — 移动壳与外部（App）的共享契约（M-A）
 * 由 App.tsx 组装的 props 集合，页面经 useMobileProps() 消费。
 */
import type {
  CalendarEvent,
  RecurringRule,
  Task,
  TaskList,
  UpdateTaskInput,
} from "../types/database";
import type { AppSettings } from "../types/settings";
import type { SyncStatus } from "../types/sync";

export interface MobileShellProps {
  /** App 本地数据（非 store 部分，由 App 注入） */
  lists: TaskList[];
  settings: AppSettings;
  calendarEvents: CalendarEvent[];
  recurringRules: RecurringRule[];
  syncStatus: SyncStatus | null;
  /** 全库去重标签（availableTags） */
  tags: string[];
  /** 任务加载中 */
  loading: boolean;
  /** taskId → 附件数（详情页徽标） */
  attachmentCounts: Record<string, number>;

  /* ------- 动作（App 闭包注入，与桌面同一实现） ------- */
  openSettingsDialog: () => void;
  onNewCalendarEvent: (date: string) => void;
  onEditCalendarEvent: (event: CalendarEvent) => void;
  onMoveTaskDate: (taskId: string, dateKey: string) => Promise<void>;
  onToast: (message: string, kind?: "success" | "error" | "info") => void;
  onToggleTask: (task: Task) => void;
  onSaveTask: (input: UpdateTaskInput) => Promise<void> | void;
  onDeleteTask: (task: Task) => void;
  onRestoreTask: (task: Task) => void;
  onPermanentDeleteTask: (task: Task) => void;
}
