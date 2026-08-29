# Torder 代码审计报告

- 日期：2026-08-28
- 基线：`main` @ `c942260`（版本 2.6.3，工作区干净）
- 方法：4 个并行审计代理分区扫描——前端 React（app/components/hooks/stores/utils）、services 双模式一致性（含对应 Rust 仓库层）、Rust 后端全量（44 个 .rs 文件）、样式/资产/配置。所有"未使用/死代码"结论均经全仓 grep 验证。
- 优先级定义：**P0** 会造成数据损坏或核心功能阻塞；**P1** 潜在正确性/竞态/功能性缺陷；**P2** 冗余逻辑、语义漂移、重复实现；**P3** 死代码、死文件、死样式。
- 总计：1 × P0，26 × P1，24 × P2，19 × P3。

---

## 修复进度（动态更新）

**批次1（Rust P0+竞态+后端修复）— 大部分完成 🚧**
- ✅ #1 同步载荷补齐 `sortOrder`/`completedAt`/`remindedAt`/`repeatRule`（P0 解除）
- ✅ #2 双设备同期次生成：接收端幂等跳过，不再卡死同步
- ✅ #3 提醒认领 TOCTOU：UPDATE 追加 `remind_at` 到期守卫（NULL 兼容补发场景）
- ✅ #4 `next_due_at` 读改写竞态：乐观守卫 `next_due_at IS ?expected`
- ✅ #5 notifier 连接补 5s busy_timeout
- ✅ #6 `save_sync_config` 接入 SyncRuntime try_lock 门控
- ✅ #7 `\\?\` 扩展长度前缀剥离后再入库
- ✅ #43 删除规则未来实例：统一单 now + `current_task_payload` 全量载荷
- ✅ #44 备份/恢复三处连接补 busy_timeout
- ✅ #45 备份导入吞错：改为显式表存在性检查（`backup_has_table`），真实错误上抛
- ✅ #46 启动备份移至后台线程
- ✅ #47 提醒查询补 `purged_at IS NULL`
- ✅ #48 单条通知失败不再中断整轮认领
- ✅ #49 `merged_payload` 的 expect 改为返回错误
- ✅ #8 清单删除：仍有存活成员任务时拒绝 + 校验受影响行数
- ✅ #62–#64 删除死代码 `AttachmentBlob`/`AttachmentQueryInput`/`mark_blob_pending_download`/`engine::run`
- ✅ #65 移除 reqwest `json` feature 与重复的 dev-dependencies
- ✅ 附带：`database_test` 本地引用断言更新为剥离前缀路径；顺手修复 widget 代理引入的 `widget.rs` mut 编译错误
- ⏳ 遗留（转后续）：#1/#2 专项回归测试（同步引擎生成实例 → apply_batch 全链路）
- 验证：`cargo +stable-x86_64-pc-windows-msvc test` 第四轮全绿（21 passed / 0 failed）✅

**批次2（Widget 簇）— 已完成 ✅**
- ✅ #22 `notifyTasksChanged` 防抖窗口内并集累积日期键（空数组=任意日期的保守语义保留）
- ✅ #26 新增 `patch_widget_settings` Rust 命令：IMMEDIATE 事务内单点读-改-写，保留 `anchorDate` 等前端字段；`saveWidgetSettings` 全量移除，主窗开关/几何/锚点写入全部迁移
- ✅ #37 `changeAnchorDate` 接入 writeChain（`enqueueSettings`）
- ✅ #16 便签快速添加仅在日期键匹配当前显示日期时本地插入，否则重拉当前日期兜底
- 验证：`cargo check` 通过、`npx tsc --noEmit` 通过

