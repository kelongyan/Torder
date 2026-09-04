/**
 * mobile/pages/tabs.tsx — 四个主 Tab 落地屏
 *   today   今日（问候/快捷芯片 + 逾期/时间轴/全天/今日已完成）
 *   browse  浏览（智能视图 8 + 清单 + 标签 + 工具）
 *   calendar 月历（复用 MonthCalendar）
 *   me      我的（外观真改 Sheet + 设置入口分组，M-D）
 */
import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import {
  AlertCircle,
  Calendar,
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  Flame,
  Hash,
  ListTodo,
  Monitor,
  Moon,
  Palette,
  Repeat2,
  Search,
  Settings,
  Star,
  Sun,
  Trash2,
  TrendingUp,
  Type,
} from "lucide-react";
import { useTaskStore } from "../../stores/taskStore";
import { viewScope } from "../../stores/taskStore";
import { filterAndSortTasks, localDateKey } from "../../services/taskQuery";
import { buildCounts } from "../../utils/taskHelpers";
import type { Task } from "../../types/database";
import type {
  AccentPreference,
  FontSizePreference,
  ThemePreference,
} from "../../types/settings";
import {
  applyAccentPreference,
  applyFontSizeScale,
  applyThemePreference,
} from "../../utils/theme";
import { MonthCalendar } from "../../components/task/MonthCalendar";
import { useMobilePage } from "../router";
import { useMobileProps } from "../context";
import { useTaskMore } from "../parts/TaskMoreMenu";
import { EmptyView, NavRow, ScreenShell, SectionTitle, TopBar } from "../ui";
import { MobileTaskRows } from "../parts/MobileTaskRows";

/* ================= 公共派生 ================= */

function formatHM(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}

/* ================= 今日 ================= */

