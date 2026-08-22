# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

Torder（今序）是本地优先的 Windows 桌面待办应用：React 19 + Vite 7 + Zustand 前端，Rust + Tauri 2 外壳，数据存本机 SQLite（`%APPDATA%\com.zhaxideler.torder\torder.sqlite`），无账号、无云端同步。

前端入口 `src/main.tsx` → `src/app/App.tsx`；Rust 入口 `src-tauri/src/main.rs` → `src-tauri/src/lib.rs`。

## 常用命令

包管理器固定 pnpm（`pnpm@11.1.3`，`onlyBuiltDependencies: esbuild`）。

```bash
pnpm install
pnpm dev            # 只起 Vite（端口 1420，strictPort）→ 浏览器 mock 模式
pnpm tauri dev      # 完整桌面应用（会自动先跑 pnpm dev）
pnpm build          # tsc 类型检查 + Vite 构建
pnpm lint           # ESLint flat config
pnpm format         # Prettier --write
pnpm format:check   # Prettier --check
```

Rust 测试（前端无测试框架）：

```bash
cd src-tauri
cargo +stable-x86_64-pc-windows-msvc test                                    # 全部（含 lib 内单测）
cargo +stable-x86_64-pc-windows-msvc test --test database_test               # 集成测试文件
cargo +stable-x86_64-pc-windows-msvc test --lib                              # 只跑 migrations/recurrence 内联单测
cargo +stable-x86_64-pc-windows-msvc test monthly_clamps_to_last_day         # 单个用例
```

必须用 MSVC toolchain。MinGW 下 `cargo test` 会因 `cdylib` 导出符号溢出而失败。

测试分三处：`tests/database_test.rs`（6 个集成用例，真实建库落盘）、`src/db/migrations.rs` 内联单测（旧 `repeat_rule` 迁移）、`src/recurrence.rs` 内联单测（月末夹取、跨年季度、多星期几）。

## 双运行模式：browser mock vs Tauri

`src/services/` 里每个函数都先判断 `isTauri()`（来自 `@tauri-apps/api/core`）：

- **false（`pnpm dev`）**：走内存 mock。`browserTaskMock.ts` 预置 12 条任务，`browserTaskQuery.ts` 用 TS 复刻后端筛选/排序，`recurringService.ts` / `listService.ts` / `settingsService.ts` / `backupService.ts` 各自维护模块级数组。纯 UI 工作不需要 SQLite 和 Rust。
- **true（`pnpm tauri dev`）**：`invoke()` 打到 Rust command。

**改这里要注意**：mock 分支和 Rust 仓储层是两套独立实现的同一份语义。有两条必须同步的线：

1. 查询语义 —— `task_repository.rs` 的 `push_view_scope` / `sort_clause` ↔ `browserTaskQuery.ts` 的 `matchesSystemView` / `compareTasks`，另外侧栏角标 `taskHelpers.ts::buildCounts` 也是第三份手写口径，三处漂移会让角标和列表条数对不上。
2. 循环日期推算 —— `src-tauri/src/recurrence.rs::next_occurrence`（chrono + chrono-tz，带时区/DST 处理）↔ `recurringService.ts::nextOccurrence`（本地 `Date` 近似实现）。mock 侧不做时区，只求界面能跑通。

新增一个 Tauri command 的三步：`src-tauri/src/commands/` 加 handler → `lib.rs` 的 `invoke_handler!` 注册 → `src/services/` 加带 `isTauri()` 分支的包装函数。

## 架构分层

```
src/
  app/          App.tsx（顶层编排）、theme.ts、taskDates.ts、taskViews.ts（视图文案表）
  components/   layout / task（四种布局）/ recurring / detail / dialog / common
  services/     isTauri() 分流 + invoke 包装 + browser mock
  stores/       taskStore.ts（唯一 Zustand store）
  constants/    taskConfig / listConfig / reminderConfig
  hooks/        useAppInit / useKeyboardShortcuts / usePresence / useTaskReminder / useToast / useTrayQuickAdd
  utils/        taskHelpers（含侧栏计数 + TaskDraft 构造）、calendarHelpers、recurringHelpers
  styles/       globals.css 汇总 import tailwindcss + 14 个模块化 CSS
src-tauri/src/
  commands/     app / database / task / recurring / list / settings / backup
                —— 只做 State 取出 + 错误 to_string
  db/           Database（每次操作新开 Connection）+ 四个 Repository + migrations
  models.rs     所有结构体 serde(rename_all = "camelCase")
  recurrence.rs 循环日期推算 + 排期校验（chrono / chrono-tz，纯函数）
  recurring_scheduler.rs  独立线程轮询生成到期实例
  notifier.rs   独立线程轮询提醒
  tray.rs       托盘 + 拦截关闭
  error.rs      RepositoryError → command 层映射为 String
```

