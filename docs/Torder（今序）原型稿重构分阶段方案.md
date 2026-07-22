# Torder（今序）原型稿重构分阶段方案

> 原型来源：`F:\Torder\原型图设计稿`
> 原型版本：`Torder-设计方案书.md` v2.0，日期 `2026-07-21`
> 方案目标：以新原型稿为主参考，对当前 React + Tauri 版本做 UI 与功能重构。静态 UI 允许不做 100% 像素复刻，但目标还原度不低于 90%，并按原型功能边界做增删改。

## 0. 结论先行

本次不是在当前绿色玻璃风格上继续微调，而是将产品重构为原型稿中的暗色优先三栏任务工作台：

- 左侧固定 `260px` 侧边栏：品牌、搜索、导航、我的清单、新建清单。
- 中间主内容区：顶部标题、列表/看板/日历三种布局、主题切换、排序和更多菜单。
- 右侧固定 `380px` 任务详情面板：选中任务后常驻展开，支持只读/编辑态切换。
- 任务列表采用时间线视觉：优先级节点、竖向连接线、完成态绿色节点。
- 新建任务使用居中 Dialog 表单，而不是当前顶部展开式快速输入作为主要创建体验。
- 功能边界以原型为准：计划中、重要、看板、日历、排序、显示已完成、批量模式、快捷键面板、新建清单需要补齐；原型没有的标签管理、复杂筛选页、独立设置页、提醒 Toast、备份导入导出入口等直接删除。
- 默认清单对齐原型设计：`工作 / 个人 / 学习`。
- 截止日期保留具体时间，不降级为纯日期。
- Tauri 托盘保留；托盘快速新建改为打开新建任务 Dialog。

## 1. 当前版本与原型差异

### 1.1 当前版本已有能力

| 模块 | 当前状态 | 说明 |
| --- | --- | --- |
| 任务 CRUD | 已有 | `TaskDetailDrawer`、`QuickAdd`、`taskStore`、Rust `TaskRepository` 已具备核心能力 |
| 视图 | 部分已有 | 当前为 `today/all/completed/overdue`，原型为 `all/today/planned/important/completed/customList` |
| 搜索筛选 | 已有但需改造 | 当前搜索在顶部工具栏，另有日期/优先级/清单/标签组合筛选；原型只有侧栏搜索和更多菜单 |
| 清单 | 底层已有、UI 不完整 | Rust list CRUD 已有，前端只加载清单，缺少原型的侧栏清单管理入口 |
| 标签 | 当前已有 | 已确认直接删除标签功能、UI、服务和数据结构 |
| 设置 | 当前已有完整设置页 | 删除独立设置页，仅保留原型中的主题切换和轻量更多菜单 |
| 主题 | 当前已有 system/light/dark | 原型是 dark/light 切换，暗色为默认视觉 |
| 提醒 | 当前已有 | 已确认直接删除提醒功能、UI、后台扫描和数据字段 |
| 备份导入导出 | 当前已有 | 已确认直接删除备份导入导出功能、UI、服务和后端命令 |
| 托盘/开机启动 | 当前已有 | 托盘保留，托盘快速新建改为打开新建任务 Dialog；开机启动随设置页删除一并移除 |

### 1.2 原型稿新增/要求补齐能力

| 能力 | 优先级 | 复杂度 | 备注 |
| --- | --- | --- | --- |
| 暗色优先设计令牌 | P0 | M | 替换当前绿色玻璃 token 为原型暗色/靛蓝体系 |
| 三栏布局 | P0 | L | App shell 需要重写，详情面板从 Drawer 改为右栏 |
| 左侧清单导航 | P0 | M | 支持动态清单、计数、搜索 |
| 新建任务 Dialog | P0 | M | 标题、描述、优先级、清单、截止日期与时间 |
| 任务列表时间线 | P0 | L | 重写任务行视觉和分组 |
| 计划中/重要视图 | P0 | M | 需要前后端查询规则对齐 |
| 排序与显示已完成 | P0 | M | 原型更多菜单中的核心控制 |
| 看板视图 | P1 | L | 三列分流，不做拖拽 |
| 日历视图 | P1 | L | 按日期分组，不做月历网格 |
| 新建清单 Dialog | P1 | M | 创建清单、颜色选择、侧栏刷新 |
| 批量选择模式 | P1 | M | 批量完成、批量删除、退出 |
| 快捷键面板 | P1 | S | `?` 打开，展示快捷键 |
| Toast 通知 | P1 | S | 创建/更新/删除/批量操作反馈 |

### 1.3 原型中发现的迁移注意点