**批次5（CSS 级联与样式清理）— 已完成 ✅**
- ✅ #23 tokens.css 显式定义 `--shadow-md`（深浅主题）
- ✅ #24 board.css 移除误带的 `.list-dot`，侧边栏圆点恢复 10px
- ✅ #25 详情胶囊样式收窄为 `.task-tags span` 作用域，列表/看板保持方块设计
- ✅ #50 抽 37 条共用规则到 `.form-dialog`（逐条核对差异，级联胜出关系保持一致）
- ✅ #51 `.icon-button.compact` 合并入 buttons.css
- ✅ #52 `.is-spinning` 去重（删 detail 版与 `detail-spin`）
- ✅ #53 四处 `.is-exiting` 合并为 controls.css 一条
- ✅ #54 删除 5 个死变量（深浅各份，删前复核零引用）
- ✅ #55 `.form-grid-full` 迁至 dialog.css 通用层
- ✅ #66 删除 `.settings-nav-*` 死家族（~90 行）
- ✅ #67 删除 `.month-cell-more`
- ✅ #68 删 `.quick-add kbd` 死规则；`.detail-footer` 改名 `.detail-dialog-footer`（窄屏适配恢复生效）
- ✅ #69 删除 4 个无引用 keyframes
- ✅ #70 5 个无定义类全部从 JSX 移除（逐个判断无钩子语义）
- ✅ #71 720px 对话框移动端适配块迁入 responsive.css（级联核对一致）
- ✅ #72 删除 `preview` script
- 验证：`pnpm build`（strict tsc + vite）通过；`pnpm lint` src/ 无错误；改动文件 `prettier --check` 通过
- 备注：既有问题（非本战役引入）——`SettingsAboutSection.tsx:50` 三元式在基线上即不过 prettier；`.tmp/` 审计草稿脚本 lint 报错

**收尾 — 已完成 ✅**
- ✅ #1/#2 专项回归测试：`generated_occurrence_sync_payload_contains_full_insert_fields`（载荷全量字段）与 `apply_batch_skips_duplicate_recurring_occurrence`（双设备同期次幂等跳过），位于 `sync/engine/mod.rs` 内联测试
- ✅ `.quick-add-inline` 死样式簇全部清理（task-list.css ~237 行 + responsive.css 48 处引用 + controls.css 组选择器，含 `.date-chip-*` 死规则）
- ✅ 清理扫描期遗留的 `.tmp/audit-*.mjs` 草稿（消除 23 个 lint 错误）
- ✅ 统一验证全绿：`cargo test` **91 内联 + 21 集成，0 失败**；`pnpm build` 通过；`pnpm lint` 通过
- ⚠️ 已知限制：#7 `\\?\` 前缀修复依赖 opener 插件行为，建议真机打开一次本机引用附件确认；`SettingsAboutSection.tsx:50` 的 prettier 问题为基线既有（非本战役引入）

**全部 72 项处理完毕：1 × P0 + 26 × P1 + 24 × P2 + 19 × P3（含审计定位修正与合理扩展）**

**批次3（前端核心）— 已完成 ✅**
- ✅ #13/#14 `onError`/`openTaskCreateDialog`/快捷键回调 `useCallback` 稳定化，消除全量重拉与 IPC 重订阅风暴
- ✅ #15 回收站行接通真实选中状态，批量"恢复/永久删除"可用（对接 `batchRestore`/`batchPermanentDelete`）
- ✅ #17 统计改用 `toLocalDateKey` 比较，修复 UTC+8 下 0:00–8:00 归入前一天
- ✅ #18 `runOptimistic` 失败按受影响 id 还原（`restoreFailedRows`），9 个调用点已适配
- ✅ #19 `isOverdue` 统一为日期级口径（与逾期视图/侧栏计数一致；"今天到期"当天不标红）
- ✅ #20 旧任务频率映射补 `quarterly` 分支
- ✅ #21 备份列表挂载时加载一次，恢复入口即时可见
- ✅ #38 日期格保存后退出编辑态
- ✅ #39 三个对话框提交补 `catch` + 内联错误提示，不再未处理 rejection/卡死
- ✅ #40 趋势图两组柱共用同一归一化 max
- ✅ #41 拖放监听补 `disposed` 检查，切换任务不再累积失效监听
- ✅ #42 5 处确认浮层接入 `usePresence(open, 280)` 退场动画
- 验证：`tsc --noEmit` 与 `eslint`（12 个改动文件）零错误零警告
- 说明：#42 中 `restore-confirm-card` 仅获得淡出（无卡片位移动画），为不改 CSS 前提下的最佳一致效果