### 状态流

`taskStore` 是任务的唯一数据源。关键点：`loadTasks()` 每次并发发**两个**查询——一份无过滤的 `allTasks`（供侧栏计数 `buildCounts()`、统计弹窗、详情面板按 id 查找）、一份当前 scope/搜索/排序下的 `tasks`（供列表渲染）。所有 mutation（增删改、批量）都走 `runMutation()` 再 `loadTasks()` 全量刷新，没有乐观更新。`taskRequestSequence` 用于丢弃过期响应。

`App.tsx` 自己持有的本地 state：`lists`、`settings`、`recurringRules` + `recurringViewActive`、`autoBackup`、各类弹窗开关；任务相关一律经 store。**循环规则不在 store 里**，由 `App.tsx` 用 `loadRecurringRules()` 手工刷新，且凡是会产出/删除任务实例的操作都要同时 `useTaskStore.getState().loadTasks()`（见 `handleCreateRecurring` 等）。

`recurringViewActive` 为 true 时整块内容区被 `RecurringRulesView` 顶替，四种布局都不渲染，`MainHeader` 也会隐藏布局切换控件。

### 视图与枚举

系统视图 7 个：`all | today | planned | overdue | no-date | important | completed`（`taskConfig.ts::systemNav` 决定侧栏顺序，`taskViews.ts::taskViewCopy` 提供标题与空态文案，两处必须同时加）。布局 `list | board | calendar | month`（month 是月历网格，叠加任务落点与 `calendar_events` 日程事件），排序 `priority | date | created`，优先级 `2=高 | 1=中 | 0=低`。循环频率 `daily | weekly | monthly | quarterly`。

`TaskScope` 是判别联合：`{kind:"view",view}` 或 `{kind:"list",listId}`；跨 IPC 时拍平成 `scopeKind`/`scopeValue`（见 `taskService.queryTasks`）。

### 数据库

- 当前 schema version 以 `db/migrations.rs` 的 `CURRENT_SCHEMA_VERSION` 为准（即 `MIGRATIONS` 数组最后一项）。启动时按 `version >` 当前值顺序执行，每条一个事务并写入 `schema_migrations`。**只追加，永不改历史迁移**。测试与备份校验都引用该常量，所以加迁移不需要改断言里的字面量。
- 迁移脉络：1 建表 → 2 写入默认设置 → 3 对齐原型（重建 tasks、丢掉 tags、固化三个默认清单）→ 4 Dracula 配色 → 5 提醒列 → 6 `repeat_rule` → 7 循环规则表（并把存量 `repeat_rule` 任务迁成 `legacy-<id>` 规则）→ 8 收窄循环实例唯一索引到未删除任务 → 9 日程事件表 `calendar_events`（假期/出差，多日闭区间）。
- 三个默认清单 `work`/`personal`/`study` 由 `Database::initialize_default_lists` 用 `INSERT OR IGNORE` 保证存在，`is_default = 1` 不可删除。
- 软删除：`tasks.deleted_at` / `recurring_rules.deleted_at`，所有查询都带 `deleted_at IS NULL`。
- `Database` 只存路径（`Clone`，可以直接交给后台线程），`connect()` 每次新建 Connection 并设 `busy_timeout(5s)` + `foreign_keys=ON / WAL / synchronous=NORMAL`；没有连接池。

### 循环任务

数据模型是「规则表 + 生成实例」：`recurring_rules` 存排期，生成出的普通任务带 `recurring_rule_id` + `occurrence_at` 指回规则。唯一索引 `(recurring_rule_id, occurrence_at) WHERE deleted_at IS NULL` 保证同一 occurrence 至多一条存活任务——插入用 `INSERT OR IGNORE` 天然幂等，且用户删掉某个实例后还能重新生成（这正是迁移 8 修的 bug，别把索引条件改回去）。

