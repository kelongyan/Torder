# Torder 项目代码审计报告

审计日期：2026-08-22

审计目标：全面扫描当前项目代码，定位潜在 bug、冗余逻辑、冗余文件、死代码、死变量、重复实现与可优化代码段，并按优先级排序，作为后续项目优化依据。

## 结论概览

- P0：未发现会立刻阻断启动、构建或核心数据写入的致命问题。
- P1：发现 5 类需要优先处理的问题，主要集中在备份恢复、提醒投递、同步增量、回收站布局与日历删除行为。
- P2：发现 13 类中等风险问题，包含清单软删除语义、提醒状态同步、mock 与 Tauri 双实现分叉、重复提交、弹窗层级等。
- P3：发现 13 类清理与维护债，包含死代码、未使用导出、冗余包装、生成物目录、文档版本漂移等。

建议优先修复顺序：

1. 先处理 P1 的真实数据风险：备份恢复、提醒丢失、sync 缺 base 对象造脏数据。
2. 再处理 P1/P2 的用户可见交互问题：回收站非列表布局、日历删除无效、重复提交。
3. 然后集中修浏览器 mock 与 Tauri 后端语义分叉，避免前端验收结果误导。
4. 最后清理 P3 的死代码、未使用资源、文档漂移和本地生成物规则。

## 审计与验证基线

已执行：

- `pnpm.cmd lint`：通过。
- `pnpm.cmd build`：通过。
- `cargo +stable-x86_64-pc-windows-msvc test`：通过，72 个 lib 测试、11 个数据库集成测试均通过。
- `cargo +stable-x86_64-pc-windows-msvc clippy --all-targets -- -D warnings`：通过。
- `rg` 静态扫描：覆盖 `src/`、`src-tauri/src/`、`src-tauri/tests/`、配置文件、样式与资源引用。

注意：PowerShell profile 当前会输出内置模块加载噪声，但不影响上述命令的实际退出码判断。

## P0

未发现 P0。

## P1 - 优先修复

### P1-1 备份恢复会在线覆盖 SQLite，且允许旧 schema 恢复后不迁移

证据：

- `src-tauri/src/commands/backup.rs:234-247`：恢复校验只拒绝高于当前版本的备份，旧 schema 可通过。
- `src-tauri/src/commands/backup.rs:191-194`：恢复时直接 `fs::copy` 覆盖数据库并删除 WAL/SHM 后返回。
- `src-tauri/src/db/mod.rs:23-31`：迁移只在 `Database::initialize()` 中执行。
- `src/components/dialog/SettingsDialog.tsx:719-722`：前端恢复成功后只是 `window.location.reload()`，没有完整重启进程。
- `src-tauri/src/lib.rs:67-72`、`src-tauri/src/recurring_scheduler.rs:19-27`、`src-tauri/src/notifier.rs:17-30`：后台 scheduler/notifier 会在当前进程中继续访问数据库。
- `src-tauri/src/db/mod.rs:36-43`：SQLite 开启 WAL。

影响：

- 恢复 v8/v9 备份到当前 v10 后，当前进程后续命令可能访问不存在的列或表，例如 `lists.deleted_at`、`sync_state`。
- 在线覆盖 WAL 数据库存在与后台线程写入竞争的风险，可能造成恢复状态不一致。

建议：

- 恢复后要求完整退出并重启 Tauri 进程，而不是只 reload WebView。
- 或实现全局 DB 操作锁，暂停 notifier/scheduler/sync，原子替换后立即执行 `apply_migrations()` 与默认数据初始化。
- 备份复制建议使用 SQLite backup/VACUUM INTO 或 checkpoint 后复制，避免 WAL 帧丢失。

### P1-2 启动提醒可能被标记为已提醒但事件丢失

证据：

- `src-tauri/src/notifier.rs:17-21`：应用启动后立即补扫提醒。
- `src-tauri/src/notifier.rs:80-96`：先更新 `reminded_at` 并提交。
- `src-tauri/src/notifier.rs:98-104`：随后 `let _ = app_handle.emit(...)`，忽略事件发送结果。
- `src/hooks/useTaskReminder.ts:54-61`、`src/app/App.tsx:360`：前端监听器在 React effect 中注册，可能晚于 Rust 启动补扫。
- `src-tauri/src/notifier.rs:38-41`：注释本身也说明如果先打 `reminded_at` 但事件未发出，会永久丢提醒。

