import { useEffect, useRef, useState } from "react";
import { FileUp, RefreshCw } from "lucide-react";
import type {
  CreateTaskInput,
  RecurringRule,
  Task,
  TaskList,
} from "../../types/database";
import type { ToastKind } from "../../types/ui";
import { createTask, updateTask } from "../../services/taskService";
import { createList, listLists } from "../../services/listService";
import { createRecurringRule } from "../../services/recurringService";
import {
  importBackupSelection,
  listBackups,
  previewBackupImport,
  type BackupImportPreview,
} from "../../services/backupService";

type ImportKind = "csv" | "markdown" | "json";

interface ImportPreview {
  kind: ImportKind;
  name: string;
  lists: Array<Pick<TaskList, "id" | "name" | "color">>;
  tasks: Array<Partial<Task> & CreateTaskInput>;
  recurringRules: Array<Partial<RecurringRule>>;
}

export function SettingsImportSection({
  lists,
  onToast,
  onImported,
}: {
  lists: TaskList[];
  onToast: (message: string, type: ToastKind) => void;
  onImported: () => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [includeLists, setIncludeLists] = useState(true);
  const [includeTasks, setIncludeTasks] = useState(true);
  const [includeRecurring, setIncludeRecurring] = useState(true);
  const [backupPaths, setBackupPaths] = useState<string[]>([]);
  const [backupPreview, setBackupPreview] =
    useState<BackupImportPreview | null>(null);

  useEffect(() => {
    let mounted = true;
    void listBackups()
      .then((backups) => {
        if (mounted) setBackupPaths(backups);
      })
      .catch((error) => {
        if (mounted) onToast(`读取备份失败: ${String(error)}`, "error");
      });
    return () => {
      mounted = false;
    };
  }, [onToast]);

  async function loadBackupOptions(showToast = true) {
    try {
      const backups = await listBackups();
      setBackupPaths(backups);
      if (!backups.some((path) => path === backupPreview?.path)) {
        setBackupPreview(null);
      }
      if (showToast) onToast("备份列表已刷新", "success");
    } catch (error) {
      onToast(`读取备份失败: ${String(error)}`, "error");
    }
  }

  async function handleFile(file: File) {
    try {
      const text = await file.text();
      const nextPreview = parseImportFile(file.name, text, lists);
      setBackupPreview(null);
      setPreview(nextPreview);
      setIncludeLists(nextPreview.lists.length > 0);
      setIncludeTasks(nextPreview.tasks.length > 0);
      setIncludeRecurring(nextPreview.recurringRules.length > 0);
    } catch (error) {
      onToast(`导入预览失败: ${String(error)}`, "error");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleBackupPreview(path: string) {
    if (!path) {
      setBackupPreview(null);
      return;
    }
    try {
      const nextPreview = await previewBackupImport(path);
      setPreview(null);
      setBackupPreview(nextPreview);
      setIncludeLists(nextPreview.listCount > 0);
      setIncludeTasks(nextPreview.taskCount > 0);
      setIncludeRecurring(nextPreview.recurringRuleCount > 0);
    } catch (error) {
      onToast(`备份预览失败: ${String(error)}`, "error");
    }
  }

  async function importPreview() {
    if (!preview || busy) return;
    setBusy(true);
    try {
      let importedLists = 0;
      let importedTasks = 0;
      let importedRules = 0;
      let nextLists = await listLists();
      const listIdMap = new Map<string, string>();
      for (const list of nextLists) listIdMap.set(list.id, list.id);

      if (includeLists) {
        for (const list of preview.lists) {
          const existing = nextLists.find((item) => item.name === list.name);
          if (existing) {
            listIdMap.set(list.id, existing.id);
            continue;
          }
          const created = await createList({
            name: list.name,
            color: list.color ?? null,
          });
          listIdMap.set(list.id, created.id);
          importedLists += 1;
          nextLists = await listLists();
        }
      }

      if (includeTasks) {
        for (const task of preview.tasks) {
          const listId = mapListId(task.listId, listIdMap, nextLists);
          const created = await createTask({
            title: task.title,
            note: task.note ?? null,
            priority: task.priority ?? 1,
            listId,
            dueAt: task.dueAt ?? null,
            remindBefore: task.remindBefore ?? null,
            tags: task.tags ?? [],
            subtasks: task.subtasks ?? [],
          });
          if (task.status && task.status !== "todo") {
            await updateTask({
              id: created.id,
              title: created.title,
              note: created.note,
              status: task.status,
              priority: created.priority,
              listId: created.listId,
              dueAt: created.dueAt,
              sortOrder: created.sortOrder,
              remindBefore: created.remindBefore,
              repeatRule: created.repeatRule,
              subtasks: created.subtasks,
              tags: created.tags,
            });
          }
          importedTasks += 1;
        }
      }

      if (includeRecurring) {
        for (const rule of preview.recurringRules) {
          if (!rule.title || !rule.frequency || !rule.firstDueAt) continue;
          await createRecurringRule({
            sourceTaskId: null,
            title: rule.title,
            note: rule.note ?? null,
            priority: rule.priority ?? 1,
            listId: mapListId(rule.listId, listIdMap, nextLists),
            frequency: rule.frequency,
            intervalCount: rule.intervalCount ?? 1,
            weekdays: rule.weekdays ?? [],
            monthDay: rule.monthDay ?? null,
            firstDueAt: rule.firstDueAt,
            timezone:
              rule.timezone ||
              Intl.DateTimeFormat().resolvedOptions().timeZone ||
              "UTC",
            generateAheadMinutes: rule.generateAheadMinutes ?? 0,
            remindBefore: rule.remindBefore ?? null,
            endAt: rule.endAt ?? null,
          });
          importedRules += 1;
        }
      }

      await onImported();
      setPreview(null);
      onToast(
        `已导入 ${importedLists} 个清单、${importedTasks} 个任务、${importedRules} 条循环规则`,
        "success",
      );
    } catch (error) {
      onToast(`导入失败: ${String(error)}`, "error");
    } finally {
      setBusy(false);
    }
  }

  async function importBackupPreview() {
    if (!backupPreview || busy) return;
    setBusy(true);
    try {
      const result = await importBackupSelection(backupPreview.path, {
        includeLists,
        includeTasks,
        includeRecurringRules: includeRecurring,
      });
      await onImported();
      setBackupPreview(null);
      onToast(
        `已从备份导入 ${result.importedLists} 个清单、${result.importedTasks} 个任务、${result.importedRecurringRules} 条循环规则`,
        "success",
      );
    } catch (error) {
      onToast(`备份导入失败: ${String(error)}`, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-section">
      <h3 className="settings-section-title">
        <FileUp aria-hidden="true" className="icon-sm" />
        导入
      </h3>
      <div className="settings-import-panel">
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.md,.markdown,.json,application/json,text/csv,text/markdown"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
        <button
          type="button"
          className="btn-secondary"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          <FileUp aria-hidden="true" className="icon-sm" />
          选择文件
        </button>
        <div className="settings-import-backup">
          <div className="settings-import-backup-head">
            <span>旧备份</span>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => void loadBackupOptions()}
              disabled={busy}
            >
              <RefreshCw aria-hidden="true" className="icon-sm" />
              刷新
            </button>
          </div>
          <select
            value={backupPreview?.path ?? ""}
            onChange={(event) => void handleBackupPreview(event.target.value)}
            disabled={busy || backupPaths.length === 0}
            aria-label="选择旧备份"
          >
            <option value="">
              {backupPaths.length === 0 ? "暂无本地备份" : "选择旧备份"}
            </option>
            {backupPaths.map((path) => (
              <option key={path} value={path}>
                {backupName(path)}
              </option>
            ))}
          </select>
        </div>
        {preview && (
          <div className="settings-import-preview">
            <strong>{preview.name}</strong>
            <span>
              {preview.lists.length} 个清单 · {preview.tasks.length} 个任务 ·{" "}
              {preview.recurringRules.length} 条循环规则
            </span>
            <label>
              <input
                type="checkbox"
                checked={includeLists}
                disabled={preview.lists.length === 0}
                onChange={(event) => setIncludeLists(event.target.checked)}
              />
              清单
            </label>
            <label>
              <input
                type="checkbox"
                checked={includeTasks}
                disabled={preview.tasks.length === 0}
                onChange={(event) => setIncludeTasks(event.target.checked)}
              />
              任务
            </label>
            <label>
              <input
                type="checkbox"
                checked={includeRecurring}
                disabled={preview.recurringRules.length === 0}
                onChange={(event) => setIncludeRecurring(event.target.checked)}
              />
              循环规则
            </label>
            <button
              type="button"
              className="btn-primary"
              onClick={() => void importPreview()}
              disabled={
                busy || (!includeLists && !includeTasks && !includeRecurring)
              }
            >
              <RefreshCw aria-hidden="true" className="icon-sm" />
              导入选中
            </button>
          </div>
        )}
        {backupPreview && (
          <div className="settings-import-preview">
            <strong>{backupPreview.name}</strong>
            <span>
              {backupPreview.listCount} 个清单 · {backupPreview.taskCount}{" "}
              个任务 · {backupPreview.recurringRuleCount} 条循环规则
            </span>
            <label>
              <input
                type="checkbox"
                checked={includeLists}
                disabled={backupPreview.listCount === 0}
                onChange={(event) => setIncludeLists(event.target.checked)}
              />
              清单
            </label>
            <label>
              <input
                type="checkbox"
                checked={includeTasks}
                disabled={backupPreview.taskCount === 0}
                onChange={(event) => setIncludeTasks(event.target.checked)}
              />
              任务
            </label>
            <label>
              <input
                type="checkbox"
                checked={includeRecurring}
                disabled={backupPreview.recurringRuleCount === 0}
                onChange={(event) => setIncludeRecurring(event.target.checked)}
              />
              循环规则
            </label>
            <button
              type="button"
              className="btn-primary"
              onClick={() => void importBackupPreview()}
              disabled={
                busy || (!includeLists && !includeTasks && !includeRecurring)
              }
            >
              <RefreshCw aria-hidden="true" className="icon-sm" />
              导入选中
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function backupName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function parseImportFile(
  fileName: string,
  text: string,
  lists: TaskList[],
): ImportPreview {
  const lower = fileName.toLocaleLowerCase("zh-CN");
  if (lower.endsWith(".json")) return parseJsonImport(fileName, text);
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
    return parseMarkdownImport(fileName, text, lists);
  }
  return parseCsvImport(fileName, text, lists);
}

function parseJsonImport(fileName: string, text: string): ImportPreview {
  const payload = JSON.parse(text) as {
    lists?: ImportPreview["lists"];
    tasks?: ImportPreview["tasks"];
    recurringRules?: ImportPreview["recurringRules"];
  };
  return {
    kind: "json",
    name: fileName,
    lists: Array.isArray(payload.lists) ? payload.lists : [],
    tasks: Array.isArray(payload.tasks) ? payload.tasks : [],
    recurringRules: Array.isArray(payload.recurringRules)
      ? payload.recurringRules
      : [],
  };
}

function parseCsvImport(
  fileName: string,
  text: string,
  lists: TaskList[],
): ImportPreview {
  const rows = parseCsv(text);
  const [header = [], ...records] = rows;
  const normalizedHeader = header.map((item) => item.trim());
  const tasks = records
    .map((record) => rowToObject(normalizedHeader, record))
    .filter((row) => row.title)
    .map((row) => ({
      title: row.title,
      note: row.note || null,
      status: isTaskStatus(row.status) ? row.status : "todo",
      priority: parsePriority(row.priority),
      listId: findListId(row.listId || row.list || row.listName, lists),
      dueAt: normalizeDate(row.dueAt),
      remindBefore: parseNullableNumber(row.remindBefore),
      tags: row.tags ? row.tags.split(/[|,，、\s]+/).filter(Boolean) : [],
      subtasks: [],
    }));
  return { kind: "csv", name: fileName, lists: [], tasks, recurringRules: [] };
}

function parseMarkdownImport(
  fileName: string,
  text: string,
  lists: TaskList[],
): ImportPreview {
  let currentListName = "工作";
  const importLists = new Map<string, ImportPreview["lists"][number]>();
  const tasks: ImportPreview["tasks"] = [];
  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      currentListName = heading[1].trim();
      if (!lists.some((list) => list.name === currentListName)) {
        importLists.set(currentListName, {
          id: `import-list-${currentListName}`,
          name: currentListName,
          color: null,
        });
      }
      continue;
    }
    const item = line.match(/^-\s+\[( |x|X)\]\s+(.+)$/);
    if (!item) continue;
    tasks.push({
      title: item[2].replace(/·.+$/, "").trim(),
      note: null,
      status: item[1].toLowerCase() === "x" ? "done" : "todo",
      priority: inferPriority(item[2]),
      listId:
        findListId(currentListName, lists) ?? `import-list-${currentListName}`,
      dueAt: null,
      remindBefore: null,
      tags: [],
      subtasks: [],
    });
  }
  return {
    kind: "markdown",
    name: fileName,
    lists: [...importLists.values()],
    tasks,
    recurringRules: [],
  };
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted && char === '"' && next === '"') {
      field += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && char === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += char;
  }
  row.push(field);
  if (row.some((item) => item.trim())) rows.push(row);
  return rows;
}

function rowToObject(header: string[], row: string[]): Record<string, string> {
  return Object.fromEntries(
    header.map((key, index) => [key, row[index] ?? ""]),
  );
}

function findListId(value: string | null | undefined, lists: TaskList[]) {
  if (!value) return undefined;
  const exact = lists.find((list) => list.id === value || list.name === value);
  return exact?.id ?? value;
}

function mapListId(
  value: string | null | undefined,
  map: Map<string, string>,
  lists: TaskList[],
): string {
  if (!value) return "work";
  return (
    map.get(value) ?? lists.find((list) => list.id === value)?.id ?? "work"
  );
}

function normalizeDate(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parsePriority(value: string | undefined): 0 | 1 | 2 {
  if (value === "2" || value === "高") return 2;
  if (value === "0" || value === "低") return 0;
  return 1;
}

function inferPriority(text: string): 0 | 1 | 2 {
  if (text.includes("优先级 高")) return 2;
  if (text.includes("优先级 低")) return 0;
  return 1;
}

function parseNullableNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isTaskStatus(value: string | undefined): value is Task["status"] {
  return value === "todo" || value === "done" || value === "archived";
}