- `recurring_scheduler.rs` 起独立线程每 60 秒调 `generate_due()`，有产出就 emit `recurring-tasks-generated`，`App.tsx` 收到后刷新任务列表。`create_recurring_rule` / `update_recurring_rule` 命令内部也各跑一次 `generate_due()`，所以规则一存盘就能立刻看到首个实例。
- `generate_due_at()` 从 `next_due_at` 开始往前走，`due - generate_ahead_minutes <= now` 的 occurrence 才生成，**只落最新一条**，然后把游标写回 `next_due_at`；越过 `end_at` 就把 `next_due_at` 置空并 `enabled = 0`。循环上限 10000 次防死循环。
- `update()` 只在**排期字段**（frequency / interval / weekdays / monthDay / firstDueAt / timezone）变化时才重排 `next_due_at`，改标题、备注、优先级、清单、提醒不会把进度倒回首次到期时间——否则用户之前的「跳过」会被静默作废。
- 删除规则分两档：`deleteFutureTasks = false` 只软删规则，`true` 会连带软删该规则下 `due_at >= now` 的未完成任务（`ConfirmDialog` 的主/次按钮对应这两条）。
- 前端只保留当前 UI 会调用的循环规则 service；无入口的 mock 备用生成出口已清理。后端 `generate_due_recurring_tasks` command 仍由 Tauri 调度/命令层使用。

### 提醒机制

任务的 `remind_before`（分钟数）+ `due_at` 在写入时由 `task_repository.rs::compute_remind_at` 算出 `remind_at`（`emptyDraft` 默认 1440 分钟 = 提前一天；计算结果已过期则存 `None`）。循环实例的 `remind_at` 由 `recurring_repository.rs::insert_occurrence` 单独算。

`notifier.rs` 起独立线程每 60 秒扫一次 `remind_at <= now AND reminded_at IS NULL`。**认领与发送必须原子**：先在一个 `IMMEDIATE` 事务里查出待提醒任务并按 id 精确 `UPDATE ... WHERE reminded_at IS NULL` 认领，提交成功后才对认领到的那批 emit `task-reminder`。早先的两条独立语句实现会漏提醒（打了 `reminded_at` 却没发事件），改这里不要退回去。前端 `useTaskReminder` 监听后走 Web Notification API。更新任务时若 `due_at` 变了会清空 `reminded_at` 以便重新提醒。

### 备份 / 导出 / 恢复

`commands/backup.rs`，全部落在 app data dir 下：备份 `backups/torder-backup-<本地时间戳>.sqlite`（`VACUUM INTO`），导出 `exports/torder-export-<戳>.{json,md,csv}`。设置里的 `autoBackup` 开关为 true 时，`lib.rs::run_startup_backup_if_enabled` 在 setup 阶段跑一次备份。

`restore_backup` 是安全敏感入口（`tauri.conf.json` 的 `csp` 为 `null`，webview 能传任意路径），已有四道校验，改动前先读注释：路径必须 canonicalize 后落在 `backups/` 内（防 `..` 与符号链接）、扩展名 `.sqlite`、`PRAGMA integrity_check` 通过、`schema_migrations` 最大版本存在且 `<= CURRENT_SCHEMA_VERSION` 且含 `tasks`/`lists` 表。覆盖前会先把当前库拷成 `torder-prerestore-*.sqlite`，覆盖后删掉 `-wal`/`-shm`。前端恢复成功直接 `window.location.reload()`。

## 关键约定