| 问题 | 影响 | 处理建议 |
| --- | --- | --- |
| 原型 `renderBoard()` 调用了未定义的 `getTagClass(task.list)` | 看板原型运行时报错 | React 迁移时不要照搬，应使用清单颜色 token/inline style |
| 原型使用固定 `TODAY = '2026-07-21'` | 日期逻辑演示用 | 正式版必须使用本地当天日期 |
| 原型任务 ID 是 number 自增 | 当前正式版是 UUID string | 保持当前 UUID，不做 ID 类型迁移 |
| 原型 `desc` 字段对应当前 `note` | 字段命名不同 | UI 文案使用“描述”，数据层继续用 `note` 或统一重命名需单独迁移 |
| 原型优先级是 `high/medium/low` | 当前是 `2/1/0` | 推荐存储仍保留 `2/1/0`，UI 层映射为高/中/低 |

## 2. 功能取舍原则

### 2.1 默认执行原则

- 用户可见 UI 以原型稿为准。
- 原型没有且已确认删除的功能，不做隐藏入口，直接从 UI、服务、后端命令和数据结构中移除。
- 标签、提醒、备份属于本次直接删除范围；实现时仍需通过迁移或兼容代码处理已有数据，不能让数据库启动失败。
- 桌面基础能力如窗口、托盘、SQLite、Tauri 打包不属于原型静态 UI 范围，默认保留。
- 托盘保留，托盘快速新建统一触发新建任务 Dialog。

### 2.2 已确认删除或重构的现有 UI

| 当前功能/UI | 建议动作 | 原因 |
| --- | --- | --- |
| 顶部 `TaskToolbar` 的搜索/筛选/快速添加面板 | 移除并重构 | 原型搜索在侧栏，新建任务走 Dialog，筛选由视图和设置菜单承担 |
| `TagManagerDialog` 和标签筛选 | 删除 | 原型无独立标签概念，清单承担分类展示 |
| 独立 `SettingsPage` | 从主导航移除 | 原型仅有主题切换和更多菜单 |
| `ReminderToast` 和提醒设置 UI | 删除 | 已确认提醒功能直接删除 |
| `overdue` 顶级视图 | 移除顶级导航 | 原型通过日期颜色/日历分组体现逾期，不提供单独过期入口 |
| 侧栏折叠/移动端顶部导航 | 移除旧形态 | 原型是固定桌面三栏，移动端不是本轮重点 |
| 复杂日期/优先级/标签筛选面板 | 移除 | 原型只有搜索、视图、排序、显示已完成 |

### 2.3 已确认保留或删除的底层能力

| 底层能力 | 建议 |
| --- | --- |
| SQLite 数据库与 Repository 分层 | 保留 |
| JSON 备份导入导出命令 | 删除 |
| 标签表和任务标签表 | 删除，配套数据库迁移 |
| 提醒字段 `remind_at/reminded_at` | 删除，配套数据库迁移 |
| Tauri 托盘 | 保留打开窗口能力，快速新建行为改为打开新建任务 Dialog |

## 3. 阶段总览

状态标记规则：

- `[ ]` 未开始
- `[~]` 进行中
- `[x]` 已完成
- `[!]` 阻塞或待确认

| 阶段 | 状态 | 优先级 | 复杂度 | 主题 | 核心产出 |
| --- | --- | --- | --- | --- | --- |
| 阶段 0 | [x] | P0 | S | 范围确认与基线冻结 | 标签/提醒/备份直接删除，清单/时间/托盘策略已冻结 |
| 阶段 1 | [x] | P0 | M | 数据模型与状态重构 | 新视图、布局、排序、显示已完成、批量状态 |
| 阶段 2 | [x] | P0 | L | 后端查询与清单能力对齐 | Rust 查询规则、默认清单、迁移与减法代码已完成，MSVC 工具链单测通过 |
| 阶段 3 | [x] | P0 | L | App Shell 与设计令牌 | 暗色优先三栏布局、原型色彩系统 |
| 阶段 4 | [x] | P0 | L | 侧边栏与主列表 | 侧栏搜索/导航/清单、列表时间线、空状态 |
| 阶段 5 | [x] | P0 | M | 新建任务与详情右栏 | 新建任务 Dialog、详情只读/编辑态、删除确认 |
| 阶段 6 | [x] | P1 | L | 看板与日历视图 | 三列看板、日期分组日历 |
| 阶段 7 | [x] | P1 | M | 菜单、Toast、批量与快捷键 | 更多菜单、Toast、批量选择、快捷键面板 |
| 阶段 8 | [x] | P1 | M | 功能减法与兼容清理 | 移除旧 UI，删除标签/提醒/备份旧服务 |
| 阶段 9 | [x] | P0 | M | 回归验证与打包准备 | 前端 lint/build、Rust 单测、Playwright 回归与 Tauri 打包均已完成 |

## 4. 分阶段执行方案