影响：

- 应用启动时已经到期的提醒，可能在前端监听器挂载前被 claim。
- 之后因为查询条件包含 `reminded_at IS NULL`，同一提醒不会再次投递。

建议：

- 优先考虑 Rust 侧直接发系统通知，减少前端监听时序依赖。
- 或增加 pending/ack 机制，只有前端确认收到后再写 `reminded_at`。
- 也可以让前端发 `notification-ready` 事件后，Rust 再执行首次补扫。

### P1-3 Sync 远端增量 payload 缺 base 对象时会插入默认假数据

证据：

- 局部变更记录来源：
  - `src-tauri/src/db/list_repository.rs:77-87`、`src-tauri/src/db/list_repository.rs:107-112`
  - `src-tauri/src/db/calendar_event_repository.rs:124-136`、`src-tauri/src/db/calendar_event_repository.rs:158-164`
  - `src-tauri/src/db/recurring_repository.rs:289-295`、`src-tauri/src/db/recurring_repository.rs:590-594`
- `src-tauri/src/sync/engine.rs:2309-2319`：远端应用时 `merged_payload()` 可从 `{}` 开始合并局部 payload。
- `src-tauri/src/sync/engine.rs:2337`、`src-tauri/src/sync/engine.rs:2356`、`src-tauri/src/sync/engine.rs:2378-2383`、`src-tauri/src/sync/engine.rs:2403-2405`：缺字段时使用“同步清单/同步循环任务/同步任务/同步事件”等默认值插入。
- `src-tauri/src/sync/engine.rs:2990-3008`：现有测试覆盖的是“已有完整对象后再局部更新”，没有覆盖缺 base 对象场景。

影响：

- 新设备或历史被裁剪的设备收到局部 upsert/delete 时，可能生成默认标题、默认日期、默认 listId 的脏数据。
- 循环规则尤其危险，可能被错误启用并继续生成任务。

建议：

- 局部 payload 只允许作用于已存在对象；缺对象时阻塞并要求 snapshot/base operation。
- 或所有本地变更记录都上传完整 current payload，删除也写完整 tombstone。
- 补回归测试：缺 base object 的局部 upsert/delete 不应创建默认对象。

### P1-4 回收站只在 list 布局有正确恢复语义

证据：

- `src/app/App.tsx:753-802`：任务内容按 layout 分流。
- `src/components/task/TaskListView.tsx:52`、`src/components/task/TaskListView.tsx:125-145`：只有列表视图识别 deleted view 并提供恢复入口。
- `src/components/task/TaskCard.tsx:44-51`：看板卡片仍提供普通完成/点击逻辑。
- 月/周/日历布局也没有 deleted 模式的专用交互。

影响：

- 用户在 board/month/week/calendar 打开回收站时，软删除任务会像正常任务一样显示。
- 缺少恢复入口，点击后还可能进入无法正常更新的 deleted task 详情。

建议：

- 最简单方案：当 scope 为 `deleted` 时强制使用 list renderer。
- 或给所有布局补齐 deleted 模式，隐藏完成/普通编辑，统一提供恢复和永久删除入口。

### P1-5 日历布局删除按钮可见但无效

证据：

- `src/components/task/TaskCalendar.tsx:52-55`：给 `TaskRow` 传入 `onDelete={() => undefined}`。
- `src/components/task/TaskRow.tsx:133-138`：删除按钮实际调用 `onDelete(task)`。
- `src/app/App.tsx:802-808`：渲染 `TaskCalendar` 时没有传递真实删除回调。

影响：

- calendar layout 中删除图标可点击但没有任何行为，用户会以为删除失败。

建议：

- 给 `TaskCalendar` 增加 `onDelete` prop，并在 `App.tsx` 传入 `requestDeleteTask`。
- 如果暂不支持日历删除，则隐藏删除按钮，避免假入口。

## P2 - 中等风险