**批次4（双模式对齐）— 已完成 ✅**
- ✅ #9 浏览器 `setTaskCompleted` 改用 `predictCompletedTask`（set_completed 语义，总是刷新 completedAt）
- ✅ #10 新建清单默认排末尾：UI 显式传 `sortOrder` + mock `nextListSortOrder()` + Rust `COALESCE(MAX(sort_order),-1)+1`
- ✅ #11 widget 排序两侧统一（有日期在前按日期升序、无日期在后、同级 priority/created 排序），Rust ORDER BY 与 mock `compareWidgetTasks` 同步
- ✅ #12 mock 创建循环规则先校验来源任务再入数组（原子化）
- ✅ #27 weekly 未命中抛错 + 新增 `validateBrowserRuleInput` 镜像 Rust 全部校验
- ✅ #28 规则已结束改为 reject 且不变更状态
- ✅ #29 规则列表排序对齐（enabled DESC, next_due_at ASC, created_at DESC）
- ✅ #30 日历事件 mock 镜像校验（标题/类型/日期格式/endDate≥startDate）
- ✅ #31 搜索解析对齐：`p:` 接受 +号/前导零、`tag:` 剥全部 `#`、ASCII 大小写折叠；额外对齐全文分字段匹配与 `due:` 非法指令处理
- ✅ #32 可关联任务搜索：排序与分字段匹配对齐
- ✅ #33 `parseSearchQuery` 入口 trim + 过滤空 token
- ✅ #34 同步 throw → rejected Promise（listService/taskLinkService/attachmentService/recurringService/calendarEventService）
- ✅ #35 mock deleteTask 复用 `predictDeletedTask`
- ✅ #36 Tauri 模式 listsSnapshot 初始置空（`l:` 解析空快照安全）
- ✅ #61 `toRfc3339Seconds` 复用 taskPrediction 导出
- 验证：`tsc --noEmit` 通过、`cargo check` 通过、`cargo test` 集成 21 + 内联 89 全部通过

**批次6（前端死代码）— 已完成 ✅**
- ✅ #56 删除死文件 `TaskQuickAdd.tsx`（-263 行；审计前提修正：`parseQuickAddText` 本就在 taskHelpers.ts，无需迁移）
- ✅ #57 `normalizeTags` 去重，统一复用 taskPrediction 导出
- ✅ #58 toast legacy 字段（`actionLabel`/`onAction`）移除，`actions` 改为必填
- ✅ #59 `TaskDateTimeField`/`WidgetTitleBar` 私有日期函数改为复用 `taskDates`（审计定位修正：WidgetTitleBar 实际重复的是 `parseDateKey`）
- ✅ #60 `getBrowserSettingsSnapshot` 转文件内私有
- 验证：代理触及的 9 个文件 `tsc --noEmit` 与 `eslint` 均通过（复跑时 taskStore.ts 的报错来自并行批次 #18 的中间态）
- ~~遗留：`.quick-add-inline` 死样式转交样式批次/收尾清理~~ → 已在收尾阶段清理 ✅

---

## P0 — 必须优先修复

### 1. 循环任务生成的同步载荷缺 `sortOrder` → 跨设备同步永久卡死
- 位置：`src-tauri/src/db/recurring_repository.rs:510-532`（`insert_occurrence` 的 `record_change` 载荷）；接收端 `src-tauri/src/sync/engine/apply.rs:618-659`
- 问题：载荷字段没有 `sortOrder`，而接收端 `has_full_insert_payload` 将其列为 task 必填。接收端本地没有该任务时（常态：A 设备生成、B 设备接收），`merged_payload` 抛 `"sync partial payload requires existing object"` → 整个 batch 回滚、`lastRemoteSequence` 不前进 → **之后每次同步都卡在同一 batch，只能手工改库**。引擎测试全部手写 `"sortOrder": 0` 载荷，恰好没覆盖这条真实生成路径。
- 修法：载荷补 `"sortOrder": 0`（顺带补 `completedAt`/`repeatRule`/`remindedAt` 与行语义对齐），并加一条「生成实例 → apply_batch」的回归测试。

---

## P1 — 潜在正确性 / 功能性缺陷

### 同步与并发（Rust）

