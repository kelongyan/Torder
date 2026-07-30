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

## Browser mock mode vs Tauri mode

Every service in `src/services/` calls `isTauri()` from `@tauri-apps/api/core`. When false (plain `pnpm dev`), all data lives in memory mocks. No SQLite needed for frontend-only work. Sample data in `browserTaskMock.ts` seeds 12 tasks and 3 default lists.

**To add/modify a Tauri command**: add the Rust handler in `src-tauri/src/commands/`, register it in `lib.rs` `invoke_handler!`, add the frontend wrapper in `src/services/`.

## Architecture

```
src/                         src-tauri/
  app/    App.tsx, theme       src/
  components/                   commands/   tauri command handlers
    layout/                     db/         SQLite via rusqlite
    task/  3 views              migrations/ auto-applied on startup
    detail/                     models.rs   serde camelCase
    dialog/                     tray.rs     system tray, hide-to-tray
    common/
  services/     isTauri() branching
  stores/       Zustand taskStore
  types/        database.ts, settings.ts, ui.ts
  hooks/
  styles/       CSS files (no Tailwind classes in JSX likely)
```

System views: `all | today | planned | important | completed`  
Layouts: `list | board | calendar`  
Sort: `priority | date | created`  
Priority: `2=high | 1=medium | 0=low`

## Key conventions

- **Strict TypeScript**: `noUnusedLocals`, `noUnusedParameters` — unused imports/vars fail build.
- **Window no-decorations + transparent**: `tauri.conf.json`. Custom title bar in `WindowTitleBar` component.
- **Close → hide to tray**: `tray.rs` intercepts close, hides window instead. Right-click tray → quit to exit.
- **Database**: `%APPDATA%\com.zhaxideler.torder\torder.sqlite`. Auto-migrated on startup. Schema version 5.
- **Reminders**: Tasks can have `remindBefore` (minutes before `dueAt`). Backend notifier thread checks every 60s, emits `task-reminder` Tauri event; frontend `useTaskReminder` hook listens and shows Web Notification API.
- **Mica**: Windows Mica effect applied in `lib.rs`, silent fallback if unavailable.
- **Locale**: zh-CN defaults. List name uniqueness uses zh-CN accent-sensitive comparison.
- **serde rename_all = "camelCase"**: Rust structs use snake_case, auto-converted at boundary.
- **Soft delete**: `tasks.deleted_at` set on deletion; `deleted_at IS NULL` filter in all queries.
- **Rust error handling**: `RepositoryError` enum → mapped to `String` in tauri commands.

## Build & package (16GB dev machine constraints)

See `RULE.md` for authoritative build rules. TL;DR:

```powershell
$env:CARGO_BUILD_JOBS = "4"
pnpm tauri build     # NSIS .exe, lto=false, codegen-units=16, opt-level=s
```

- NSIS single .exe (not MSI). Need `makensis.exe` in PATH.
- Result lands in `src-tauri/target/release/bundle/nsis/`.
- `CARGO_BUILD_JOBS=4` avoids OOM; never use `-- -j 4`.
- Rust dev should use `pnpm dev` (Vite only) + hot-reloading Tauri for Rust changes.