### P2-1 清单软删除语义不完整：任务/规则悬挂，且同名清单不能重建

证据：

- `src-tauri/src/db/migrations.rs:16-18`：`lists.name` 仍是全表唯一。
- `src-tauri/src/db/list_repository.rs:104`：删除清单只是写 `deleted_at`。
- `src-tauri/src/db/list_repository.rs:23-24`：列表查询隐藏软删除清单。
- `src-tauri/src/db/list_repository.rs:40`：创建清单仍直接 INSERT，不能复用已软删除的同名清单名。
- `src-tauri/src/db/migrations.rs:41`、`src-tauri/src/db/migrations.rs:235`：任务/循环规则仍以外键指向 list。
- `src/app/App.tsx:425-426`：UI 文案承诺删除清单后任务保留在全集。
- `src/components/detail/TaskDetailPanel.tsx:312-318`：详情选择器只来自 active lists。

影响：

- 删除清单后，任务仍在全集但所属清单不可见/不可选。
- 循环规则可能继续生成到隐藏清单。
- 用户无法创建同名新清单。

建议：

- 明确产品语义：删除前阻止有关联任务/规则，或同事务重分配到默认清单并记录 sync。
- 若保留软删除清单，唯一约束应改为 active-only，或软删除时自动改名 tombstone。

### P2-2 `reminded_at` 变更没有进入 sync log

证据：

- `src-tauri/src/notifier.rs:83-87`：notifier 直接更新任务 `reminded_at`。
- `src-tauri/src/notifier.rs` 中搜索 `record_change|sync_repository` 无命中。
- `src-tauri/src/sync/engine.rs:2299`：sync payload 明确包含 `remindedAt`。
- `src-tauri/src/sync/engine.rs:2780-2821`：已有远端 `remindedAt` 保留测试。

影响：

- 设备 A 已提醒的任务，设备 B 不会收到该 `remindedAt` 状态，可能重复提醒。

建议：

- 如果 `remindedAt` 是全局同步状态，claim 提醒时在同一事务里记录 task upsert sync change。
- 如果提醒状态应是设备本地状态，则从 sync payload 和相关测试语义中移除，避免误导。

### P2-3 修改提醒提前量不会清空旧 `reminded_at`

证据：

- `src-tauri/src/db/task_repository.rs:195`：更新任务会重新计算 `remind_at`。
- `src-tauri/src/db/task_repository.rs:214-219`：只在 `due_at` 非空且字符串变化时清空 `reminded_at`。
- `src-tauri/src/notifier.rs:56-60`：提醒查询只扫 `reminded_at IS NULL`。

影响：

- 任务已经提醒后，只调整 `remindBefore` 到未来时间不会再次提醒。
- `due_at` 与 NULL 互转时也可能因为 SQL NULL 比较不触发清空。

建议：

- 按最终 `remind_at` 是否变化来重置 `reminded_at`。
- 或用 SQLite `IS NOT`/显式 old-new 对比覆盖 `due_at`、`remind_before`、computed `remind_at`。

### P2-4 浏览器 mock 的循环任务语义与 Tauri 后端分叉

证据：

- `src-tauri/src/db/recurring_repository.rs:171-184`：后端只在排期变更时重置 `next_due_at`。
- `src-tauri/tests/database_test.rs:474-595`：后端有“编辑保留进度、删除实例可再生成”的回归测试。
- `src/services/recurringService.ts:72-80`：浏览器更新循环规则时永远 `nextDueAt: input.firstDueAt`。
- `src-tauri/src/db/migrations.rs:295-299`：后端唯一索引只约束未删除 occurrence。
- `src/services/recurringService.ts:174-176`：浏览器生成时把已删除任务也算作已存在。

影响：

- 浏览器模式会误判“只改标题导致进度倒回”。
- 浏览器模式会误判“软删除 occurrence 后不能重生”。
- 前端验收结果不可信。

建议：

- mock 按后端 `schedule_changed` 逻辑实现。
- existence check 增加 `!task.deletedAt`。

### P2-5 浏览器 mock 的“过期”判断会把未来年份任务误判为过期

证据：