### 阶段 0：范围确认与基线冻结

目标：在动代码前把“以原型为主”的边界钉死，避免重构中途来回返工。

优先级：P0
复杂度：S
建议耗时：0.5 天

任务清单：

- [x] 标签、提醒、备份直接删除，不保留隐藏入口。
- [x] 默认清单从当前 `收件箱/工作/生活` 调整为原型 `工作/个人/学习`。
- [x] 截止日期保留具体时间。
- [x] Tauri 托盘保留，托盘快速新建改为打开新建任务 Dialog。
- [x] 确认新默认视图从当前 `today` 改为原型 `all`。
- [x] 将原型截图作为视觉基线，保留到 `output/playwright/`。
- [x] 标记本方案文档中的确认结果，作为后续实现依据。

已生成的参考截图：

- `output/playwright/原型稿-列表首页.png`
- `output/playwright/原型稿-看板视图-临时补函数.png`
- `output/playwright/原型稿-日历视图.png`
- `output/playwright/原型稿-详情面板.png`
- `output/playwright/原型稿-详情编辑态.png`
- `output/playwright/原型稿-新建任务弹窗.png`
- `output/playwright/原型稿-设置菜单.png`
- `output/playwright/原型稿-快捷键面板.png`
- `output/playwright/原型稿-批量模式.png`

验收标准：

- [x] 标签、提醒、备份、默认清单、截止时间粒度、托盘快速新建已有明确答案。
- [x] 后续阶段不再围绕功能边界做大幅摇摆。

风险点：

- 删除标签/提醒/备份相关数据结构会影响旧备份兼容性；本次按“新原型优先”执行。
- 默认清单做强迁移时必须处理已有任务引用，避免 `tasks.list_id` 外键失效。

### 阶段 1：数据模型与前端状态重构

目标：先把前端状态模型改成原型需要的形状，再重写 UI。这样 UI 不会一边画一边补状态，手忙脚乱。

优先级：P0
复杂度：M
建议耗时：1 天

涉及文件：

- `src/types/database.ts`
- `src/types/settings.ts`
- `src/stores/taskStore.ts`
- `src/app/taskViews.ts`
- `src/app/taskDates.ts`

任务清单：

- [x] 将 `TaskView` 从 `today/all/completed/overdue` 调整为 `all/today/planned/important/completed`，并支持自定义清单视图。
- [x] 新增 `TaskLayout = 'list' | 'board' | 'calendar'`。
- [x] 新增 `TaskSortBy = 'priority' | 'date' | 'created'`。
- [x] 新增 `showCompleted` 状态，非 completed 视图下可隐藏完成任务。
- [x] 新增批量选择 UI 状态：`batchMode`、`batchSelectedIds`。
- [x] 将搜索状态收敛为 `searchQuery`，从当前复杂 `TaskFilters` 中拆出来。
- [x] 保留 `dueAt` 存储字段，UI 使用日期时间输入，展示日期、具体时间和今天/明天/N 天后/逾期等辅助文案。
- [x] 建立优先级映射：`2 -> high/高`、`1 -> medium/中`、`0 -> low/低`。

验收标准：

- [x] Store 能按原型规则派生过滤后的任务列表。
- [x] Store 能给侧栏提供各视图和各清单的 badge 计数。
- [x] 旧视图 `overdue` 不再作为主导航视图出现。
- [x] TypeScript 类型层不再依赖旧筛选面板结构。

风险点：

- 当前 `emptyTaskFilters` 和多个组件强依赖旧 filters，后续删除组件前会有中间态类型冲突。
- 自定义清单视图既可能是 `TaskView`，也可能是 `list:<id>` 形式；推荐用联合类型或独立字段，避免清单 ID 与系统视图撞名。

推荐实现：

- 推荐状态结构使用 `activeScope`：

```ts
type SystemView = "all" | "today" | "planned" | "important" | "completed";
type ActiveScope =
  | { kind: "view"; view: SystemView }
  | { kind: "list"; listId: string };
```

这样自定义清单不会污染系统视图枚举。

### 阶段 2：后端查询与清单能力对齐

目标：让正式 SQLite/Tauri 数据层支持原型视图、排序、清单创建和批量操作。

优先级：P0
复杂度：L
建议耗时：1.5 天

涉及文件：

- `src/services/taskService.ts`
- `src/services/listService.ts`
- `src-tauri/src/models.rs`
- `src-tauri/src/db/task_repository.rs`
- `src-tauri/src/db/list_repository.rs`
- `src-tauri/src/commands/task.rs`
- `src-tauri/src/commands/list.rs`
- `src-tauri/src/db/migrations.rs`

任务清单：