export function TodayScreen(): JSX.Element {
  const { nav } = useMobilePage();
  const props = useMobileProps();
  const allTasks = useTaskStore((s) => s.allTasks);
  const sortBy = useTaskStore((s) => s.sortBy) ?? "priority";
  const sortAsc = useTaskStore((s) => s.sortAsc);
  const todayKey = useMemo(() => localDateKey(new Date()), []);

  const todayTasks = useMemo(() => {
    const rows = filterAndSortTasks(allTasks, {
      scope: viewScope("today"),
      query: "",
      sortBy,
      sortAsc,
      showCompleted: false,
    });
    return rows.filter((t) => t.status !== "done");
  }, [allTasks, sortBy, sortAsc]);

  const { overdue, timed, allday } = useMemo(() => {
    const ov: Task[] = [];
    const tm: Task[] = [];
    const al: Task[] = [];
    for (const t of todayTasks) {
      if (!t.dueAt) {
        al.push(t);
        continue;
      }
      const due = new Date(t.dueAt);
      const dueKey = localDateKey(due);
      if (dueKey < todayKey) {
        ov.push(t);
      } else if (
        dueKey === todayKey &&
        (due.getHours() !== 0 || due.getMinutes() !== 0)
      ) {
        tm.push(t);
      } else {
        al.push(t);
      }
    }
    tm.sort((a, b) => a.dueAt!.localeCompare(b.dueAt!));
    return { overdue: ov, timed: tm, allday: al };
  }, [todayTasks, todayKey]);

  const completedToday = useMemo(
    () =>
      allTasks.filter(
        (t) =>
          t.status === "done" &&
          t.completedAt != null &&
          localDateKey(new Date(t.completedAt)) === todayKey,
      ),
    [allTasks, todayKey],
  );

  const openTask = (task: Task) => nav.push(`/task/${task.id}`);
  const { openMore, moreMenu } = useTaskMore();
  const rowCtx = {
    lists: props.lists,
    attachmentCounts: props.attachmentCounts,
    onOpen: openTask,
    onToggle: props.onToggleTask,
    onDelete: props.onDeleteTask,
    onMore: openMore,
  };
  const today = new Date();
  const pendingCount = overdue.length + timed.length + allday.length;

  const quickChips: Array<{ label: string; path: string; danger?: boolean }> = [
    { label: "计划中", path: "/view/planned" },
    {
      label: `已逾期${overdue.length > 0 ? ` ${overdue.length}` : ""}`,
      path: "/view/overdue",
      danger: overdue.length > 0,
    },
    { label: "无日期", path: "/view/no-date" },
    { label: "重要", path: "/view/important" },
  ];

  return (
    <ScreenShell
      topbar={
        <TopBar
          title="Torder"
          sub="今序 · 待办清单"
          actions={[
            {
              icon: <Search aria-hidden="true" />,
              label: "搜索",
              onClick: () => nav.push("/search"),
            },
            {
              icon: <Flame aria-hidden="true" />,
              label: "专注",
              onClick: () => nav.push("/focus"),
            },
          ]}
        />
      }
    >
      <div className="m-today-hello">
        <div className="m-today-date">
          {today.getMonth() + 1}月{today.getDate()}日
        </div>
        <h2 className="m-today-greet">今天</h2>
        <div className="m-today-tip">
          {pendingCount > 0
            ? `共 ${pendingCount} 项待推进，专注当下一件事`
            : "今天没有安排，享受留白"}
        </div>
        <div className="m-chip-row">
          {quickChips.map((chip) => (
            <button
              key={chip.label}
              type="button"
              className={`m-chip ${chip.danger ? "danger" : ""}`}
              onClick={() => nav.push(chip.path)}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      {pendingCount === 0 && completedToday.length === 0 ? (
        <EmptyView
          title="今天没有任务"
          body="点击下方 ＋ 新建一项，或到「浏览」查看全部任务"
        />
      ) : (
        <>
          {overdue.length > 0 && (
            <div className="m-group-card m-group-danger">
              <div className="m-group-head">
                <span className="m-group-head-title">逾期</span>
                <span className="m-group-head-count">{overdue.length}</span>
              </div>
              <MobileTaskRows tasks={overdue} {...rowCtx} />
            </div>
          )}
          {timed.length + allday.length > 0 && (
            <div className="m-group-card">
              <div className="m-group-head">
                <span className="m-group-head-title">今天</span>
                <span className="m-group-head-count">
                  {timed.length + allday.length}
                </span>
              </div>
              <MobileTaskRows
                tasks={[...timed, ...allday]}
                {...rowCtx}
                timeGutterFor={(t) =>
                  timed.includes(t) ? formatHM(t.dueAt!) : undefined
                }
              />
            </div>
          )}
          {completedToday.length > 0 && (
            <div className="m-group-card">
              <div className="m-group-head">
                <span className="m-group-head-title">今日已完成</span>
                <span className="m-group-head-count">
                  {completedToday.length}
                </span>
              </div>
              <MobileTaskRows tasks={completedToday} {...rowCtx} />
            </div>
          )}
        </>
      )}
      {moreMenu}
    </ScreenShell>
  );
}

/* ================= 浏览 ================= */

const VIEW_ROWS: Array<{
  view:
    | "all"
    | "today"
    | "planned"
    | "overdue"
    | "no-date"
    | "important"
    | "completed"
    | "deleted";
  icon: JSX.Element;
  label: string;
  tint: string;
  danger?: boolean;
}> = [
  {
    view: "all",
    icon: <ListTodo aria-hidden="true" />,
    label: "全部任务",
    tint: "var(--accent)",
  },
  {
    view: "today",
    icon: <CalendarCheck aria-hidden="true" />,
    label: "今日任务",
    tint: "var(--accent)",
  },
  {
    view: "planned",
    icon: <CalendarClock aria-hidden="true" />,
    label: "计划中",
    tint: "var(--blue)",
  },
  {
    view: "overdue",
    icon: <AlertCircle aria-hidden="true" />,
    label: "已逾期",
    tint: "var(--red)",
    danger: true,
  },
  {
    view: "no-date",
    icon: <Calendar aria-hidden="true" />,
    label: "无截止日期",
    tint: "var(--text-3)",
  },
  {
    view: "important",
    icon: <Star aria-hidden="true" />,
    label: "重要任务",
    tint: "var(--amber)",
  },
  {
    view: "completed",
    icon: <CheckCircle2 aria-hidden="true" />,
    label: "已完成",
    tint: "var(--green)",
  },
  {
    view: "deleted",
    icon: <Trash2 aria-hidden="true" />,
    label: "回收站",
    tint: "var(--text-3)",
  },
];

export function BrowseScreen(): JSX.Element {
  const { nav } = useMobilePage();
  const props = useMobileProps();
  const allTasks = useTaskStore((s) => s.allTasks);
  const showCompleted = useTaskStore((s) => s.showCompleted);
  const counts = useMemo(
    () => buildCounts(allTasks, props.lists, showCompleted),
    [allTasks, props.lists, showCompleted],
  );
  const tagCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const task of allTasks) {
      if (task.deletedAt != null || task.status === "done") continue;
      for (const tag of task.tags) map[tag] = (map[tag] ?? 0) + 1;
    }
    return map;
  }, [allTasks]);
  const activeRules = props.recurringRules.length;

  return (
    <ScreenShell
      topbar={
        <TopBar
          title="浏览"
          actions={[
            {
              icon: <Search aria-hidden="true" />,
              label: "搜索",
              onClick: () => nav.push("/search"),
            },
          ]}
        />
      }
    >
      <SectionTitle>智能视图</SectionTitle>
      <div className="m-group-card">
        {VIEW_ROWS.map((row) => (
          <NavRow
            key={row.view}
            tint={row.tint}
            icon={row.icon}
            label={row.label}
            badge={row.view === "deleted" ? undefined : counts.views[row.view]}
            danger={row.danger && (counts.views[row.view] ?? 0) > 0}
            onClick={() => nav.push(`/view/${row.view}`)}
          />
        ))}
      </div>

      <SectionTitle>我的清单</SectionTitle>
      <div className="m-group-card">
        {props.lists.map((list) => (
          <NavRow
            key={list.id}
            tint={list.color ?? undefined}
            icon={<ListTodo aria-hidden="true" />}
            label={list.name}
            badge={counts.lists[list.id] ?? 0}
            onClick={() => nav.push(`/list/${encodeURIComponent(list.id)}`)}
          />
        ))}
        {props.lists.length === 0 && (
          <div className="m-inline-note">
            还没有清单，去桌面端或「我的」创建
          </div>
        )}
      </div>

      {props.tags.length > 0 && (
        <>
          <SectionTitle>标签</SectionTitle>
          <div className="m-group-card">
            {props.tags.map((tag) => (
              <NavRow
                key={tag}
                tint="var(--teal)"
                icon={<Hash aria-hidden="true" />}
                label={tag}
                badge={tagCounts[tag] ?? 0}
                onClick={() => nav.push(`/tag/${encodeURIComponent(tag)}`)}
              />
            ))}
          </div>
        </>
      )}

      <SectionTitle>工具</SectionTitle>
      <div className="m-group-card">
        <NavRow
          tint="var(--accent)"
          icon={<Repeat2 aria-hidden="true" />}
          label="循环任务"
          badge={activeRules}
          onClick={() => nav.push("/recurring")}
        />
        <NavRow
          tint="var(--amber)"
          icon={<Flame aria-hidden="true" />}
          label="专注模式"
          onClick={() => nav.push("/focus")}
        />
        <NavRow
          tint="var(--green)"
          icon={<TrendingUp aria-hidden="true" />}
          label="每日回顾"
          onClick={() => nav.push("/review")}
        />
      </div>
    </ScreenShell>
  );
}