- `src/services/browserTaskQuery.ts:147-156`：`due.getMonth() < now.getMonth()` 未限制同一年。
- `src/utils/taskHelpers.ts:93-103`：计数逻辑也有同类日期比较。
- `src-tauri/src/db/task_repository.rs:384-389`：Rust 侧使用完整本地日期比较。

影响：

- 例如当前 2026-08，`2027-01` 可能在浏览器预览中被计入过期视图/角标，桌面端不会。

建议：

- 统一使用本地 `YYYY-MM-DD` 字符串或本地零点时间戳做完整日期比较。

### P2-6 浏览器 mock 搜索/排序与 Rust 查询语义不一致

证据：

- `src/services/browserTaskQuery.ts:53-56`：任意 due filter 都先要求 `status === "todo"`。
- `src-tauri/src/db/task_repository.rs:162-171`：Rust 只对 today/overdue 加 todo，`DueFilter::None` 仅要求 `t.due_at IS NULL`。
- `src-tauri/src/db/task_repository.rs:103-111`：Rust 非回收站查询全局排除 `archived`。
- `src/services/browserTaskQuery.ts:26-31`、`src/services/browserTaskQuery.ts:120-138`：mock 只排除 deleted，`all`/list 可放行 archived。
- `src/services/browserTaskQuery.ts:82-88`：mock 用 `Number.parseInt`，`p:2abc` 会解析成 2。
- `src-tauri/src/db/task_repository.rs:471-479`、`src-tauri/src/db/task_repository.rs:537-542`：Rust `parse::<i64>()` 会拒绝非法指令并回落全文。
- `src/services/browserTaskQuery.ts:165-167`：mock date 排序缺少最终 `createdAt` tie-breaker。
- `src-tauri/src/db/task_repository.rs:430-434`：Rust date 排序最终按 `t.created_at DESC`。

影响：

- 浏览器预览与桌面端的搜索结果、回收/归档可见性、排序稳定性会不一致。

建议：

- `due:none` 不应强制 todo。
- 非 deleted scope 排除 `archived`。
- `p:` 指令改为 `/^[0-2]$/` 精确匹配。
- date sort 补 `right.createdAt.localeCompare(left.createdAt)`。

### P2-7 浏览器 mock 不计算/刷新 `remindAt`

证据：

- `src/services/taskService.ts:30-35`：创建任务时固定 `remindAt: null`。
- `src/services/taskService.ts:85-95`：更新任务时只 spread input。
- `src-tauri/src/db/task_repository.rs:27`、`src-tauri/src/db/task_repository.rs:195`、`src-tauri/src/db/task_repository.rs:217-219`：Rust create/update 会计算 `remind_at`，并在 due 变化时清理提醒状态。

影响：

- 浏览器预览里的提醒字段与桌面端数据语义不同。

建议：

- mock 实现同等 `computeRemindAt(dueAt, remindBefore)`。
- due/remindBefore 变化时同步处理 `remindedAt`。

### P2-8 month/week 布局无视“显示已完成”

证据：

- `src/components/common/ViewMenu.tsx:81-86`：全局菜单暴露“显示已完成”开关。
- `src/components/task/MonthCalendar.tsx:50-55`、`src/components/task/WeekCalendar.tsx:40-45`：月/周视图内部硬过滤 done。

影响：

- 切换 showCompleted 后查询与角标变化，但月/周日历仍不显示已完成任务。

建议：

- 传入并尊重 `showCompleted`。
- 或在这些布局隐藏该开关，避免 UI 暗示错误。

### P2-9 启动更新检查的取消标记无效

证据：

- `src/app/App.tsx:374-394`：`cancelled` 在 `setTimeout` 回调内部声明，并从回调返回 cleanup。
- `setTimeout` 不会消费回调返回值。

影响：

- 组件卸载后网络请求 resolve 仍可能 `pushToast`。

建议：

- 把 `cancelled` 放到 effect 作用域，cleanup 中设置为 true。
- 需要时配合 `AbortController`。

### P2-10 危险确认弹窗与创建类弹窗可重复提交

证据：