- [x] 扩展 `TaskQueryInput`：增加 `scope`、`sortBy`、`showCompleted`。
- [x] 实现 `planned` 查询：未完成且 `due_at IS NOT NULL`。
- [x] 实现 `important` 查询：未完成且 `priority = 2`。
- [x] 移除 UI 对 `overdue` 查询的依赖；后端也不再暴露旧 overdue 命令。
- [x] 实现按优先级、截止日期、创建时间排序。
- [x] 实现侧栏计数查询策略：前端根据已加载任务计算。
- [x] 补齐浏览器预览模式下 `createList/updateList/deleteList` 的内存实现。
- [x] 增加批量完成策略：前端串行调用 `setTaskCompleted`。
- [x] 增加批量软删除策略：前端串行调用 `deleteTask`。
- [x] 默认清单对齐原型：保留/创建 `work` 工作、`personal` 个人、`study` 学习。
- [x] 迁移旧默认清单：`life` 迁移为 `personal`，`inbox` 任务统一归并到 `work`，随后移除 `inbox` 默认清单。
- [x] 删除标签相关后端命令、Repository、模型、服务调用和数据库表。
- [x] 删除提醒相关后端命令、Repository 方法、前端服务、后台扫描和数据库字段。
- [x] 删除备份相关前端服务、后端命令、Repository 和备份模型。

验收标准：

- [x] 浏览器预览过滤/排序已验证，Rust 查询单测通过，Tauri 打包链路可用。
- [x] 新建清单后侧栏立即出现，任务 Dialog 能选择新清单。
- [x] 删除清单遵守外键/任务引用规则，不能误删已有任务。
- [x] 1000 条任务查询测试用例已随 Rust 单测通过。

风险点：

- `lists.name` 当前有唯一约束，重命名/迁移默认清单可能与用户自建清单重名，需要在迁移中做冲突处理。
- 批量删除如果逐条调用，失败恢复体验不如单事务；推荐后端做批量命令。

### 阶段 3：App Shell 与设计令牌重构

目标：把当前 `glass-shell` 风格替换为原型的暗色三栏工作台结构。

优先级：P0
复杂度：L
建议耗时：1.5 天

涉及文件：

- `src/app/App.tsx`
- `src/styles/globals.css`
- `src/app/theme.ts`
- `src/components/layout/AppSidebar.tsx`
- 新增 `src/components/layout/AppShell.tsx`（可选）

任务清单：

- [x] 重建页面根布局：`.app-shell { display:flex; height:100vh; overflow:hidden; }`。
- [x] 左栏固定 `260px`，中栏 `flex:1`，右栏 `380px`，详情隐藏时宽度归零。
- [x] 将原型 token 迁移到 `globals.css`：`--bg-primary`、`--bg-secondary`、`--bg-tertiary`、`--border`、`--accent` 等。
- [x] 暗色设为视觉默认，保留浅色主题覆盖。
- [x] 主题切换从当前 system/light/dark 简化为 UI 上的 dark/light 一键切换，底层仍兼容旧 `system` 值。
- [x] 移除旧 `app-ambient`、大面积玻璃阴影、绿色 accent。
- [x] 调整 Tauri 窗口背景策略：暗色视觉以 CSS 暗色面板为准。
- [x] 清理旧侧栏折叠逻辑。

验收标准：

- [x] 默认窗口 `480x600` 和宽窗下均能呈现稳定结构。
- [x] 宽窗下三栏比例接近原型。
- [x] 暗色视觉与原型截图接近，主色改为靛蓝 `#6366f1`。
- [x] 浅色主题不崩，但第一优先级是暗色。

风险点：

- 当前 Tauri 窗口最小宽度 `360`，三栏布局在窄窗无法完整展示，需要确认窄窗策略。
- 如果保留透明窗口，暗色面板透明度过高会影响可读性。

推荐窄窗策略：

- `>= 1040px`：完整三栏。
- `720px - 1039px`：左侧栏 + 主内容，详情以覆盖层抽屉出现。
- `< 720px`：保底单栏，原型不重点覆盖，仅保证不溢出。

### 阶段 4：侧边栏与主列表重构

目标：完成用户打开应用第一眼看到的主体体验。

优先级：P0
复杂度：L
建议耗时：2 天

涉及文件：

- `src/components/layout/AppSidebar.tsx`
- `src/components/task/TaskList.tsx`
- `src/components/task/TaskToolbar.tsx`（预期删除或大幅替换）
- `src/components/task/QuickAdd.tsx`（预期改为列表内入口）
- `src/app/taskViews.ts`

任务清单：