| # | 位置 | 问题 | 建议 |
|---|------|------|------|
| 2 | `sync/engine/apply.rs:703-735` + `db/migrations.rs:295-299` | 两设备离线期间各自为同一 (rule, occurrence) 生成不同 task id，先收到对方 batch 的一端 `INSERT … ON CONFLICT(id)` 命中部分唯一索引 → 约束错误 → 批次永久回滚 | apply 前检测同 (rule, occurrence) 存活行，转为幂等跳过/合并 |
| 3 | `runtime/notifier.rs:41-57, 92-129` | 提醒认领的 SELECT 在事务外；用户此刻 snooze/改期后，认领 UPDATE 守卫只有 `reminded_at IS NULL`，仍会写上 `reminded_at` → 改期后的提醒**永不触发** | 筛选移入同一 IMMEDIATE 事务，或 UPDATE 追加 `remind_at` 期望值守卫 |
| 4 | `db/recurring_repository.rs:407-454, 537-560` | poller 对 `next_due_at` 读改写竞态：与 `update_recurring_rule`/`skip_next` 并发时陈旧计算覆盖用户刚写入的值（改期进度被倒退） | 读取移入写事务，或 `WHERE next_due_at IS ?expected` 乐观守卫 |
| 5 | `runtime/notifier.rs:131-141` | 自建连接无 `busy_timeout`（`db/database.rs:31` 有 5s），遇写事务即 SQLITE_BUSY，整轮提醒推迟 60s | 同样设置 5s busy_timeout |
| 6 | `sync/service.rs:105-273` | `save_sync_config` 是唯一不取 `SyncRuntime` 锁的同步入口，凭据/加密配置可能在同步中途被换 | 同样 `try_lock` |
| 7 | `db/attachment_repository.rs:48,126,151` + `commands/attachment.rs:68-101` | localReference 附件入库的是 `fs::canonicalize` 的 `\\?\C:\…` 扩展路径，opener/Shell 大概率不接受 → 打开/定位失败（待实测确认） | 存去前缀路径（dunce），canonicalize 仅用于创建校验 |
| 8 | `db/list_repository.rs:93-116` | 软删列表不处理成员任务（FK RESTRICT 只拦硬删除），孤儿任务会同步到所有设备；`execute` 行数未校验，并发删除记幻影变更 | 有成员任务时拒绝或先迁移；校验受影响行数 |

### 双模式语义漂移（services ↔ Rust）

| # | 位置 | 问题 | 建议 |
|---|------|------|------|
| 9 | `src/services/taskService.ts:135-153` ↔ `task_repository.rs:404-439` | 浏览器 `setTaskCompleted` 走 update 语义**保留**旧 `completedAt`；Rust `set_completed` 总是刷新。`batchComplete` 对已完成任务再勾会 reconcile 出错误值 | 浏览器分支独立实现（用已有的 `predictCompletedTask`） |
| 10 | `src/services/listService.ts:45` ↔ `list_repository.rs:41` | 新建清单默认 `sortOrder`：mock 排末尾（`length`）、Rust 排最前（`0`）；`App.tsx:490` 从不传参 → 两模式列表顺序永远不同 | 统一默认值，建议 UI 显式传末尾位置 |
| 11 | `src/services/taskService.ts:188-196` ↔ `task_repository.rs:244-247` | widget 按日查询排序漂移：Rust 侧 NULL due_at 排最前、完全不看 scheduled_date；mock 走完整 priority 排序。同优先级下"只有 scheduledDate"的任务两模式位置相反 | mock 按 widget 专用排序实现，或统一 ORDER BY |
| 12 | `src/services/recurringService.ts:56-59` | mock 创建循环规则非原子：规则先入数组，来源任务校验失败后 throw → 规则泄漏在 mock 存储；Rust 侧会回滚 | 先校验，或失败时移除 |

### 前端功能缺陷