- `src/components/dialog/ConfirmDialog.tsx:34-47`：对 async `onConfirm/onSecondary` 直接 `void` 调用，按钮没有 busy/disabled。
- `src/app/App.tsx:599-609`、`src/app/App.tsx:618-629`：调用方包含删除、恢复、批量删除等危险操作。
- `src/components/dialog/TaskCreateDialog.tsx:27-39`、`src/components/dialog/TaskCreateDialog.tsx:90-102`：创建任务提交无 submitting。
- `src/components/dialog/RecurringRuleDialog.tsx:47-77`、`src/components/dialog/RecurringRuleDialog.tsx:91-100`：循环规则提交无 submitting。
- `src/app/App.tsx:822-823`：父级实际传入 async 处理。

影响：

- 双击或连续 Enter/Ctrl+Enter 可能发送重复删除、恢复、创建任务或创建规则请求。
- 可能产生重复数据、重复 toast 或后端 NotFound/冲突错误。

建议：

- Dialog 内部增加 submitting 状态。
- pending 时禁用所有操作按钮。
- `onSubmit` 类型改为可返回 Promise，并 await 后再关闭。

### P2-11 部分弹窗重复包了一层 overlay

证据：

- `src/components/dialog/DialogShell.tsx:23-28`：`DialogShell` 已生成 `.dialog-overlay`。
- `src/components/dialog/BatchEditDialog.tsx:53-55`、`src/components/dialog/StatsDialog.tsx:30-32`、`src/components/dialog/SettingsDialog.tsx:736-738`：调用方又额外包了一层 overlay。

影响：

- 双层 fixed/backdrop/z-index 可能造成动画叠色、焦点层异常、移动端尺寸异常。

建议：

- 去掉外层 overlay。
- 必要样式通过 `DialogShell` 的 className 或内部子元素承载。

### P2-12 Keychain 与 SQLite 状态更新没有可回滚边界

证据：

- `src-tauri/src/commands/sync.rs:368-418`：`save_sync_config` 在 SQLite transaction 内调用外部凭据写入。
- `src-tauri/src/sync/credentials.rs:15-25`：`credentials::store()` 先写系统凭据。
- `src-tauri/src/commands/sync.rs:436-440`：删除配置先删 Keychain 再清 SQLite。

影响：

- 中途失败可能留下孤儿凭据。
- 或数据库仍指向已删除凭据，导致下次同步认证状态异常。

建议：

- 保存失败时补偿删除刚写入的凭据。
- 删除配置可以先清 DB 后清凭据，或记录待清理 ID 并做一致性校验。

### P2-13 关键回归测试缺口

证据：

- `src-tauri/tests` 下搜索 `notifier|check_and_notify|restore_backup|verify_restorable_database` 无命中。
- 相关实现只在 `src-tauri/src/notifier.rs:35`、`src-tauri/src/commands/backup.rs:173` 等源码中出现。

影响：

- P1 的提醒投递、旧 schema 恢复、在线恢复 WAL/后台线程风险没有自动回归保护。

建议：

- 补旧 schema 备份恢复后迁移可用的集成测试。
- 补 notifier 投递/ack 与 `reminded_at` 写入顺序测试。
- 补提醒 claim 同步写入 sync change 的测试。

## P3 - 清理与维护债

### P3-1 严格 clippy 当前失败

证据：

- `cargo +stable-x86_64-pc-windows-msvc clippy --all-targets -- -D warnings` 失败。
- 主要报错：
  - `src/commands/sync.rs:252`：`save_sync_config` 参数过多。
  - `src/commands/sync.rs:545`：`run_sync` 参数过多。
  - `src/db/recurring_repository.rs:621`：`validate_input` 参数过多。
  - `src/recurrence.rs:9`：`validate_schedule` 参数过多。
  - `src/commands/backup.rs:375`、`src/db/task_repository.rs:516`、`src/sync/engine.rs:2439`：`items_after_test_module`。

影响：

- 当前常规测试通过，但如果后续 CI 加 `-D warnings`，会直接失败。

建议：

- Tauri command 参数可用输入 struct 收敛。
- 测试模块移动到文件末尾。
- 对确实合理的多参数 IPC handler 局部 `#[allow(clippy::too_many_arguments)]`，但优先减少内部函数参数。