- [x] 侧边栏 header 改为原型 logo + `Torder` + `待办清单`。
- [x] 搜索框移入侧边栏，实时过滤标题和描述。
- [x] 导航改为：全部、今天、计划中、重要、已完成。
- [x] 侧边栏显示我的清单，使用颜色点和 badge。
- [x] 底部增加 `新建清单` 虚线按钮。
- [x] 主 header 左侧显示当前视图标题，右侧提供主题、排序、更多按钮。
- [x] 主 header 加入布局 tabs：列表/看板/日历。
- [x] 列表顶部显示 `添加新任务... Ctrl+N` 入口。
- [x] 列表任务分组为 `进行中 · N` 和 `已完成 · N`。
- [x] 任务行改为原型时间线节点：优先级色点 + 竖线。
- [x] 任务 meta 显示清单 badge、优先级点、截止日期相对文案和具体时间。
- [x] 完成态标题删除线、时间线节点绿色。
- [x] 空状态按当前 view 和 searchQuery 显示对应文案。

验收标准：

- [x] 列表首页视觉接近 `原型稿-列表首页.png`。
- [x] 搜索能过滤标题和描述，并能高亮关键词。
- [x] 点击系统视图/清单能更新标题、列表和 active 状态。
- [x] 点击任务能打开右侧详情面板。
- [x] 完成/恢复任务后列表、badge、详情状态同步。

风险点：

- 当前任务列表点击区域和 checkbox 点击事件需要重新梳理，避免点击完成时又打开详情。
- 当前标签 UI 和任务 meta 交织，需要拆掉标签后重做 meta。

### 阶段 5：新建任务 Dialog 与右侧详情面板

目标：重构任务创建、查看、编辑、删除的核心闭环。

优先级：P0
复杂度：M
建议耗时：1.5 天

涉及文件：

- `src/components/task/TaskCreateDialog.tsx`（新增）
- `src/components/task/TaskDetailPanel.tsx`（替代 `TaskDetailDrawer`）
- `src/components/task/DeleteConfirmDialog.tsx`（可新增或复用 Radix）
- `src/services/taskService.ts`
- `src/app/App.tsx`

任务清单：

- [x] 新建任务入口统一打开 Dialog。
- [x] Dialog 字段对齐原型并按确认调整：任务名称、描述、优先级、所属清单、截止日期与具体时间。
- [x] 默认优先级为“中”，默认清单按 `工作 / 个人 / 学习` 策略设置。
- [x] `Ctrl+Enter` 提交当前 Dialog。
- [x] 空标题校验并给出错误反馈。
- [x] 创建成功后插入/刷新列表，显示 Toast。
- [x] 右侧详情面板分只读和编辑态。
- [x] 只读态显示：任务名称、描述、优先级、所属清单、截止日期时间、状态。
- [x] 编辑态字段对齐 Dialog，可修改标题、描述、优先级、清单、截止日期时间。
- [x] 删除任务走确认弹窗，不直接删除。
- [x] 详情面板关闭后清除 `selectedTaskId`。

验收标准：

- [x] 新建任务弹窗视觉接近 `原型稿-新建任务弹窗.png`。
- [x] 右侧详情视觉接近 `原型稿-详情面板.png` 和 `原型稿-详情编辑态.png`。
- [x] 创建/编辑/删除任务在浏览器预览模式通过 Playwright 验证，相关 Rust CRUD 单测通过。
- [x] 不再依赖 `TagManagerDialog` 或旧详情抽屉。

风险点：

- 当前 `TaskDetailDrawer` 支持标签关联，迁移时要彻底删除相关请求，避免打开详情时仍调用 `listTaskTagIds`。
- 当前 `dueAt` 是 ISO datetime；新 UI 继续保留具体时间输入和展示。

推荐日期策略：

- UI 输入使用 `datetime-local`，展示时同时显示日期和时间。
- 数据库存储继续使用 ISO 字符串。
- 如果后续需要快速选择“今天/明天”，只作为辅助填充，不改变“保留具体时间”的原则。

### 阶段 6：看板与日历视图

目标：补齐原型中的两种替代布局，但保持轻量，不引入拖拽和复杂日历引擎。

优先级：P1
复杂度：L
建议耗时：2 天

涉及文件：

- `src/components/task/TaskBoard.tsx`（新增）
- `src/components/task/TaskCalendar.tsx`（新增）
- `src/components/task/TaskCard.tsx`（可新增）
- `src/stores/taskStore.ts`
- `src/app/taskDates.ts`

任务清单：

- [x] 看板视图实现三列：待处理、进行中、已完成。
- [x] 看板分列规则按原型：未完成且非高优先级为待处理，高优先级未完成为进行中，已完成为已完成。
- [x] 看板卡片显示清单、标题、描述、日期。
- [x] 看板卡片点击打开详情。
- [x] 日历视图按 `dueAt` 日期分组，日期升序。
- [x] 无日期任务进入“未安排”分组。
- [x] 日期标题 sticky，今日显示 badge。
- [x] 列表/看板/日历切换不重置搜索和当前系统视图。
- [x] 布局模式作为会话状态保留，不进入设置持久化。

