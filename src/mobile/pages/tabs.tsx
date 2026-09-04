/**
 * mobile/pages/tabs.tsx — 四个主 Tab 落地屏（M-A 基础版）
 *   today   今日（问候 + 逾期/时间轴/全天/今日已完成 的轻量分组）
 *   browse  浏览（智能视图 8 + 清单 + 标签 + 工具）
 *   calendar 月历（复用 MonthCalendar）
 *   me      我的（设置分组入口，M-D 换真页）
 * 数据全部取自 store 的 allTasks 本地派生，不动桌面 scope/layout 状态。
 */
import { useMemo, type JSX } from "react";
import {
  AlertCircle,
  Calendar,
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  Flame,
  Hash,
  ListTodo,
  Repeat2,
  Search,
  Settings,
  Star,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { useTaskStore } from "../../stores/taskStore";
import { viewScope } from "../../stores/taskStore";
import { filterAndSortTasks, localDateKey } from "../../services/taskQuery";
import { buildCounts } from "../../utils/taskHelpers";
import type { Task } from "../../types/database";
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
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
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
          sub={`${today.getMonth() + 1}月${today.getDate()}日 · 周${weekdays[today.getDay()]}`}
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

export function MeScreen(): JSX.Element {
  const { nav } = useMobilePage();
  const props = useMobileProps();
  const syncConfigured = props.syncStatus != null;

  return (
    <ScreenShell topbar={<TopBar title="我的" />}>
      <div className="m-me-hero">
        <div className="m-me-logo">今</div>
        <div>
          <div className="m-me-name">Torder 今序</div>
          <div className="m-me-sub">本地优先 · WebDAV 多端同步</div>
        </div>
      </div>

      <SectionTitle>外观与默认</SectionTitle>
      <div className="m-group-card">
        <NavRow
          tint="var(--accent)"
          icon={<Settings aria-hidden="true" />}
          label="主题、强调色与字号"
          onClick={() => props.openSettingsDialog()}
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

      <p className="m-me-foot">Torder 今序 · 移动端界面（重构批次 M-A）</p>
    </ScreenShell>
  );
}