### P3-2 未使用组件和对应样式块

证据：

- `src/components/common/FieldRow.tsx:4`：`FieldRow` 只有定义，无源码引用。
- `src/components/detail/DetailBlock.tsx:3`：`DetailBlock` 只有定义，无源码引用。
- `src/styles/controls.css:196-264`：`FieldRow` 相关 CSS 存在，但组件未使用。

影响：

- 增加维护噪音，后续修改 UI 样式时容易误以为仍有入口。

建议：

- 无近期规划则删除组件和对应 `.field-row*` CSS。

### P3-3 未使用导出和未接入服务

证据：

- `src/constants/listConfig.ts:1`：`draculaListColors` 只有定义。
- `src/services/browserTaskMock.ts:9`：`setBrowserTasks` 只有定义。
- `src/services/listService.ts:88`：`replaceBrowserLists` 只有定义。
- `src/services/settingsService.ts:66`：`replaceBrowserSettings` 只有定义。
- `src/services/taskService.ts:50`：`getTask` 服务函数只有定义。
- `src/services/syncService.ts:34`：`listPendingSyncChanges` 前端服务只有定义。
- `src/services/recurringService.ts:114`：`generateDueRecurringTasks` 前端服务只有定义。
- `src/services/appService.ts:21`：`getDatabaseStatus` 前端服务只有定义。
- `src/types/sync.ts:65`：`SyncCleanupResult` 类型定义未被使用，`cleanupSyncHistory` 手写了同形返回类型。

影响：

- 导出面膨胀，后续容易误以为已有稳定调用契约。

建议：

- 确认无外部依赖后移除。
- 如果是预留诊断入口，则补 UI 入口或注释用途。
- `cleanupSyncHistory` 可直接使用 `Promise<SyncCleanupResult>`。

### P3-4 `backup.rs` 有冗余 `TaskListRepository` 包装

证据：

- `src-tauri/src/commands/backup.rs:123`：导出处使用 `TaskListRepository::new(database).list()`。
- `src-tauri/src/commands/backup.rs:438-450`：包装类型只代理到 `ListRepository`。
- `src-tauri/src/db/list_repository.rs:10`、`src-tauri/src/db/list_repository.rs:19`：真正 repository 已存在。

影响：

- 无行为 bug，但增加无意义间接层。

建议：

- 直接使用 `crate::db::list_repository::ListRepository`。

### P3-5 `DatabaseStatus.list_count` 包含软删除清单

证据：

- `src-tauri/src/db/mod.rs:56-57`：`list_count` 使用 `SELECT COUNT(*) FROM lists`。
- `src-tauri/src/db/mod.rs:58-60`：`task_count` 过滤了 `deleted_at IS NULL`。

影响：

- 诊断状态里的清单数与 UI active lists 不一致。

建议：

- 改为 `WHERE deleted_at IS NULL`。
- 或字段改名为 total list count。

### P3-6 settings migration 留有历史噪声

证据：

- `src-tauri/src/db/migrations.rs:77-80`：v2 写入 `defaultView/defaultReminderMinutes/launchAtStartup`。
- `src-tauri/src/db/migrations.rs:159`：v3 又删除非 theme。
- `src/services/settingsService.ts:50-51`：当前前端仍读取 `defaultReminderMinutes` fallback。
- 搜索显示 `defaultView`、`launchAtStartup` 只剩 migration 命中。

影响：

- 低风险，但迁移历史和当前设置模型不一致。
- 旧库迁移会丢这些设置。

建议：

- 若还需要这些设置，追加迁移补种。
- 若不需要，清理前端类型/默认值语义。不要修改历史 migration。

### P3-7 browser preview 的应用和数据库版本信息过期

证据：

- `src/services/appService.ts:14`：浏览器预览返回版本 `0.1.0`。
- `package.json:4`、`src-tauri/Cargo.toml:3`、`src-tauri/tauri.conf.json:4`：当前版本为 `2.4.2`。
- `src/services/appService.ts:25`：浏览器预览返回 schema 7。
- `src-tauri/src/db/migrations.rs:324`、`src-tauri/src/db/migrations.rs:392`：当前迁移最高版本为 10。