| # | 位置 | 问题 | 建议 |
|---|------|------|------|
| 13 | `src/app/App.tsx:168` → `hooks/useAppDataLoaders.ts:43/57` | 内联 `onError` 每次渲染都是新引用 → 两个 `[onError]` effect 每次渲染重跑，**全量重拉** listCalendarEvents + listRecurringRules（任何乐观更新/键入都触发，IPC 风暴） | `useCallback` 包裹 |
| 14 | `src/app/App.tsx:382,438,447` | `useTrayQuickAdd`/`useKeyboardShortcuts` 收到每次渲染新建的回调 → 每次渲染重新订阅 `tray-quick-add` IPC | 同上，`useCallback` |
| 15 | `src/components/task/TaskListView.tsx:160`（92-110） | 回收站行硬编码 `batchMode={false}`，但批量条照常渲染"恢复/永久删除"，选中恒为 0、按钮恒禁用 → 回收站批量操作是死路 | 回收站分支接通选中，或隐藏批量条 |
| 16 | `src/app/WidgetApp.tsx:449` | handleCreate 无条件把新任务插入当前日期列表；WidgetQuickAdd 支持"明天/周X"，属于别的日期的任务会错误显示在便签里直到刷新 | 插入前比对 displayedDateKey，或改走 refreshDate |
| 17 | `src/components/dialog/StatsDialog.tsx:248,251,322` | `completedAt?.startsWith(本地dateKey)` 拿 UTC ISO 前缀比本地日期 → UTC+8 下每天 0:00–8:00 完成的统计算到前一天 | 先 `toLocalDateKey(completedAt)` 再比较 |
| 18 | `src/stores/taskStore.ts:754` | `runOptimistic` 失败时整份快照回滚，会覆盖期间并发成功的其它变更（慢的失败把已成功的删除"复活"） | 按受影响 id 还原（参考 `runOptimisticBatch`） |
| 19 | `src/utils/taskDates.ts:117` ↔ `src/services/taskQuery.ts:180` | 两套"过期"定义：`isOverdue` 精确到时间戳（今天 9 点的任务 9 点后标红），逾期视图/`due:过期`/侧栏计数按日期级 → 标红任务不在逾期视图里 | 统一定义（建议日期级） |
| 20 | `src/components/dialog/RecurringRuleDialog.tsx:142` | 旧任务 repeatRule 映射漏 `quarterly`，静默回退成"每周" | 补分支 |
| 21 | `src/components/dialog/SettingsBackupSection.tsx:23` | 备份列表只在手动备份后才加载 → 已有备份的恢复入口挂载时不可见 | 挂载时加载一次 |
| 22 | `src/services/widgetService.ts:109-114` | `notifyTasksChanged` 150ms 防抖只保留**最后一次**调用的 `affectedDateKeys`，前一次的日期键被丢弃 → widget 可能漏刷新 | 防抖期间并集累积 |

### 样式层联冲突

| # | 位置 | 问题 | 建议 |
|---|------|------|------|
| 23 | `src/styles/month.css:382` | `.calendar-task-drag-overlay` 用 `var(--shadow-md)`，tokens.css 无此变量（依赖 Tailwind 内部变量是否输出，待确认）→ 拖拽阴影可能静默丢失 | tokens.css 显式定义 |
| 24 | `src/styles/board.css:61-68` | 选择器误带 `.list-dot`（9px），级联覆盖 `layout.css:383` 侧边栏圆点的 10px 定义 | 从该选择器移除 `.list-dot` |
| 25 | `src/styles/task-list.css:596-625` ↔ `detail.css:430-453` | `.tag-pill`/`.subtask-pill` 两套冲突设计（11px 方块 vs 22px 胶囊），裸全局选择器 + 加载序导致详情页样式覆盖列表/看板行 | 给详情版加作用域（如 `.task-tags .tag-pill`），需先确认期望效果 |
| 26 | `src/services/widgetService.ts:63-70` + `src-tauri/src/widget.rs:58-77` | `widget` 设置键跨窗口（主窗设置开关 ↔ widget 窗几何防抖写）各自读-改-写、彼此无协调 → 互相吞字段 | patch 合并移到 Rust 侧单点执行，或拆独立设置键 |

---

## P2 — 冗余逻辑 / 语义漂移 / 重复实现

### 逻辑与语义

