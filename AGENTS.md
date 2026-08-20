# AGENTS.md — Torder（今序）

## Identity

Windows 桌面待办工作台，本地 SQLite 存储。前端 React 19 + Vite 7 + Tailwind 4 + Zustand，后端 Rust + Tauri 2。

**入口**: `src/main.tsx` → `src/app/App.tsx`  
**Rust 入口**: `src-tauri/src/main.rs` → `src-tauri/src/lib.rs`

## Dev commands

```powershell
pnpm install          # pnpm 11.1.3, onlyBuiltDependencies: esbuild
pnpm dev              # Vite dev server only (port 1420) — browser mock mode
pnpm tauri dev        # Full Tauri desktop app
pnpm build            # tsc typecheck + Vite build
pnpm lint             # ESLint flat config
pnpm format           # Prettier --write
pnpm format:check     # Prettier --check
```

No frontend test framework exists. **Run `cargo +stable-x86_64-pc-windows-msvc test` inside `src-tauri/`** for Rust DB integration tests (`tests/database_test.rs`). MinGW (`cargo test`) fails on `cdylib` export overflow — use MSVC toolchain for tests.

`recurrence.rs` has its own `#[cfg(test)]` unit tests runnable the same way (no extra file needed).

## Browser mock mode vs Tauri mode

Every service in `src/services/` calls `isTauri()` from `@tauri-apps/api/core`. When false (plain `pnpm dev`), all data lives in memory mocks. No SQLite needed for frontend-only work. Sample data in `browserTaskMock.ts` seeds 12 tasks and 3 default lists.

**Critical dual-implementation trap**: mock branch (`browserTaskQuery.ts`) and Rust repository (`task_repository.rs`) are two independent implementations of the same query semantics (view filtering, sorting, search). If you change `push_view_scope` or `sort_clause` in the Rust layer, you **must** mirror the change in `browserTaskQuery.ts` or the two modes will silently diverge.

**To add/modify a Tauri command**: add the Rust handler in `src-tauri/src/commands/`, register it in `lib.rs` `invoke_handler!`, add the frontend wrapper in `src/services/`.

## Architecture

```
src/                         src-tauri/src/
  app/    App.tsx, theme       commands/     tauri command handlers
  components/                 db/           SQLite via rusqlite
    layout/                     migrations.rs auto-applied on startup
    task/  3 views              task_repository.rs
    detail/                     list_repository.rs
    dialog/                     recurring_repository.rs
    common/                     settings_repository.rs
  services/  isTauri() branch  models.rs     serde camelCase
  stores/    Zustand taskStore  recurrence.rs next_occurrence logic
  types/     database.ts etc.  recurring_scheduler.rs background thread
  hooks/                       notifier.rs   reminder background thread
  styles/    CSS modules        tray.rs       system tray, hide-to-tray
  constants/ taskConfig etc.    error.rs      RepositoryError
```

System views: `all | today | planned | important | completed`  
Layouts: `list | board | calendar`  
Sort: `priority | date | created`  
Priority: `2=high | 1=medium | 0=low`  
`TaskScope`: discriminated union `{kind:"view",view}` or `{kind:"list",listId}`; flattened to `scopeKind`/`scopeValue` over IPC.

## Key conventions

- **Strict TypeScript**: `noUnusedLocals`, `noUnusedParameters` — unused imports/vars fail build.
- **Styles**: Tailwind 4 is installed but JSX uses semantic class names (`.task-row`, `.window-titlebar`, …). All styles live in `src/styles/*.css`; colours via CSS variables in `tokens.css`. Do not add utility classes to JSX.
- **Window no-decorations + transparent**: `tauri.conf.json`. Custom title bar in `WindowTitleBar` component (`data-tauri-drag-region` handles drag).
- **Close → hide to tray**: `tray.rs` intercepts `CloseRequested`, calls `prevent_close()` then `hide()`. Real exit only via tray right-click menu.
- **Database**: `%APPDATA%\com.zhaxideler.torder\torder.sqlite`. Auto-migrated on startup. Schema version **8** (`CURRENT_SCHEMA_VERSION` constant in `migrations.rs`, derived from last entry in `MIGRATIONS` array). Only append migrations — never edit history. `database_test.rs` asserts the version number; update it when adding a migration.
- **Reminders**: `remind_before` (minutes) + `due_at` → `remind_at` computed by `task_repository.rs::compute_remind_at`. `notifier.rs` polls every 60s, emits `task-reminder` Tauri event; frontend `useTaskReminder` listens and shows Web Notification API. Updating `due_at` clears `reminded_at` so the reminder fires again.
- **Recurring tasks**: Rules live in `recurring_rules` table. `recurrence.rs::next_occurrence` uses `chrono` + `chrono-tz` (not hand-rolled date math). `recurring_scheduler.rs` runs a background thread (60s interval) that calls `generate_due()` and emits `recurring-tasks-generated`. Deleting a rule has a `delete_future_tasks` flag that soft-deletes generated tasks.
- **Backup/Export**: `commands/backup.rs` — backup copies the sqlite file into `%APPDATA%\…\backups\`; restore validates the DB before overwriting. Export supports JSON / Markdown / CSV formats via `export_tasks` command.
- **Mica**: `window_vibrancy::apply_mica` in `lib.rs`, silent fallback if unavailable.
- **Locale**: zh-CN defaults. List name uniqueness: mock uses `localeCompare("zh-CN", {sensitivity:"accent"})`; DB uses `COLLATE NOCASE UNIQUE`.
- **serde rename_all = "camelCase"**: Rust structs use snake_case, auto-converted at IPC boundary. Frontend `types/database.ts` must match exactly — change a field on either side and update both.
- **Soft delete**: `tasks.deleted_at` (and `recurring_rules.deleted_at`) set on deletion; `deleted_at IS NULL` in all queries.
- **Rust error handling**: `RepositoryError` enum → `.to_string()` in every tauri command.
- **Dialog animation**: `usePresence(open, 280)` — returns `rendered` (mount guard) + `phase` (enter/exit). New dialogs must use this pattern.
- **Version sync**: `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` must all carry the same version string.
- **State flow**: `taskStore` is the sole data source. Every mutation calls `runMutation()` then `loadTasks()` (full reload — no optimistic updates). `loadTasks()` fires two parallel queries: unfiltered `allTasks` (for sidebar counts + detail lookup) and scoped `tasks` (for list rendering). `taskRequestSequence` discards stale responses.

## Build & package (16GB dev machine constraints)

See `RULE.md` for authoritative build rules. TL;DR:

```powershell
$env:CARGO_BUILD_JOBS = "4"
pnpm tauri build     # NSIS .exe, lto=false, codegen-units=16, opt-level=s
```

- NSIS single .exe (not MSI). Need `makensis.exe` in PATH.
- Result lands in `src-tauri/target/release/bundle/nsis/`.
- `CARGO_BUILD_JOBS=4` avoids OOM; never use `-- -j 4` (argument separator bug in this pnpm version).
- `nsis-hooks.nsh` copies `WebView2Loader.dll` — do not delete it.
- Never restore `codegen-units=1` or enable LTO on this machine (OOM).