/* ================= 日历 ================= */

export function CalendarScreen(): JSX.Element {
  const { nav } = useMobilePage();
  const props = useMobileProps();
  const allTasks = useTaskStore((s) => s.allTasks);
  const showCompleted = useTaskStore((s) => s.showCompleted);
  const activeTasks = useMemo(
    () =>
      allTasks.filter((t) => t.deletedAt == null && t.status !== "archived"),
    [allTasks],
  );

  return (
    <ScreenShell topbar={<TopBar title="日历" />} className="m-calendar-page">
      <MonthCalendar
        tasks={activeTasks}
        lists={props.lists}
        events={props.calendarEvents}
        showCompleted={showCompleted}
        onOpenTask={(task) => nav.push(`/task/${task.id}`)}
        onCreateTask={(date) => nav.push(`/new?scheduledDate=${date}`)}
        onCreateEvent={props.onNewCalendarEvent}
        onEditEvent={props.onEditCalendarEvent}
        onMoveTaskDate={props.onMoveTaskDate}
      />
    </ScreenShell>
  );
}

/* ================= 我的 ================= */

const THEME_LABELS: Record<ThemePreference, string> = {
  light: "浅色",
  dark: "深色",
  system: "跟随系统",
};

const ACCENT_LABELS: Array<{
  value: AccentPreference;
  label: string;
  color: string;
}> = [
  { value: "blue", label: "海蓝", color: "#6e9bff" },
  { value: "violet", label: "紫罗兰", color: "#a98af5" },
  { value: "teal", label: "青碧", color: "#4bc0c8" },
  { value: "green", label: "森绿", color: "#43c48d" },
  { value: "amber", label: "琥珀", color: "#e8b04b" },
  { value: "rose", label: "玫粉", color: "#f0819e" },
];

