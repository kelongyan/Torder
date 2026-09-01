# CODEBUDDY.md

This file provides guidance to CodeBuddy Code when working with code in this repository.

## Project Overview

Torder (今序) is a local-first desktop to-do workbench built with Tauri 2 + React 19 + TypeScript + Zustand + Tailwind 4 (frontend) and Rust + SQLite/rusqlite (backend). Features WebDAV sync, recurring tasks, backups, system tray, and a desktop sticky-note widget. Versions are kept in sync between `package.json` and `src-tauri/tauri.conf.json` (currently 2.6.x).

## Commands

```bash
pnpm install          # install deps (use pnpm; pnpm-workspace.yaml is single-package)

pnpm dev              # frontend only (Vite dev server, fixed port 1420)
pnpm tauri dev        # full desktop app (recommended for development)
pnpm lint             # eslint
pnpm build            # tsc typecheck + vite build (frontend)
pnpm check:design     # design-token compliance gate (see scripts/check-design-tokens.mjs)
pnpm format           # prettier write
```

Rust backend tests (from `src-tauri/`):

```bash
cd src-tauri
cargo +stable-x86_64-pc-windows-msvc test   # runs integration test in tests/database_test.rs
```

Single test: `cargo test <test_name>` in `src-tauri/`.

Packaging:

```bash
pnpm tauri build                  # Windows NSIS installer (README suggests $env:CARGO_BUILD_JOBS = "4")
pnpm tauri android build --apk    # Android APK
# or use scripts/build-windows.ps1 for one-shot Windows build with pinned CARGO_HOME
```

## Architecture

### Frontend → Backend communication

- **`src/services/`** — thin IPC wrappers around `invoke()` from `@tauri-apps/api/core`. One service per domain (`taskService`, `syncService`, `recurringService`, `attachmentService`, `listService`, `settingsService`, `backupService`, `calendarEventService`, `taskLinkService`, `widgetService`, `appService`). Command names must match the Rust handlers registered in `src-tauri/src/lib.rs` (`invoke_handler`, ~70 commands).
- **Dual browser/tauri mode**: when not running in Tauri (`!isTauri()`), services fall back to mocks (`browserTaskMock.ts`, `browserAttachmentMock.ts`, `browserTaskLinkMock.ts`) so the UI can run in a plain browser. `utils/taskPrediction.ts` provides optimistic-update predictions used in mock mode.
- **`src/stores/taskStore.ts`** — the single Zustand store (with `persist` middleware): view state (scope, layout, search, sort), allTasks/tasks/trashTasks, selection/batch state. Actions call services directly. `services/taskQuery.ts` does pure client-side filtering/sorting.
- **`src/hooks/`** — lifecycle wiring (`useAppInit`, `useAppDataLoaders`, `useDialogManager`, `useKeyboardShortcuts`, `useTaskReminder`, `useSyncLifecycle`, `useTrayQuickAdd`, etc.), composed in `src/app/App.tsx`.

### Entry points

- `src/main.tsx` — bootstraps; checks `location.hash === "#widget"` to render `WidgetApp` (separate Tauri window) vs `App`. Applies cached theme from localStorage before first paint to avoid flash.
- The main window is frameless (`decorations: false`); custom title bar lives in `components/layout/WindowTitleBar.tsx`.

### Rust backend (`src-tauri/src/`)

- **`lib.rs`** — module wiring, startup routines (auto-backup, trash cleanup, global quick-add shortcut Ctrl+Shift+T, Android TLS init via rustls/JNI), plugin registration, and the `invoke_handler` command registry. New Tauri commands must be registered here.
- **`commands/`** — one module per domain (`task`, `list`, `recurring`, `settings`, `sync`, `backup`, `attachment`, `task_link`, `calendar_event`, `app`, `database`, `widget`). Commands are thin; logic lives in db/sync layers.
- **`db/`** — `database.rs` (SQLite state wrapper), `migrations.rs` (sequential `MIGRATIONS` slice + `schema_migrations` table; bump `CURRENT_SCHEMA_VERSION` when adding a migration), and one repository per entity (`task_repository`, `list_repository`, `recurring_repository`, `settings_repository`, `attachment_repository`, `task_link_repository`, `calendar_event_repository`, `sync_repository`).
- **`sync/`** — WebDAV sync engine: `webdav.rs` (client with ETag/If-Match conditional requests), `manifest.rs` (Manifest/Snapshot/ChangeBatch), `crypto.rs` (chacha20poly1305 + argon2), `credentials.rs` (system keyring), `engine/` (`run.rs` orchestrates; `InitialSyncMode`: Merge/Upload/Download). `SyncRuntime` gate prevents concurrent syncs.
- **`runtime/`** — background pollers: `scheduler.rs` (materializes due recurring-task instances; mobile relies on startup catch-up), `notifier.rs` (reminder events).
- **`recurrence.rs`** — pure schedule math (`next_occurrence`: daily/weekly/monthly/quarterly with `chrono`/`chrono-tz`); frontend helpers in `src/utils/recurringHelpers.ts`.
- **`error.rs`** — `RepositoryError`/`RepositoryResult` used across the data layer.
- **`tests/database_test.rs`** — integration test: temp SQLite DB, runs all migrations, exercises every repository.

### Styling conventions

- Design tokens as CSS variables in `src/styles/tokens.css`; dark is the default theme (`data-theme` + `.dark` class). Per-feature CSS files (board, calendar, dialog, settings…).
- Despite Tailwind 4 being configured via the Vite plugin, components use custom CSS rather than Tailwind utility classes.
- `pnpm check:design` enforces design-token discipline (counts deduped font sizes, control heights 24–44px, odd spacing in `src/styles/*.css`; fails over baseline thresholds; `widget.css` excluded; `--report` re-baselines). Run this after style changes.

### Config highlights

- `tauri.conf.json` — id `com.zhaxideler.torder`, frameless transparent 1440×900 window, NSIS bundle with custom `nsis-hooks.nsh`. Separate `tauri.android.conf.json` for Android. Capabilities per window in `src-tauri/capabilities/` (`default.json`, `widget.json`, `mobile.json`).
- `vite.config.ts` — port 1420 is fixed/strict (Tauri requirement); `src-tauri/**` is excluded from Vite watch; `emptyOutDir: false` (dist is cleaned by build scripts).

## Reference material in-repo

- `设计稿/DESIGN.md` — **唯一基准文档**（v3.1）：§1–§12 设计规格（设计 token + 复现手册）+ §13 迁移总纲（决策记录 D1–D8、七条总规则、R0–R7 区域状态、迁移项总表、占位台账 T-01~T-12、SOP 与验收规则）。UI 重构的一切规则、差异表、占位登记都在该文件维护。硬锁定：过渡动画与字体样式保持现状、不依照设计稿（D7/D8）。
- `设计稿/ROADMAP.md` — 渲染图制作史，已封存（2026-08-31 全部 30 项落地）。
- `docx/code-audit-2026-08-28.md` — code audit at v2.6.3 with fix-progress tracking (P0–P3 findings)。
