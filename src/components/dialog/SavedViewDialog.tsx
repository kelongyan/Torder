import { useMemo, useState } from "react";
import { Calendar, Filter, Save, Star, Tag } from "lucide-react";
import {
  layoutOptions,
  sortOptions,
  systemNav,
} from "../../constants/taskConfig";
import { taskViewCopy } from "../../constants/taskViews";
import type {
  TaskLayout,
  TaskList,
  TaskScope,
  TaskSortBy,
  SystemView,
} from "../../types/database";
import type { SavedTaskView, SavedViewIcon } from "../../types/settings";
import type { PresencePhase } from "../../hooks/usePresence";
import { Select, type SelectOption } from "../common/Select";
import { DialogFooter } from "./DialogFooter";
import { DialogShell } from "./DialogShell";

const iconOptions: SelectOption<SavedViewIcon>[] = [
  { value: "filter", label: "筛选", icon: Filter },
  { value: "star", label: "重点", icon: Star },
  { value: "calendar", label: "日期", icon: Calendar },
  { value: "tag", label: "标签", icon: Tag },
];

export function SavedViewDialog({
  view,
  lists,
  currentState,
  presence,
  onClose,
  onSubmit,
}: {
  view: SavedTaskView | null;
  lists: TaskList[];
  currentState: {
    scope: TaskScope;
    query: string;
    sortBy: TaskSortBy;
    showCompleted: boolean;
    layout: TaskLayout;
  };
  presence: PresencePhase;
  onClose: () => void;
  onSubmit: (view: SavedTaskView) => Promise<void> | void;
}) {
  const scopeOptions = useMemo<SelectOption<string>[]>(
    () => [
      ...systemNav.map((item) => ({
        value: scopeToValue({ kind: "view", view: item.view } as TaskScope),
        label: taskViewCopy[item.view].title,
        icon: item.icon,
      })),
      ...lists.map((list) => ({
        value: scopeToValue({ kind: "list", listId: list.id }),
        label: list.name,
        dotColor: list.color ?? undefined,
      })),
    ],
    [lists],
  );
  const [name, setName] = useState(view?.name ?? "");
  const [icon, setIcon] = useState<SavedViewIcon>(view?.icon ?? "filter");
  const [scopeValue, setScopeValue] = useState(
    scopeToValue(view?.scope ?? currentState.scope),
  );
  const [query, setQuery] = useState(view?.query ?? currentState.query);
  const [sortBy, setSortBy] = useState<TaskSortBy>(
    view?.sortBy ?? currentState.sortBy,
  );
  const [layout, setLayout] = useState<TaskLayout>(
    view?.layout ?? currentState.layout,
  );
  const [showCompleted, setShowCompleted] = useState(
    view?.showCompleted ?? currentState.showCompleted,
  );
  const [touched, setTouched] = useState(false);

  async function submit() {
    setTouched(true);
    if (!name.trim()) return;
    await onSubmit({
      id: view?.id ?? `saved-view-${Date.now()}`,
      name: name.trim(),
      icon,
      scope: valueToScope(scopeValue),
      query: query.trim(),
      sortBy,
      showCompleted,
      layout,
    });
  }

  return (
    <DialogShell
      title={view ? "编辑保存视图" : "保存当前筛选"}
      icon={Save}
      presence={presence}
      width="520px"
      onClose={onClose}
      overlayClassName="saved-view-dialog"
    >
      <form
        className="dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="form-title-field">
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={touched && !name.trim() ? "invalid" : ""}
            placeholder="视图名称"
          />
          {touched && !name.trim() && (
            <span className="form-title-error">视图名称不能为空</span>
          )}
        </div>

        <div className="form-grid">
          <div className="form-field">
            <span>图标</span>
            <Select
              value={icon}
              options={iconOptions}
              onChange={setIcon}
              ariaLabel="保存视图图标"
            />
          </div>
          <div className="form-field">
            <span>范围</span>
            <Select
              value={scopeValue}
              options={scopeOptions}
              onChange={setScopeValue}
              ariaLabel="保存视图范围"
            />
          </div>
          <div className="form-field form-grid-full">
            <span>搜索条件</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="例如 tag:项目 p:2 due:今天"
            />
          </div>
          <div className="form-field">
            <span>排序</span>
            <Select
              value={sortBy}
              options={sortOptions}
              onChange={setSortBy}
              ariaLabel="保存视图排序"
            />
          </div>
          <div className="form-field">
            <span>布局</span>
            <Select
              value={layout}
              options={layoutOptions}
              onChange={setLayout}
              ariaLabel="保存视图布局"
            />
          </div>
          <label className="settings-toggle form-grid-full">
            <span>显示已完成</span>
            <input
              type="checkbox"
              checked={showCompleted}
              onChange={(event) => setShowCompleted(event.target.checked)}
            />
          </label>
        </div>

        <DialogFooter
          onCancel={onClose}
          submitLabel={view ? "保存视图" : "创建视图"}
        />
      </form>
    </DialogShell>
  );
}

function scopeToValue(scope: TaskScope): string {
  return scope.kind === "view" ? `view:${scope.view}` : `list:${scope.listId}`;
}

function valueToScope(value: string): TaskScope {
  if (value.startsWith("list:")) {
    return { kind: "list", listId: value.slice(5) };
  }
  const view = value.slice(5) as SystemView;
  return { kind: "view", view };
}