| # | 位置 | 问题 | 建议 |
|---|------|------|------|
| 27 | `src/services/recurringService.ts:243-261` | weekly `nextOccurrence` 循环未命中时**落进月度计算**（周规则被按月推进）；Rust 返回错误。且 mock 完全没有 `validate_schedule` 对应物，空 weekdays 的周规则可以建出来 | 未命中抛错；镜像校验 |
| 28 | `src/services/recurringService.ts:129-140,178-183` | 规则已结束时：Rust 报错；mock 返回成功，force 路径还顺手置空 `nextDueAt`、关 `enabled` | 对齐为 reject 且不变更状态 |
| 29 | `src/services/recurringService.ts:19-26` | 规则列表排序漂移：Rust `enabled DESC, next_due_at…`；mock 插入序 | mock 同样排序 |
| 30 | `src/services/calendarEventService.ts:54-97` | mock 无校验：可建出 `endDate < startDate` 的事件 → 月/周视图异常色带 | 镜像 Rust 校验 |
| 31 | `src/services/taskQuery.ts:109-129` ↔ `task_repository.rs:714-734` | 搜索词解析三处漂移：`p:+1`/`p:02` 接受度不同；`tag:##x` 剥 `#` 个数不同；大小写折叠规则不同（`zh-CN` locale vs `COLLATE NOCASE`） | 两侧对齐分词规则 |
| 32 | `src/services/browserTaskLinkMock.ts:58-80` ↔ `task_link_repository.rs:112-146` | 可关联任务搜索漂移：排序不同；mock 拼 `${title} ${note}` 允许跨字段命中 | 对齐排序与分字段匹配 |
| 33 | `src/services/taskQuery.ts:101-137` + `taskService.ts:44` | 查询串未 trim：`" foo"` 产生空前导 token 混入全文匹配，`includes` 永不命中（目前仅本地派生路径暴露） | `parseSearchQuery` 入口 trim + 过滤空 token |
| 34 | 多处：`listService.ts:129-142`、`browserAttachmentMock.ts:76,101`、`browserTaskLinkMock.ts:17-19,51` | mock 分支同步 `throw`，Tauri 分支 rejected Promise——`.catch()` 链式调用会得到未捕获同步异常 | 服务函数改 `async` |
| 35 | `src/services/taskService.ts:64-77` | mock `deleteTask` 不更新 `updatedAt`（Rust 与 `predictDeletedTask` 都更新） | 直接复用 `predictDeletedTask` |
| 36 | `src/services/listService.ts:20-24` | Tauri 模式下 `listsSnapshot` 硬编码预置三个默认清单直到首次 `listLists()`；若真实清单已改名/删除，启动窗口内 `l:` 解析用错清单集 | Tauri 模式初始置空 |
| 37 | `src/app/WidgetApp.tsx:418` | `changeAnchorDate` 直接调 `saveWidgetSettings`，绕过 writeChain 串行化，与几何防抖写并发互相吞字段 | 走 `enqueueSettings` |
| 38 | `src/components/detail/TaskDetailPanel.tsx:430,460` | 日期格保存后未退出编辑态（优先级/清单/提醒格都有 `setEditing(null)`） | onChange 后退出编辑 |
| 39 | `src/components/dialog/ConfirmDialog.tsx:40`（`TaskCreateDialog.tsx:53`、`RecurringRuleDialog.tsx:48` 同类） | `runAction` 只有 finally 无 catch → 回调失败成未处理 rejection，对话框卡住无提示 | catch 后显示错误 |
| 40 | `src/components/dialog/StatsDialog.tsx:29` | 趋势图两根柱归一化基数不同（created 用合并 max，done 只用自身 max）→ 相对高度误导 | 共用同一 max |
| 41 | `src/components/detail/TaskAttachmentSection.tsx:370` | 拖放监听 `.then` 未检查 disposed；详情面板按任务 id remount，快速切换任务累积失效监听 | 仿 `useTaskReminder` 的 cancelled 检查 |
| 42 | `src/components/dialog/SettingsSyncSection.tsx:1232,1262,1294,1356`、`SettingsBackupSection.tsx:119` | 确认浮层裸条件渲染，无 `usePresence` 退场动画（违反项目约定） | 统一改造 |

### Rust 后端