影响：

- 一旦 `getDatabaseStatus` 或 app info 接入 UI，浏览器预览会展示错误信息。

建议：

- 从构建常量注入版本。
- schema mock 与当前版本同步，或明确标记为 mock 值。

### P3-8 文档中的 schema version 已漂移

证据：

- `AGENTS.md:65`：仍写 schema version **8**。
- `CLAUDE.md:93`：仍写 schema version **9**。
- `src-tauri/src/db/migrations.rs:324`、`src-tauri/src/db/migrations.rs:392`：当前最高迁移为 10。

影响：

- 后续维护迁移时容易被旧文档误导。

建议：

- 文档不要写死版本号，改成“以 `CURRENT_SCHEMA_VERSION` 为准”。
- 或每次新增 migration 时同步更新这些说明。

### P3-9 本地生成物目录与 `.gitignore` 规则不一致

证据：

- 当前 `git status --short --branch` 显示未跟踪：
  - `.playwright-mcp/`
  - `outputs/`
  - `android-test-1.png`
  - `codex-notes/`
- `.gitignore:13-15` 只忽略 `.playwright-cli` 和 `output/`，没有忽略 `.playwright-mcp/`、`outputs/`、根目录 `android-test-1.png`。
- `eslint.config.js:23-27` 已忽略 `outputs/**` 和 `.playwright-mcp/**`，说明这些更像本地生成物。

影响：

- 每次 `git status` 都会混入本地测试产物，容易误 stage。

建议：

- 确认这些产物无保留价值后清理。
- 或把 `.playwright-mcp/`、`outputs/`、根目录截图模式加入 `.gitignore`。
- `codex-notes/` 如果作为审计/计划目录保留，可明确是否纳入版本管理。

### P3-10 未使用资源文件

证据：

- `src/assets/torder-logo-antigravity.png`：源码、配置、README 中未引用。
- `src/assets/fonts/FrexSansGB-*.woff2`：文件存在约 6.7 MB，但 `src/styles/globals.css:17-43` 使用的是本地 `Source Han Sans SC`/`Noto Sans SC` 字体源，没有引用这些 woff2。

影响：

- 增加仓库体积和资源维护成本。

建议：

- 如果不用自带字体，删除这些 woff2。
- 如果需要稳定字体渲染，则在 `@font-face` 中正式接入这些字体文件。
- `torder-logo-antigravity.png` 确认无品牌用途后删除。

### P3-11 生产代码存在调试日志

证据：

- `src/components/dialog/SettingsDialog.tsx:566`：`console.info("backup saved at:", path)`。
- `src/components/dialog/SettingsDialog.tsx:586`：`console.info("export saved at:", path)`。
- `src/hooks/useTaskReminder.ts:36`：移动端通知失败时 `console.error(...)`。

影响：

- 备份/导出路径可能暴露本机目录信息。
- 控制台噪音增加。

建议：

- 成功路径只保留 toast，不输出本地路径。
- 错误日志可保留，但建议统一走受控日志/诊断导出机制，避免随意 console。

### P3-12 `output/` 中积累大量旧截图与临时脚本

证据：

- `output/` 被 `.gitignore` 忽略，但目录内存在大量旧 Playwright 截图、Android 截图、日志和临时脚本。
- 示例：`output/cdp-eval.mjs`、`output/playwright/*.png`、`output/playwright/*.log`。

影响：

- 不影响构建，但本地磁盘和人工检索噪音较大。

建议：

- 保留最近需要复核的截图，其余按日期归档或清理。
- 临时脚本如果仍有复用价值，移动到 `scripts/` 并命名清楚；否则删除。

### P3-13 CSS 中存在疑似旧样式块

证据：

- `src/styles/dialog.css:240-314`：`.pill-group`、`.choice-pill`、`.color-row` 只在样式中出现，当前 JSX 未检索到直接 class 使用。
- `src/styles/dialog.css:680`：`.list-dialog-card` 只在样式中出现。
- `src/styles/layout.css:263`：`.search-kbd` 只在样式中出现。
- 注意：`state-${syncStatus.state}`、`month-event-${event.eventType}` 是动态 class，不能按未直接字符串命中判断为死代码。

