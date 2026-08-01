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
cargo +stable-x86_64-pc-windows-msvc test                                   # 全部
cargo +stable-x86_64-pc-windows-msvc test --test database_test              # 单个测试文件
cargo +stable-x86_64-pc-windows-msvc test initializes_migrates_and_persists # 单个用例
```

必须用 MSVC toolchain。MinGW 下 `cargo test` 会因 `cdylib` 导出符号溢出而失败。

## 双运行模式：browser mock vs Tauri

`src/services/` 里每个函数都先判断 `isTauri()`（来自 `@tauri-apps/api/core`）：

- **false（`pnpm dev`）**：走内存 mock。`browserTaskMock.ts` 预置 12 条任务，`browserTaskQuery.ts` 用 TS 复刻后端筛选/排序，`listService.ts`/`settingsService.ts` 各自维护模块级数组。纯 UI 工作不需要 SQLite 和 Rust。
- **true（`pnpm tauri dev`）**：`invoke()` 打到 Rust command。

**改这里要注意**：mock 分支和 Rust 仓储层是两套独立实现的同一份查询语义（视图过滤、排序、搜索）。改了 `task_repository.rs` 的 `push_view_scope`/`sort_clause`，必须同步改 `browserTaskQuery.ts`，否则两个模式行为漂移。

新增一个 Tauri command 的三步：`src-tauri/src/commands/` 加 handler → `lib.rs` 的 `invoke_handler!` 注册 → `src/services/` 加带 `isTauri()` 分支的包装函数。

## 架构分层

```
src/
  app/          App.tsx（顶层编排）、theme.ts、taskDates.ts、taskViews.ts（视图文案表）
  components/   layout / task（三种布局）/ detail / dialog / common
  services/     isTauri() 分流 + invoke 包装 + browser mock
  stores/       taskStore.ts（唯一 Zustand store）
  constants/    taskConfig / listConfig / reminderConfig
  hooks/        useAppInit / useKeyboardShortcuts / usePresence / useTaskReminder / useToast / useTrayQuickAdd
  utils/        taskHelpers（含侧栏计数）、calendarHelpers
  styles/       globals.css 汇总 import 11 个模块化 CSS
src-tauri/src/
  commands/     app / database / task / list / settings —— 只做 State 取出 + 错误 to_string
  db/           Database（每次操作新开 Connection）+ 三个 Repository + migrations
  models.rs     所有结构体 serde(rename_all = "camelCase")
  notifier.rs   独立线程轮询提醒
  tray.rs       托盘 + 拦截关闭
  error.rs      RepositoryError → command 层映射为 String