| # | 位置 | 问题 | 建议 |
|---|------|------|------|
| 43 | `db/recurring_repository.rs:351-386` | 删除规则的"未来实例"用两段 `strftime('now')` 窗口 → 记了同步删除变更但本地没删（幻影删除传播）；且载荷只有 `{id, deletedAt}`，无基线的接收端会触发与 P0 同类失败 | 统一一个 now、`WHERE id IN (…)`；载荷用 `current_task_payload` |
| 44 | `backup.rs:119-125,190-194,559-562` | 备份/恢复快照连接无 `busy_timeout`，`VACUUM INTO` 遇写即失败 | 设置 5s busy_timeout |
| 45 | `backup.rs:805-941,955-959,1010-1016` | 备份导入非原子（中途失败留半截数据）；且附件/链接导入对**任何** SQLite 错误 `return Ok(())` 静默吞掉，结果虚报成功 | 区分"表缺失"与真实错误；真实错误上报 |
| 46 | `lib.rs:31-45,178` | autoBackup（VACUUM + 逐附件哈希/压缩）在 `setup()` 同步执行，阻塞启动 | 移到后台线程 |
| 47 | `runtime/notifier.rs:64-70` | 查询缺 `purged_at IS NULL`（违反软删除两级约定，目前靠隐式不变量保安全） | 补条件 |
| 48 | `runtime/notifier.rs:47-49` | `send_native_notification` 失败用 `?` 中断整轮认领循环 | 单任务失败记日志后继续 |
| 49 | `sync/engine/apply.rs:610-611` | 用户数据路径上的 `.expect()`，依赖"validate 先行"不变量，未来新调用点绕过即崩溃 | 改为返回 `RepositoryError` |

### CSS 重复

| # | 位置 | 问题 | 建议 |
|---|------|------|------|
| 50 | `dialog.css:~696-1030` ↔ `recurring.css:~14-290` | 两个对话框作用域下约 20 条规则体逐字节相同 | 共用一个结构类（如 `form-dialog`） |
| 51 | `detail.css:786-804` ↔ `recurring.css:553-570` | `.icon-button.compact` 三条规则跨文件完全重复 | 移入 buttons.css |
| 52 | `detail.css:815` ↔ `settings.css:1231` | `.is-spinning` 定义两次（绑定两个视觉等价的 keyframes），settings.css 后加载获胜 → detail 版与 `detail-spin` keyframes 实为死代码 | 只留一处 |
| 53 | `controls.css:102`、`detail.css:316`、`layout.css:902`、`task-list.css:160` | `.is-exiting` 四处规则体完全相同 | 抽公共类 |
| 54 | `src/styles/tokens.css` | 5 个死变量（深浅各一份）：`--icon-faint`、`--accent-badge-bg`、`--yellow`、`--detail-shadow`、`--transition` | 删除 |
| 55 | `recurring.css:1-3` | `.form-grid-full` 定义在 recurring.css，实际被设置面板与 6+ 个对话框使用，归属错位 | 移到通用层 |

---

## P3 — 死代码 / 死文件 / 死样式

### 前端

| # | 位置 | 问题 |
|---|------|------|
| 56 | `src/components/task/TaskQuickAdd.tsx` | **整个组件无任何引用（死文件）**。注意：其内部的 `parseQuickAddText` 仍被 WidgetQuickAdd 使用，删除前需迁移该函数 |
| 57 | `src/utils/taskHelpers.ts:313` | `normalizeTags` 与 `utils/taskPrediction.ts:39` 逐字重复 |
| 58 | `src/hooks/useToast.ts:26` + `ToastHost.tsx:21` | legacy `actionLabel`/`onAction` 与 `actions` 双套字段并存 |
| 59 | `src/components/task/TaskDateTimeField.tsx:346`、`widget/WidgetTitleBar.tsx:5` | 私有 `getDateKey`/`isSameDate`/`pad` 重复实现 `utils/taskDates.ts` 已有函数 |
| 60 | `src/services/settingsService.ts:83` | `getBrowserSettingsSnapshot` 无外部调用方 |
| 61 | `src/services/recurringService.ts:316-318` | 重复实现 `toRfc3339Seconds`（`taskPrediction.ts:26-28` 已有）；且 `taskPrediction` 的 `computeRemindAt`/`toRfc3339Seconds`/`cloneSubtasks`/`normalizeTags` 导出均无外部 import |