验收标准：

- [x] 看板视觉接近 `原型稿-看板视图-临时补函数.png`。
- [x] 日历视觉接近 `原型稿-日历视图.png`。
- [x] 三种布局下任务选中态和详情面板同步。
- [x] 原型 `getTagClass` 缺陷已在正式实现中规避。

风险点：

- 看板不是拖拽看板，不应引入复杂拖拽库。
- 日历不是月视图，不应扩展成完整日程系统。

### 阶段 7：菜单、Toast、批量与快捷键

目标：补齐原型的操作层，让界面从“能看”变成“能顺手用”。

优先级：P1
复杂度：M
建议耗时：1.5 天

涉及文件：

- `src/components/task/TaskViewMenu.tsx`（新增）
- `src/components/common/ToastHost.tsx`（新增或轻量实现）
- `src/components/common/ShortcutsDialog.tsx`（新增）
- `src/components/task/BatchActionBar.tsx`（新增）
- `src/app/App.tsx`

任务清单：

- [x] 顶部更多菜单实现排序方式：按优先级、按截止日期、按创建时间。
- [x] 顶部更多菜单实现显示/隐藏已完成。
- [x] 顶部更多菜单不保留“重置演示数据”，正式应用不提供该入口。
- [x] Toast 支持 success/error/info 三类。
- [x] `?` 打开快捷键面板。
- [x] `B` 切换批量选择模式。
- [x] 批量模式隐藏时间线，显示批量 checkbox。
- [x] 批量栏显示已选数量，并支持完成、删除、退出。
- [x] `Ctrl+N` 打开新建任务 Dialog。
- [x] `Esc` 关闭菜单、弹窗、快捷键面板或详情编辑态。

验收标准：

- [x] 设置菜单视觉接近 `原型稿-设置菜单.png`。
- [x] 快捷键面板视觉接近 `原型稿-快捷键面板.png`。
- [x] 批量模式视觉接近 `原型稿-批量模式.png`。
- [x] 批量删除使用确认或明确的 Toast 反馈，避免误操作。

风险点：

- `B` 快捷键需要忽略输入框和弹窗内编辑状态。
- 批量删除应尽量后端单事务，避免部分删除成功造成状态不一致。

### 阶段 8：功能减法与兼容清理

目标：把不属于原型的旧 UI 和旧逻辑真正移干净，避免项目里同时存在两套产品。

优先级：P1
复杂度：M
建议耗时：1 天

涉及文件：

- `src/components/task/TaskToolbar.tsx`
- `src/components/task/QuickAdd.tsx`
- `src/components/task/TagManagerDialog.tsx`
- `src/components/settings/SettingsPage.tsx`
- `src/components/reminder/ReminderToast.tsx`
- `src/services/tagService.ts`
- `src/services/reminderService.ts`
- `src/services/backupService.ts`
- `src/app/App.tsx`

任务清单：

- [x] 删除或停止引用旧 `TaskToolbar`。
- [x] 删除或停止引用旧 `QuickAdd` 展开式输入组件。
- [x] 删除或停止引用 `TagManagerDialog`。
- [x] 删除或停止引用 `SettingsPage`。
- [x] 删除或停止引用 `ReminderToast`。
- [x] 清理不再使用的 imports、types、CSS class。
- [x] 清理旧绿色玻璃设计 token。
- [x] 删除 tag/reminder/backup services 及其所有 UI、命令和未使用类型。
- [x] README 当前功能说明本轮不改，避免扩大文档范围；方案书已记录重构状态。

验收标准：

- [x] `rg "TagManagerDialog|TaskToolbar|SettingsPage|ReminderToast"` 不再出现用户可见引用。
- [x] TypeScript 无未使用导入/变量。
- [x] UI 中不再出现旧的筛选面板、标签管理、设置页入口。

风险点：

- 直接删除备份功能会让旧 JSON 备份无法继续通过应用导入；本次按已确认的删除策略执行。
- 删除数据库字段/表需要迁移脚本，不能只删 TypeScript/Rust 代码。
- README 是否同步修改属于文档变更，建议在最终实现稳定后再做。

### 阶段 9：回归验证与打包准备

目标：确保大重构后可用、可测、可打包。

优先级：P0
复杂度：M
建议耗时：1 天

涉及范围：

- 前端类型检查、lint
- Rust 单元测试
- Playwright UI 截图
- Tauri 基础启动
- 打包规则 `RULE.md`

任务清单：