- **严格 TypeScript**：`noUnusedLocals` + `noUnusedParameters`，多余的 import 或变量直接让 `pnpm build` 失败。
- **样式不用 Tailwind utility**：虽然装了 Tailwind 4 并在 `globals.css` 里 `@import "tailwindcss"`，JSX 里全是语义化 class（`.task-row`、`.window-titlebar`…），实际样式写在 `src/styles/*.css`，配色通过 `tokens.css` 的 CSS 变量做深浅色切换。改 UI 请沿用这套，不要往 JSX 塞 utility class。
- **无边框透明窗口**：`tauri.conf.json` 里 `decorations: false` + `transparent: true`，标题栏是 `WindowTitleBar` 组件自绘（`data-tauri-drag-region` 负责拖动）。
- **关闭 = 隐藏到托盘**：`tray.rs` 拦截 `CloseRequested` 调 `prevent_close()` 后 `hide()`。真正退出只能走托盘右键菜单；菜单里的「快速新建任务」emit `tray-quick-add`，由 `useTrayQuickAdd` 接。
- **Mica**：`lib.rs` setup 和 `set_window_material_theme` command 里 `window_vibrancy::apply_mica`，失败静默降级到 CSS 毛玻璃。
- **中文优先**：默认 zh-CN，日期用 `Intl.DateTimeFormat("zh-CN")`；清单查重在 mock 侧用 `localeCompare(name, "zh-CN", {sensitivity:"accent"})`，DB 侧靠 `COLLATE NOCASE UNIQUE`。
- **camelCase 边界**：Rust 内部 snake_case，靠 `#[serde(rename_all = "camelCase")]` 在 IPC 处转换，前端 `types/database.ts` 与之一一对应，改字段两边都要动。
- **settings 表是 key → JSON 字符串**：值一律 `JSON.stringify` 后存（`"dark"` 带引号），读取走 `settingsService.ts` 的 `parseJson` 容错。`AppSettings` 只含 `theme` / `defaultReminderMinutes`；`autoBackup` 不在其中，单独用 `getSetting`/`upsertSetting` 读写。
- **弹窗进出场动画**：统一用 `usePresence(open, 280)`，返回 `rendered`（是否挂载）+ `phase`（enter/exit），组件根据 phase 加 class。`ConfirmDialog` 用 `usePresence(confirmState, 280)` 顺带保留退场期间的旧数据。新增弹窗照这个模式来。
- **版本号三处同步**：`package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 当前都是 `2.2.0`。
- `docs/`、`output/`、`.workbuddy/`、`.agents/`、`原型图设计稿/`、`*.sqlite` 均已 gitignore，不要提交。
- `AGENTS.md` 是给别的 agent 工具看的同类文档，内容会滞后于本文件，两者冲突时以 `CLAUDE.md` 为准。

## 快捷键（`useKeyboardShortcuts`）

`Ctrl+N` 新建弹窗（输入框内也生效）、`B` 批量模式、`?` 快捷键面板、`Esc` 关闭一切（`closeEverything` 会顺带退出循环任务视图和批量选择）。除 `Ctrl+N` 外都会先用 `isTypingTarget()` 排除输入态。

## 打包（低内存机约束）

`RULE.md` 是权威规则，核心是**为 16GB 开发机牺牲体积换编译稳定性**：

```powershell
$env:CARGO_BUILD_JOBS = "4"
pnpm tauri build
```

- 目标固定 NSIS 单 `.exe`（不是 MSI），产物在 `src-tauri/target/release/bundle/nsis/`。需要 `makensis.exe` 在 PATH（`winget install NSIS.NSID`）。
- `[profile.release]`：`lto = false`、`codegen-units = 16`、`opt-level = "s"`、`panic = "abort"`、`strip = true`；`[profile.release.package.windows] opt-level = 0`；`.cargo/config.toml` 加 `--cfg windows_raw_dylib`。**不要在这台机器上恢复 `codegen-units = 1` 或开 LTO**，会 OOM。
- `CARGO_BUILD_JOBS=4` 限制并行 rustc；当前 pnpm 版本下不能写 `pnpm tauri build -- -j 4`（参数分隔符丢失，报 `unexpected argument '-j'`）。
- `nsis-hooks.nsh` 负责把 `WebView2Loader.dll` 从若干可能位置拷到安装目录，这是为解决安装后缺 DLL 的兜底，别随手删。

## 验证建议

改 Rust 仓储/迁移 → 跑 `cargo test`（`database_test.rs` 覆盖建库、视图排序、千条搜索、循环幂等生成、循环编辑保留进度）。改循环日期推算 → `recurrence.rs` 内联单测。改前端 → `pnpm build`（tsc 严格模式是主要防线）+ `pnpm lint`。UI 交互改动优先用 `pnpm dev` 在浏览器 mock 里验，比起完整 `pnpm tauri dev` 快得多；只有涉及托盘、窗口、Mica、提醒事件、循环调度线程、备份/恢复时才需要真实 Tauri 运行。
