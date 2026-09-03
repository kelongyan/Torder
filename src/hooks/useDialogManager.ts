import {
  useCallback,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { usePresence, type PresencePhase } from "./usePresence";
import type {
  CalendarEvent,
  RecurringRule,
  Task,
  TaskList,
} from "../types/database";
import type { ConfirmState } from "../types/ui";

interface DialogPresence {
  rendered: boolean;
  value: ConfirmState | boolean | null;
  phase: PresencePhase;
}

export interface DialogManager {
  menuOpen: boolean;
  mobileSidebarOpen: boolean;
  createOpen: boolean;
  listDialogOpen: boolean;
  editingList: TaskList | null;
  shortcutsOpen: boolean;
  settingsOpen: boolean;
  statsOpen: boolean;
  batchEditOpen: boolean;
  /** F2 · T-01：命令面板（Ctrl K）。 */
  commandPaletteOpen: boolean;
  confirmState: ConfirmState | null;
  recurringDialogOpen: boolean;
  editingRecurringRule: RecurringRule | null;
  recurringSourceTask: Task | null;
  calendarEventDialogOpen: boolean;
  editingCalendarEvent: CalendarEvent | null;
  eventDialogDefaultDate: string;
  createPresence: DialogPresence;
  listDialogPresence: DialogPresence;
  shortcutsPresence: DialogPresence;
  settingsPresence: DialogPresence;
  statsPresence: DialogPresence;
  batchEditPresence: DialogPresence;
  commandPalettePresence: DialogPresence;
  confirmPresence: DialogPresence;
  recurringDialogPresence: DialogPresence;
  calendarEventDialogPresence: DialogPresence;
  setMenuOpen: Dispatch<SetStateAction<boolean>>;
  setMobileSidebarOpen: Dispatch<SetStateAction<boolean>>;
  setCreateOpen: Dispatch<SetStateAction<boolean>>;
  setListDialogOpen: Dispatch<SetStateAction<boolean>>;
  setEditingList: Dispatch<SetStateAction<TaskList | null>>;
  setShortcutsOpen: Dispatch<SetStateAction<boolean>>;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  setStatsOpen: Dispatch<SetStateAction<boolean>>;
  setBatchEditOpen: Dispatch<SetStateAction<boolean>>;
  setCommandPaletteOpen: Dispatch<SetStateAction<boolean>>;
  setConfirmState: Dispatch<SetStateAction<ConfirmState | null>>;
  setRecurringDialogOpen: Dispatch<SetStateAction<boolean>>;
  setEditingRecurringRule: Dispatch<SetStateAction<RecurringRule | null>>;
  setRecurringSourceTask: Dispatch<SetStateAction<Task | null>>;
  setCalendarEventDialogOpen: Dispatch<SetStateAction<boolean>>;
  setEditingCalendarEvent: Dispatch<SetStateAction<CalendarEvent | null>>;
  setEventDialogDefaultDate: Dispatch<SetStateAction<string>>;
  openCreateDialog: () => void;
  openSettingsDialog: () => void;
  openStatsDialog: () => void;
  openAddListDialog: () => void;
  openEditListDialog: (list: TaskList) => void;
  openNewRecurringDialog: () => void;
  openNewCalendarEvent: (date: string) => void;
  openEditCalendarEvent: (event: CalendarEvent) => void;
  openMobileSidebar: () => void;
  closeMobileSidebar: () => void;
  closeDialogs: () => void;
}

export function useDialogManager(): DialogManager {
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [listDialogOpen, setListDialogOpen] = useState(false);
  const [editingList, setEditingList] = useState<TaskList | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [batchEditOpen, setBatchEditOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [recurringDialogOpen, setRecurringDialogOpen] = useState(false);
  const [editingRecurringRule, setEditingRecurringRule] =
    useState<RecurringRule | null>(null);
  const [recurringSourceTask, setRecurringSourceTask] = useState<Task | null>(
    null,
  );
  const [calendarEventDialogOpen, setCalendarEventDialogOpen] = useState(false);
  const [editingCalendarEvent, setEditingCalendarEvent] =
    useState<CalendarEvent | null>(null);
  const [eventDialogDefaultDate, setEventDialogDefaultDate] = useState(
    new Date().toISOString().slice(0, 10),
  );

  const createPresence = usePresence(createOpen, 280);
  const listDialogPresence = usePresence(listDialogOpen, 280);
  const shortcutsPresence = usePresence(shortcutsOpen, 280);
  const settingsPresence = usePresence(settingsOpen, 280);
  const statsPresence = usePresence(statsOpen, 280);
  const batchEditPresence = usePresence(batchEditOpen, 280);
  const commandPalettePresence = usePresence(commandPaletteOpen, 220);
  const confirmPresence = usePresence(confirmState, 280);
  const recurringDialogPresence = usePresence(recurringDialogOpen, 280);
  const calendarEventDialogPresence = usePresence(calendarEventDialogOpen, 280);

  const openMobileSidebar = useCallback(() => {
    setMenuOpen(false);
    setMobileSidebarOpen(true);
  }, []);
  const closeMobileSidebar = useCallback(() => setMobileSidebarOpen(false), []);
  const openCreateDialog = useCallback(() => setCreateOpen(true), []);
  const openSettingsDialog = useCallback(() => {
    setMenuOpen(false);
    setMobileSidebarOpen(false);
    setSettingsOpen(true);
  }, []);
  const openStatsDialog = useCallback(() => {
    setMenuOpen(false);
    setMobileSidebarOpen(false);
    setStatsOpen(true);
  }, []);
  const openAddListDialog = useCallback(() => {
    setMobileSidebarOpen(false);
    setEditingList(null);
    setListDialogOpen(true);
  }, []);
  const openEditListDialog = useCallback((list: TaskList) => {
    setMobileSidebarOpen(false);
    setEditingList(list);
    setListDialogOpen(true);
  }, []);
  const openNewRecurringDialog = useCallback(() => {
    setEditingRecurringRule(null);
    setRecurringSourceTask(null);
    setRecurringDialogOpen(true);
  }, []);
  const openNewCalendarEvent = useCallback((date: string) => {
    setEditingCalendarEvent(null);
    setEventDialogDefaultDate(date);
    setCalendarEventDialogOpen(true);
  }, []);
  const openEditCalendarEvent = useCallback((event: CalendarEvent) => {
    setEditingCalendarEvent(event);
    setCalendarEventDialogOpen(true);
  }, []);

  const closeDialogs = useCallback(() => {
    setMenuOpen(false);
    setMobileSidebarOpen(false);
    setCreateOpen(false);
    setListDialogOpen(false);
    setShortcutsOpen(false);
    setSettingsOpen(false);
    setStatsOpen(false);
    setBatchEditOpen(false);
    setCommandPaletteOpen(false);
    setConfirmState(null);
    setRecurringDialogOpen(false);
    setEditingRecurringRule(null);
    setRecurringSourceTask(null);
    setCalendarEventDialogOpen(false);
    setEditingCalendarEvent(null);
  }, []);

  return {
    menuOpen,
    mobileSidebarOpen,
    createOpen,
    listDialogOpen,
    editingList,
    shortcutsOpen,
    settingsOpen,
    statsOpen,
    batchEditOpen,
    commandPaletteOpen,
    confirmState,
    recurringDialogOpen,
    editingRecurringRule,
    recurringSourceTask,
    calendarEventDialogOpen,
    editingCalendarEvent,
    eventDialogDefaultDate,
    createPresence,
    listDialogPresence,
    shortcutsPresence,
    settingsPresence,
    statsPresence,
    batchEditPresence,
    commandPalettePresence,
    confirmPresence,
    recurringDialogPresence,
    calendarEventDialogPresence,
    setMenuOpen,
    setMobileSidebarOpen,
    setCreateOpen,
    setListDialogOpen,
    setEditingList,
    setShortcutsOpen,
    setSettingsOpen,
    setStatsOpen,
    setBatchEditOpen,
    setCommandPaletteOpen,
    setConfirmState,
    setRecurringDialogOpen,
    setEditingRecurringRule,
    setRecurringSourceTask,
    setCalendarEventDialogOpen,
    setEditingCalendarEvent,
    setEventDialogDefaultDate,
    openCreateDialog,
    openSettingsDialog,
    openStatsDialog,
    openAddListDialog,
    openEditListDialog,
    openNewRecurringDialog,
    openNewCalendarEvent,
    openEditCalendarEvent,
    openMobileSidebar,
    closeMobileSidebar,
    closeDialogs,
  };
}