- [x] 运行 `pnpm lint`。
- [x] 运行 `pnpm build`。
- [x] 运行 `cargo +stable-x86_64-pc-windows-msvc test --manifest-path src-tauri/Cargo.toml`，3 个 Rust 单测通过。
- [x] 使用 Playwright 验证列表、看板、日历、详情、新建弹窗、设置菜单、快捷键、批量模式。
- [x] 宽窗截图：完整三栏。
- [x] 默认窗口截图：主流程可用。
- [x] 窄窗截图：不溢出、不重叠。
- [x] 按 `RULE.md` 低内存策略执行 `pnpm tauri build`，生成 NSIS 安装包。

验收标准：

- [x] 主要命令通过：`pnpm lint`、`pnpm build`、Rust 单测、Playwright 回归、`pnpm tauri build`。
- [x] 关键 UI 状态有截图记录。
- [x] 验证产物路径已记录，历史截图和用户既有文件不做清理。
- [x] 打包时遵守 NSIS + `CARGO_BUILD_JOBS=4` 的低内存策略。

风险点：

- 大量 CSS 重写容易产生窄窗溢出，需要 Playwright 多尺寸验证。
- Rust 端 schema/查询变更可能影响现有测试，需要同步更新测试用例。

## 5. 推荐实施顺序

推荐按“数据与状态先行，UI 主干其次，增强功能最后”的路线推进：

1. 阶段 0：先确认删留边界。
2. 阶段 1-2：先完成状态和查询能力，避免 UI 写完后发现数据拿不到。
3. 阶段 3-5：集中完成最核心的三栏、列表、新建、详情闭环。
4. 阶段 6-7：补齐看板、日历、批量、快捷键和 Toast。
5. 阶段 8-9：清理旧功能并完整验证。

不建议先做看板/日历，也不建议一开始就删除旧后端表结构。先让主流程跑起来，再做减法，风险最低。

## 6. 组件重构映射

| 原型模块 | 当前组件/文件 | 重构动作 |
| --- | --- | --- |
| `.sidebar` | `AppSidebar.tsx` | 重写为固定侧栏，加入搜索、动态清单、新建清单 |
| `.main-header` | `App.tsx` 内 header | 抽成主 header 或直接重写，加入 tabs 和操作菜单 |
| `.quick-add` | `QuickAdd.tsx` | 改为列表入口按钮，点击打开 Dialog |
| `renderList/createTaskElement` | `TaskList.tsx` | 重写任务行和时间线视觉 |
| `renderBoard` | 无 | 新增 `TaskBoard.tsx` |
| `renderCalendar` | 无 | 新增 `TaskCalendar.tsx` |
| `.detail-panel` | `TaskDetailDrawer.tsx` | 替换为右侧 `TaskDetailPanel.tsx` |
| 新建任务 Dialog | 无独立同款 | 新增 `TaskCreateDialog.tsx` |
| 新建清单 Dialog | 无 UI | 新增 `ListCreateDialog.tsx` |
| 确认删除弹窗 | 分散逻辑 | 新增或复用 Radix AlertDialog |
| Toast | `ReminderToast` 不匹配 | 新增普通 Toast，不复用提醒 Toast |
| Settings Menu | `SettingsPage` 不匹配 | 新增轻量 dropdown，移除设置页入口 |
| Shortcuts Panel | 无 | 新增 `ShortcutsDialog.tsx` |
| Batch Mode | 无 | 新增批量状态和 `BatchActionBar` |

## 7. 数据与迁移建议

### 7.1 清单

当前默认清单：`inbox`、`work`、`life`
目标默认清单：`work`、`personal`、`study`

已确认方案：

- 默认清单必须对齐原型：`工作 / 个人 / 学习`。
- `life` 迁移为 `personal`，展示名改为“个人”。
- 新增 `study`，展示名为“学习”。
- `inbox` 不再作为默认清单保留；实现时先将其任务引用统一迁移到 `work`，再移除 `inbox` 默认清单。
- 新建任务默认清单优先使用当前选中的自定义清单；如果当前是系统视图，则默认 `work`。

### 7.2 标签

原型没有独立标签。已确认直接删除：

- 删除 `TagManagerDialog`、标签筛选、任务详情标签关联 UI。
- 删除 `tagService`、前端类型引用和所有 `tagIds` 相关状态。
- 删除 Rust tag commands、`TagRepository`、相关模型。
- 删除 `tags`、`task_tags` 表及备份中相关字段。

### 7.3 提醒

原型没有提醒。已确认直接删除：

- 删除提醒 UI、`ReminderToast`、提醒服务和后台扫描。
- 删除 `remind_at`、`reminded_at` 字段及相关 repository 方法。
- 删除系统通知插件依赖，除非后续有其它功能使用。
- 托盘快速新建不再绑定提醒流程，只打开新建任务 Dialog。

### 7.4 备份

原型没有备份入口。已确认直接删除：