影响：

- 可能是旧 UI 遗留样式，增加样式维护成本。

建议：

- 结合实际页面截图确认是否仍有入口。
- 确认为旧样式后删除，并跑 `pnpm.cmd build` 与主要布局截图验证。

## 推荐修复路线

阶段进度：

- [x] 第一阶段：数据安全与同步正确性。已修复备份恢复迁移与安全快照、提醒通知/`reminded_at` 写入顺序及 sync 记录、提醒计划变更清理、sync 缺 base 局部 payload 造脏数据问题。验证：`cargo +stable-x86_64-pc-windows-msvc test` 通过。
- [x] 第二阶段：用户可见交互。已修复回收站强制列表渲染、日历布局删除回调、确认/创建/循环规则弹窗防重复提交、month/week 对 `showCompleted` 的响应，以及重复 overlay。验证：`pnpm.cmd lint`、`pnpm.cmd build` 通过。
- [x] 第三阶段：mock 与 Tauri 语义对齐。已对齐浏览器 mock 的归档过滤、`due:none`、`p:` 指令解析、过期日期跨年判断、date 排序 tie-breaker、提醒 `remindAt/remindedAt` 计算，以及循环规则 `schedule_changed`/软删除 occurrence 再生成语义。验证：`pnpm.cmd lint`、`pnpm.cmd build` 通过。
- [x] 第四阶段：清理维护债。已处理严格 clippy、诊断 list count 软删除口径、未使用前端组件/导出/样式、未引用备用 logo、字体资源接入、生产路径 console、`.gitignore` 本地生成物规则、schema 文档漂移，以及启动更新检查 cleanup。验证：`pnpm.cmd lint`、`pnpm.cmd build`、`cargo +stable-x86_64-pc-windows-msvc test`、`cargo +stable-x86_64-pc-windows-msvc clippy --all-targets -- -D warnings`、`git diff --check` 通过。

最终收尾验证：

- `pnpm.cmd lint`：通过。
- `pnpm.cmd build`：通过。
- `cargo +stable-x86_64-pc-windows-msvc test`：通过。
- `cargo +stable-x86_64-pc-windows-msvc clippy --all-targets -- -D warnings`：通过。
- `git diff --check`：通过。
- 敏感信息扫描：对 WebDAV 账号、应用专用密码和服务域名关键字执行全仓库扫描，除本条脱敏记录外无命中。

### 第一阶段：数据安全与同步正确性

1. 修复备份恢复的旧 schema/在线覆盖问题。
2. 修复启动提醒事件丢失与 `reminded_at` 写入顺序。
3. 修复 sync 局部 payload 缺 base 对象时插入默认数据的问题。
4. 明确 `remindedAt` 是否跨设备同步，并同步修实现与测试。

### 第二阶段：用户可见交互

1. 回收站强制 list 布局或补齐全布局 deleted 模式。
2. 修复日历布局删除按钮无效。
3. 给确认弹窗、创建任务、循环规则提交加 pending 防重。
4. 修复 month/week showCompleted 行为。

### 第三阶段：mock 与 Tauri 语义对齐

1. 统一 overdue/date/sort/search/archived/due:none 语义。
2. mock 增加 `remindAt` 计算与 `remindedAt` 清理。
3. mock 循环任务按后端 `schedule_changed` 与软删除 occurrence 逻辑实现。

### 第四阶段：清理维护债

1. 处理 clippy 警告，至少保证未来 CI 可选择开启 `-D warnings`。
2. 删除或接入未使用组件、服务、字体和图片资源。
3. 调整 `.gitignore` 与本地生成物目录。
4. 更新 schema 相关文档，避免版本漂移。

## 不建议立即做的事

- 不建议直接删除所有 `output/`、`outputs/`、`.playwright-mcp/`，这些可能包含近期 UI/Android 验证证据。应先确认是否仍需保留。
- 不建议修改历史 migration。需要调整 schema 或设置默认值时，应追加新 migration。
- 不建议只在前端隐藏问题入口来代替后端修复。备份恢复、sync、提醒属于数据一致性问题，应以后端正确性为准。