```

### 状态流

`taskStore` 是唯一数据源。关键点：`loadTasks()` 每次并发发**两个**查询——一份无过滤的 `allTasks`（供侧栏计数 `buildCounts()` 和详情面板按 id 查找）、一份当前 scope/搜索/排序下的 `tasks`（供列表渲染）。所有 mutation（增删改、批量）都走 `runMutation()` 再 `loadTasks()` 全量刷新，没有乐观更新。`taskRequestSequence` 用于丢弃过期响应。

`App.tsx` 自己持有的本地 state 只有 `lists`、`settings`、各类弹窗开关；任务相关一律经 store。

### 视图与枚举

系统视图 `all | today | planned | important | completed`，布局 `list | board | calendar`，排序 `priority | date | created`，优先级 `2=高 | 1=中 | 0=低`。`TaskScope` 是判别联合：`{kind:"view",view}` 或 `{kind:"list",listId}`；跨 IPC 时拍平成 `scopeKind`/`scopeValue`（见 `taskService.queryTasks`）。

### 数据库

- 当前 schema version **5**。迁移在 `db/migrations.rs` 的 `MIGRATIONS` 常量数组里，启动时按 `version >` 当前值顺序执行，每条一个事务并写入 `schema_migrations`。**只追加，永不改历史迁移**——`database_test.rs` 断言了 `schema_version == 5`，加迁移要同步更新。
- 三个默认清单 `work`/`personal`/`study` 由 `Database::initialize_default_lists` 用 `INSERT OR IGNORE` 保证存在，`is_default = 1` 不可删除。
- 软删除：`tasks.deleted_at`，所有查询都带 `deleted_at IS NULL`。
- `Database` 只存路径，`connect()` 每次新建 Connection 并设 `foreign_keys=ON / WAL / synchronous=NORMAL`；没有连接池。

### 提醒机制

任务的 `remind_before`（分钟数）+ `due_at` 在写入时由 `task_repository.rs::compute_remind_at` 算出 `remind_at`（默认 1440 分钟 = 提前一天；计算结果已过期则存 `None`）。这里用的是**手写的 RFC 3339 加减实现**（`offset_rfc3339` 等一组函数），项目没有引入 chrono/time crate。

`notifier.rs` 起独立线程每 60 秒扫一次 `remind_at <= now AND reminded_at IS NULL`，emit `task-reminder` 事件并批量打上 `reminded_at`；前端 `useTaskReminder` 监听后走 Web Notification API。更新任务时若 `due_at` 变了会清空 `reminded_at` 以便重新提醒。

## 关键约定

- **严格 TypeScript**：`noUnusedLocals` + `noUnusedParameters`，多余的 import 或变量直接让 `pnpm build` 失败。
- **样式不用 Tailwind utility**：虽然装了 Tailwind 4 并在 `globals.css` 里 `@import "tailwindcss"`，JSX 里全是语义化 class（`.task-row`、`.window-titlebar`…），实际样式写在 `src/styles/*.css`，配色通过 `tokens.css` 的 CSS 变量做深浅色切换。改 UI 请沿用这套，不要往 JSX 塞 utility class。
- **无边框透明窗口**：`tauri.conf.json` 里 `decorations: false` + `transparent: true`，标题栏是 `WindowTitleBar` 组件自绘（`data-tauri-drag-region` 负责拖动）。
- **关闭 = 隐藏到托盘**：`tray.rs` 拦截 `CloseRequested` 调 `prevent_close()` 后 `hide()`。真正退出只能走托盘右键菜单。
- **Mica**：`lib.rs` setup 和 `set_window_material_theme` command 里 `window_vibrancy::apply_mica`，失败静默降级到 CSS 毛玻璃。
- **中文优先**：默认 zh-CN，日期用 `Intl.DateTimeFormat("zh-CN")`；清单查重在 mock 侧用 `localeCompare(name, "zh-CN", {sensitivity:"accent"})`，DB 侧靠 `COLLATE NOCASE UNIQUE`。
- **camelCase 边界**：Rust 内部 snake_case，靠 `#[serde(rename_all = "camelCase")]` 在 IPC 处转换，前端 `types/database.ts` 与之一一对应，改字段两边都要动。
- **弹窗进出场动画**：统一用 `usePresence(open, 280)`，返回 `rendered`（是否挂载）+ `phase`（enter/exit），组件根据 phase 加 class。新增弹窗照这个模式来。
- **版本号三处同步**：`package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 当前都是 `2.2.0`。
- `docs/`、`output/`、`.workbuddy/`、`.agents/`、`*.sqlite` 均已 gitignore，不要提交。

## 快捷键（`useKeyboardShortcuts`）

`Ctrl+N` 新建弹窗（输入框内也生效）、`B` 批量模式、`?` 快捷键面板、`Esc` 关闭一切。除 `Ctrl+N` 外都会先用 `isTypingTarget()` 排除输入态。

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

改 Rust 仓储/迁移 → 跑 `database_test.rs`。改前端 → `pnpm build`（tsc 严格模式是主要防线）+ `pnpm lint`。UI 交互改动优先用 `pnpm dev` 在浏览器 mock 里验，比起完整 `pnpm tauri dev` 快得多；只有涉及托盘、窗口、Mica、提醒事件时才需要真实 Tauri 运行。