- 删除备份导出/导入 UI。
- 删除 `backupService`、备份类型、Rust backup commands 和 `BackupRepository`。
- 删除备份相关测试或改写为其它数据迁移测试。
- 删除后不再承诺兼容旧 JSON 备份导入。

## 8. 验证策略

当前重构验证闭环已完成；后续继续迭代时仍按每阶段最小验证执行：

| 阶段 | 最小验证 |
| --- | --- |
| 阶段 1 | `pnpm build` 或至少 `tsc`，验证类型模型 |
| 阶段 2 | `cargo +stable-x86_64-pc-windows-msvc test --manifest-path src-tauri/Cargo.toml` |
| 阶段 3-5 | Playwright 截图：列表、详情、新建弹窗 |
| 阶段 6 | Playwright 截图：看板、日历 |
| 阶段 7 | Playwright 交互：菜单、快捷键、批量 |
| 阶段 8 | `pnpm lint`，确认无旧引用 |
| 阶段 9 | 全量构建、截图回归和 Tauri 打包 |

## 9. 已确认决策与剩余问题

### 9.1 已确认决策

1. 标签功能直接删除。
   - 删除 UI、前端服务、Rust 命令、Repository、模型、数据库表和备份字段。

2. 提醒功能直接删除。
   - 删除提醒 UI、后台扫描、系统通知插件调用、`remind_at/reminded_at` 字段和相关命令。

3. 备份导入导出直接删除。
   - 删除备份 UI、前端服务、Rust 命令、Repository、类型和相关测试，不再提供隐藏入口。

4. 默认清单对齐原型设计。
   - 目标默认清单为 `工作 / 个人 / 学习`。
   - `life` 迁移为 `personal`，`inbox` 不再作为默认清单保留，旧 `inbox` 任务统一归并到 `work`。

5. 截止日期保留具体时间。
   - 新建和编辑任务使用日期时间输入，不降级为纯日期。
   - 数据库继续存 ISO datetime。

6. Tauri 托盘和快速新建保留。
   - 托盘继续提供打开窗口能力。
   - 托盘快速新建改为打开新建任务 Dialog。

7. 新默认视图改为原型首页 `all`。
   - Store 默认 scope 为 `{ kind: "view", view: "all" }`。

8. 旧 `inbox` 任务统一迁移到 `work`。
   - 原型没有收件箱，迁移后不保留 `inbox` 默认清单。

9. 主题入口采用原型轻量切换。
   - UI 只提供明暗切换；底层继续兼容旧 `system` 值。

10. 保留当前默认小窗口 `480x600`。
    - 宽窗显示完整三栏；窄窗采用顶部横向图标导航和详情覆盖层。

11. 不提供“重置演示数据”入口。
    - 浏览器预览使用内存 mock 数据，正式 UI 不暴露重置入口。

### 9.2 剩余问题

当前无产品取舍待确认，验证闭环已完成。后续只需在进入新功能迭代前重新确认是否继续严格以原型稿为唯一功能边界。

## 10. 最终验证记录

- `pnpm lint`：通过。
- `pnpm build`：通过。
- `cargo +stable-x86_64-pc-windows-msvc test --manifest-path src-tauri/Cargo.toml`：通过，3 个 Rust 单测通过。
- `pnpm tauri build`：通过，生成 `src-tauri\target\release\bundle\nsis\Torder_1.0.0_x64-setup.exe`。
- Playwright 回归：列表、详情、新建任务、更多菜单、看板、日历、快捷键、搜索、批量模式、默认窗口均已截图验证。

关键截图：

- `output/playwright/重构-最终-宽窗-首页.png`
- `output/playwright/重构-最终-宽窗-详情.png`
- `output/playwright/重构-最终-宽窗-新建任务.png`
- `output/playwright/重构-最终-宽窗-菜单.png`
- `output/playwright/重构-最终-宽窗-看板.png`
- `output/playwright/重构-最终-宽窗-日历.png`
- `output/playwright/重构-最终-宽窗-快捷键.png`
- `output/playwright/重构-最终-宽窗-搜索.png`
- `output/playwright/重构-最终-宽窗-批量.png`
- `output/playwright/重构-最终-默认窗口.png`
- `output/playwright/重构-最终-默认窗口-正常.png`

## 11. 本轮不做的事

- 不做拖拽看板。
- 不做完整月历/周历。
- 不引入新的 UI 组件库。
- 不创建云同步、账号或服务端能力。

## 12. 下一步建议

当前方案中的删除和保留边界已经冻结，阶段 1-9 已完成闭环。下一步建议进入真实使用反馈阶段：先用默认窗口和宽窗各跑一轮日常任务流，再根据实际手感决定是否微调密度、快捷入口和看板/日历的细节。