const FONT_LABELS: Array<{ value: FontSizePreference; label: string }> = [
  { value: "small", label: "小" },
  { value: "standard", label: "标准" },
  { value: "large", label: "大" },
];

export function MeScreen(): JSX.Element {
  const { nav } = useMobilePage();
  const props = useMobileProps();
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const syncConfigured = props.syncStatus != null;
  const accentLabel =
    ACCENT_LABELS.find((a) => a.value === props.settings.accent)?.label ?? "";

  return (
    <ScreenShell topbar={<TopBar title="我的" />}>
      <div className="m-me-hero">
        <div className="m-me-logo">今</div>
        <div>
          <div className="m-me-name">Torder 今序</div>
          <div className="m-me-sub">本地优先 · WebDAV 多端同步</div>
        </div>
      </div>

      <SectionTitle>外观与显示</SectionTitle>
      <div className="m-group-card">
        <NavRow
          tint="var(--accent)"
          icon={<Palette aria-hidden="true" />}
          label="主题与强调色"
          badge={`${THEME_LABELS[props.settings.theme] ?? "深色"} · ${accentLabel}`}
          onClick={() => setAppearanceOpen(true)}
        />
        <NavRow
          tint="var(--accent)"
          icon={<Type aria-hidden="true" />}
          label="字号"
          badge={
            FONT_LABELS.find((f) => f.value === props.settings.fontSize)
              ?.label ?? "标准"
          }
          onClick={() => setAppearanceOpen(true)}
        />
      </div>

      <SectionTitle>数据与同步</SectionTitle>
      <div className="m-group-card">
        <NavRow
          tint={syncConfigured ? "var(--green)" : "var(--amber)"}
          icon={<ListTodo aria-hidden="true" />}
          label={syncConfigured ? "WebDAV 同步已配置" : "WebDAV 同步未配置"}
          onClick={() => props.openSettingsDialog()}
        />
        <NavRow
          tint="var(--text-3)"
          icon={<Settings aria-hidden="true" />}
          label="备份、导入导出与更多设置"
          onClick={() => props.openSettingsDialog()}
        />
      </div>

      <SectionTitle>工具</SectionTitle>
      <div className="m-group-card">
        <NavRow
          tint="var(--amber)"
          icon={<Flame aria-hidden="true" />}
          label="专注模式"
          onClick={() => nav.push("/focus")}
        />
        <NavRow
          tint="var(--green)"
          icon={<TrendingUp aria-hidden="true" />}
          label="每日回顾"
          onClick={() => nav.push("/review")}
        />
        <NavRow
          tint="var(--accent)"
          icon={<Repeat2 aria-hidden="true" />}
          label="循环任务"
          onClick={() => nav.push("/recurring")}
        />
      </div>

      <p className="m-me-foot">Torder 今序 2.7.0 · 安卓移动端</p>

      {appearanceOpen && (
        <AppearanceSheet onClose={() => setAppearanceOpen(false)} />
      )}
    </ScreenShell>
  );
}