### Rust

| # | 位置 | 问题 |
|---|------|------|
| 62 | `models.rs:169-182,225-229` | `AttachmentBlob`、`AttachmentQueryInput` 全仓无引用 |
| 63 | `db/attachment_repository.rs:283-285` | `mark_blob_pending_download` 无调用方 |
| 64 | `sync/engine/mod.rs:377-393`、`sync/engine/apply.rs:18-24` | `engine::run` 无调用方（生产走 `run_with_mode`）；`resolve_conflict` 仅测试用，靠文件头 `#![allow(dead_code)]` 压制 |
| 65 | `Cargo.toml:33,65-67` | reqwest 的 `"json"` feature 未见使用（待确认）；dev-dependencies 的 rusqlite/uuid 与 dependencies 重复 |

### CSS / 配置

| # | 位置 | 问题 |
|---|------|------|
| 66 | `settings.css:221-300,999-1008` | `.settings-nav-list` 全家族约 90 行无引用（实际用 `.settings-side-nav*`） |
| 67 | `month.css:438-443` | `.month-cell-more` 无 JSX 渲染 |
| 68 | `responsive.css:404,445,890,931` | `.quick-add kbd` 无对应元素；`.detail-footer` 已改名 `.detail-dialog-footer`，窄屏 wrap 覆盖失效（四处皆死） |
| 69 | `feedback.css:261-304` | 4 个 @keyframes 无 animation 引用 |
| 70 | 多处 | JSX 引用了无 CSS 定义的类（待确认是否有意留钩子）：`date-picker-calendar`、`month-add-event`、`pending-attachment-section`、`settings-about-row`、`task-date-field` |
| 71 | `settings.css:1452-1661` | `@media (max-width:720px)` 块内容是**所有对话框**的移动端适配，与 settings 无关，应迁入 responsive.css |
| 72 | `package.json:13` | `preview` script 无配置引用（Vite 脚手架残留，待确认） |

---

## 已核查无问题（不必处理）

- 版本号四处一致（2.6.3）；17 个 CSS 文件均经 @import 链加载，无死文件；npm 依赖全部有实际 import。
- `taskQuery.ts` ↔ `task_repository.rs` 的 8 视图过滤 / 4 排序主干语义对齐；`buildCounts` 与主查询口径一致。
- 迁移 append-only 无修改痕迹，`CURRENT_SCHEMA_VERSION` 与实际一致；restore_backup 安全检查（路径规范化、integrity_check、schema 校验、zip-slip）全部落实。
- 无 SQL 注入（用户文本全部参数化，LIKE 有转义）；加密实现（XChaCha20Poly1305 + argon2id + AAD 绑定）正确。
- 项目硬约束通过：WidgetApp 未 import taskStore；tasks-changed 监听均按 source 自排除；主对话框均用 usePresence。

---

## 建议处理批次

1. **第一批（P0 + 高危竞态）**：#1（同步载荷）、#2（双设备生成冲突）、#3/#4/#5（提醒与循环任务竞态 + busy_timeout）、#22（防抖丢日期键）。全部在 Rust/事件层，修完跑 `cargo +stable-x86_64-pc-windows-msvc test`，并给 #1 补回归测试。
2. **第二批（高频可感知前端缺陷）**：#13/#14（IPC 风暴）、#15（回收站批量）、#16（便签错日期）、#17（统计时区）、#18（回滚粒度）。改完 `pnpm build` + 浏览器 mock 验证。
3. **第三批（双模式对齐）**：#9–#12、#27–#36，一次对齐并同步两侧，避免再次漂移。
4. **第四批（CSS 级联修复）**：#23–#25 需要肉眼确认期望效果后再动。
5. **第五批（清理）**：P2 重复 CSS 合并 + P3 死代码删除（#56 删 `TaskQuickAdd.tsx` 前先迁移 `parseQuickAddText`）。风险低，可随各批次顺手做。

> 备注：#7（`\\?\` 路径）、#23（`--shadow-md`）、#70（无定义类）、#65/#72 标注为"待确认"，修复前建议先实测/构建验证。