/** 外观直改 Sheet：主题三卡 + 强调色六色板 + 字号三档（真实生效并落盘） */
function AppearanceSheet({ onClose }: { onClose: () => void }): JSX.Element {
  const props = useMobileProps();
  const themeCleanup = useRef<(() => void) | null>(null);
  const { settings } = props;

  useEffect(() => () => themeCleanup.current?.(), []);

  async function persist<K extends keyof typeof settings>(
    key: K,
    value: (typeof settings)[K],
  ) {
    try {
      await props.onSavePreference(key as never, value as never);
    } catch (error) {
      props.onToast(`设置保存失败：${String(error)}`, "error");
    }
  }

  function pickTheme(theme: ThemePreference) {
    themeCleanup.current?.();
    themeCleanup.current = applyThemePreference(theme);
    void persist("theme", theme);
  }
  function pickAccent(accent: AccentPreference) {
    applyAccentPreference(accent);
    void persist("accent", accent);
  }
  function pickFont(size: FontSizePreference) {
    applyFontSizeScale(size);
    void persist("fontSize", size);
  }

  return (
    <div
      className="m-scrim m-scrim-open"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="m-sheet" role="dialog" aria-modal="true">
        <div className="m-sheet-title">外观</div>
        <div className="m-sheet-body m-appearance-body">
          <div className="m-appearance-label">主题</div>
          <div className="m-appearance-theme-grid">
            {(["light", "dark", "system"] as ThemePreference[]).map((theme) => (
              <button
                key={theme}
                type="button"
                className={`m-appearance-theme-card ${settings.theme === theme ? "active" : ""}`}
                onClick={() => {
                  navigator.vibrate?.(8);
                  pickTheme(theme);
                }}
              >
                {theme === "light" ? (
                  <Sun aria-hidden="true" />
                ) : theme === "dark" ? (
                  <Moon aria-hidden="true" />
                ) : (
                  <Monitor aria-hidden="true" />
                )}
                <span>{THEME_LABELS[theme]}</span>
              </button>
            ))}
          </div>

          <div className="m-appearance-label">强调色</div>
          <div className="m-appearance-accent-row">
            {ACCENT_LABELS.map((accent) => (
              <button
                key={accent.value}
                type="button"
                className={`m-appearance-accent ${settings.accent === accent.value ? "selected" : ""}`}
                aria-label={accent.label}
                title={accent.label}
                style={{ background: accent.color }}
                onClick={() => {
                  navigator.vibrate?.(8);
                  pickAccent(accent.value);
                }}
              />
            ))}
          </div>

          <div className="m-appearance-label">字号</div>
          <div className="m-appearance-font-row">
            {FONT_LABELS.map((font) => (
              <button
                key={font.value}
                type="button"
                className={`m-appearance-font-chip ${settings.fontSize === font.value ? "active" : ""}`}
                onClick={() => {
                  navigator.vibrate?.(8);
                  pickFont(font.value);
                }}
              >
                {font.label}
              </button>
            ))}
          </div>
        </div>
        <button type="button" className="m-sheet-cancel" onClick={onClose}>
          完成
        </button>
      </div>
    </div>
  );
}
