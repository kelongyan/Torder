# Issue #7 剩余功能收尾实现方案

> 更新时间：2026-08-25  
> 范围：围绕 issue #7「功能建议，添加文件」继续收尾。  
> 明确排除：**不实现“新增/修改任务改成列表抽屉展开”**，现阶段不调整为抽屉式 UI；但附件拖拽、附件管理、任务引用等必要交互入口可以继续做。

## 1. 背景与当前结论

用户在 issue #7 提了 3 点：

1. 新增任务 / 修改任务时，支持拖拽文件到任务详情中，并支持选择“引入地址”或“复制文件”。
2. 新增 / 修改任务从弹窗改成列表抽屉展开。
3. 支持引用其他任务。

当前仓库已经完成了附件底层的核心能力，但还没有把这些能力完整暴露到任务创建 / 任务详情界面，也没有实现“引用其他任务”的数据结构与交互。

### 已完成能力

- 附件数据表已存在：`attachment_blobs`、`task_attachments`、`local_attachment_references`。
- 后端已支持 3 类附件：
  - `managed`：复制文件到应用托管目录；
  - `localReference`：只记录本机原文件路径；
  - `webLink`：网页链接类附件。
- 后端命令已注册：
  - `list_task_attachments`
  - `add_managed_attachment`
  - `add_local_attachment_reference`
  - `add_web_link_attachment`
  - `delete_attachment`
  - `open_attachment`
  - `reveal_attachment`
  - `get_attachment_transfer_status`
- 附件同步已接入 WebDAV：
  - 托管附件随同步上传 / 下载；
  - 开启同步加密时，附件内容也走加密链路；
  - 远端附件清理已有设备确认逻辑。
- 备份 / 恢复已覆盖托管附件：
  - 备份 zip 包包含数据库和托管附件 blob；
  - 恢复时会还原附件 blob；
  - 导出 Markdown / CSV / JSON 时已包含附件名称。
- 已有 Rust 测试覆盖附件 schema、仓储、同步和备份核心链路。

### 未完成能力

- `TaskDetailPanel` 里还没有附件区，没有拖拽、选择文件、复制 / 引用模式切换、打开 / 定位 / 删除入口。
- `TaskCreateDialog` 里还不能在任务创建前暂存附件，提交任务后再批量绑定。
- 当前项目还没有 `@tauri-apps/plugin-dialog` / `tauri-plugin-dialog`，缺少“选择文件”按钮需要的桌面文件选择器能力。
- 任务引用功能还没有 schema、Rust repository、Tauri command、前端 service、浏览器 mock、同步、备份 / 导出和 UI。
- 抽屉式新增 / 修改任务属于用户建议之一，但当前明确不实现。

## 2. 总体实现原则

1. **不重做已完成底层链路**  
   附件存储、同步、备份已经有基础，后续以“接 UI、补缺口、补验收”为主。

2. **保留现有任务创建弹窗与任务详情面板**  
   不把新增 / 修改任务改为列表抽屉。附件区和任务引用区直接接进现有 `TaskCreateDialog` / `TaskDetailPanel`。

3. **桌面端优先完整实现，浏览器 mock 保持语义一致**  
   Tauri 桌面端能拿到拖入文件路径；浏览器预览无法稳定拿到本机真实路径，只做 mock 预览，不承诺真实文件打开能力。

4. **复制文件与本机引用要明确区分**  
   - 复制文件：进入应用托管目录，可同步、可备份恢复。
   - 引用地址：只记录本机路径，不上传、不跨设备同步文件内容，跨设备仅可显示记录或提示“本机路径不可用”。

5. **任务引用按独立实体实现**  
   不把引用关系塞进 `note`、`tags` 或 `subtasks`，避免后续同步、导出、搜索、删除时不可控。

## 3. 阶段划分

## P0：附件入口收尾（最高优先级）

目标：把已经完成的附件底层能力真正接到任务详情和新建任务流程里。

### P0.1 新增附件组件

建议新增：

- `src/components/detail/TaskAttachmentSection.tsx`
- `src/components/detail/AttachmentModeMenu.tsx`（也可先内联，后续再抽）

组件职责：

- 加载当前任务附件：调用 `listTaskAttachments(task.id)`。
- 展示附件列表：
  - 文件名 / 链接名；
  - 类型：复制文件 / 本机引用 / 网页链接；
  - 文件大小、同步状态、错误状态；
  - 操作按钮：打开、定位、删除。
- 支持添加附件：
  - 拖拽文件；
  - 点击选择文件；
  - 添加网页链接。
- 添加前让用户选择处理方式：
  - 复制到应用内；
  - 引用本机原路径。

### P0.2 任务详情接入附件区

修改：

- `src/components/detail/TaskDetailPanel.tsx`
- `src/styles/detail.css`

接入位置建议：

- 放在“检查清单”和“标签”之间，理由是附件属于任务内容补充，比标签更接近任务正文。

关键行为：

- 打开任务详情时加载附件。
- 添加 / 删除附件后只刷新附件列表，不强制刷新全量任务列表。
- 删除附件走软删除。
- `managed` 和 `localReference` 显示“打开”和“定位”。
- `webLink` 显示“打开链接”，不显示“定位文件”。
- `syncState = failed/missing` 时显示轻量错误提示。

### P0.3 桌面端拖拽文件

实现方式：

- 使用 `@tauri-apps/api/webview` 的 `getCurrentWebview().onDragDropEvent(...)` 获取桌面端拖入路径。
- 拖入 `type === "drop"` 时读取 `event.payload.paths`。
- 将路径列表交给附件区处理。

注意：

- 浏览器 `DataTransfer.files` 通常拿不到可靠本机路径，不能直接喂给当前 Rust `sourcePath` 接口。
- 浏览器预览模式只做 mock：可以显示“模拟附件”，但不能真实打开 / 定位文件。
- 拖拽 hover 态只做现有风格内的轻量视觉反馈，不做新的抽屉式交互。

### P0.4 文件选择按钮

需要补依赖：

- 前端：`@tauri-apps/plugin-dialog`
- Rust：`tauri-plugin-dialog`
- `src-tauri/src/lib.rs`：注册 dialog 插件。
- `src-tauri/capabilities/default.json`：补 dialog open 权限。

按钮行为：

- 支持多选文件。
- 选择后弹出同一个“复制 / 引用”处理方式确认。
- 用户取消选择时无副作用。

### P0.5 新建任务时带附件

修改：

- `src/components/dialog/TaskCreateDialog.tsx`
- 可能扩展 `src/utils/taskHelpers.ts` 的 `TaskDraft`
- 复用或新增 `PendingAttachmentSection`

实现策略：

- 创建任务前，附件先放在本地 draft 中：
  - `sourcePath`
  - `mode: "managed" | "localReference"`
  - `displayName`
  - 可选 `webLink`
- 用户点击创建任务后：
  1. 先调用 `createTask(...)` 创建普通任务；
  2. 拿到返回的 `task.id`；
  3. 再逐个调用 `addManagedAttachment` / `addLocalAttachmentReference` / `addWebLinkAttachment`；
  4. 附件全部成功后关闭弹窗；
  5. 如果任务已创建但部分附件失败，保留任务，并提示失败附件数量和原因。

边界：

- 第一版只支持普通任务创建时带附件。
- 循环任务创建时暂不继承附件；后续如果要做，需要单独定义“附件是否跟随每个生成实例复制 / 引用”的规则，避免误同步大文件。

### P0.6 附件错误与限制

沿用现有 Rust 约束：

- 单任务最多 50 个附件。
- 单个托管附件最大 100MB。
- 目录不能作为附件源。
- `webLink` 仅允许 `http://` / `https://`。

前端补充：

- 添加前可提前提示 100MB 限制。
- 后端返回错误时转成中文提示。
- 本机引用文件不存在时，打开 / 定位失败要提示“文件可能已移动或删除”。

### P0 验收标准

- 编辑已有任务时，拖入文件并选择“复制到应用内”，附件出现在详情区，重启后仍存在。
- 编辑已有任务时，拖入文件并选择“引用本机原路径”，附件可打开 / 定位，但不进入同步上传队列。
- 点击选择文件可以多选，处理结果与拖拽一致。
- 新建普通任务时先添加附件，提交后任务和附件都创建成功。
- 删除附件后，详情区消失，重新打开任务仍不显示。
- `pnpm build` 通过。
- `pnpm lint` 通过。
- `cargo +stable-x86_64-pc-windows-msvc test --test database_test` 通过。
- 至少用 Tauri 桌面实测一次拖拽文件路径。

## P1：任务引用底层能力

目标：实现“支持引用其他任务”的可靠数据模型和 IPC 能力。

### P1.1 新增 migration

新增 schema version，建议表名：

```sql
CREATE TABLE task_links (
    id TEXT PRIMARY KEY,
    source_task_id TEXT NOT NULL,
    target_task_id TEXT NOT NULL,
    relation_type TEXT NOT NULL DEFAULT 'reference'
        CHECK (relation_type IN ('reference')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    deleted_at TEXT,
    FOREIGN KEY (source_task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (target_task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    CHECK (source_task_id <> target_task_id)
);

CREATE UNIQUE INDEX idx_task_links_live_pair
    ON task_links(source_task_id, target_task_id, relation_type)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_task_links_source
    ON task_links(source_task_id, sort_order, created_at)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_task_links_target
    ON task_links(target_task_id)
    WHERE deleted_at IS NULL;
```

设计说明：

- `source_task_id`：当前任务。
- `target_task_id`：被引用任务。
- 默认单向引用，避免“引用”和“被引用”混成一团。
- 不允许自己引用自己。
- 同一任务对同一目标只允许一条 live 引用。
- 用软删除配合同步 tombstone。

### P1.2 Rust 模型与仓储

新增 / 修改：

- `src-tauri/src/models.rs`
  - `TaskLink`
  - `CreateTaskLinkInput`
- `src-tauri/src/db/task_link_repository.rs`
- `src-tauri/src/db/mod.rs`

仓储方法：

- `list_by_task(task_id)`
- `create(input)`
- `soft_delete(id)`
- `search_linkable_tasks(query, exclude_task_id, limit)` 或复用现有任务查询后前端过滤。

校验：

- source / target 必须存在且未删除、未清空。
- 不允许 source = target。
- 已存在 live link 时返回已有记录，或者给明确错误；推荐返回已有记录，减少重复点击带来的失败感。
- 目标任务软删除后，引用列表默认不显示；如果要显示历史引用，可后续单独加“显示已删除引用”。

### P1.3 Tauri commands 与前端 service

新增命令：

- `list_task_links`
- `create_task_link`
- `delete_task_link`
- `search_linkable_tasks`

前端新增：

- `src/services/taskLinkService.ts`
- `src/services/browserTaskLinkMock.ts`
- `src/types/database.ts` 补 `TaskLink` 类型。

`lib.rs` 注册新命令。

### P1.4 同步接入

新增同步实体：

- entity：`taskLink`

同步要点：

- `sync_changes` 记录 `taskLink` upsert / delete。
- 应用远端变更时，顺序必须在 `task` 之后，因为 `taskLink` 依赖任务存在。
- 远端 payload 校验：
  - source / target id 非空；
  - source != target；
  - relationType 只能是 `reference`；
  - deletedAt 合法。
- 如果远端引用的任务本地不存在：
  - 同一轮同步里任务应先落库；
  - 若仍不存在，延后或跳过并保留冲突 / 错误，不硬插坏数据。

### P1.5 备份 / 导出接入

备份：

- 整库备份天然包含 `task_links`。
- 恢复时随 schema 自动恢复。

选择性导入：

- 如果导入任务时保留原 task id，可直接导入 link。
- 如果未来改成重新生成 task id，必须做 id 映射后再导入 link。
- 只导入部分任务时，跳过 target 不存在的 link，并计入 skipped 数量。

导出：

- JSON 导出增加 `taskLinks`。
- Markdown / CSV 可先显示被引用任务标题，避免暴露内部 id。

### P1 验收标准

- 任务 A 可以引用任务 B。
- 任务 A 不能引用自己。
- 重复引用不会生成重复记录。
- 删除引用后重新打开任务不再显示。
- 被引用任务删除后，引用区不展示坏链接。
- 同步后另一台设备能看到引用关系。
- 备份恢复后引用关系仍存在。
- `cargo +stable-x86_64-pc-windows-msvc test` 通过。

## P2：任务引用 UI 收尾

目标：把 P1 的任务引用能力接到任务详情里，不做抽屉式改造。

### P2.1 任务详情新增“引用任务”区

建议新增：

- `src/components/detail/TaskLinkSection.tsx`

位置：

- 放在附件区之后、标签区之前。

展示内容：

- 被引用任务标题。
- 所属清单颜色 / 名称。
- 状态：进行中 / 已完成。
- 计划日期 / 截止时间。
- 已删除或不可用状态的轻量提示。

操作：

- 搜索任务并添加引用。
- 点击引用任务后打开该任务详情。
- 删除引用。

### P2.2 搜索与选择

建议交互：

- 输入关键词后展示候选任务。
- 默认排除当前任务。
- 默认排除已删除任务。
- 可以显示最近任务作为空搜索候选。
- 候选项最多 10 条，避免详情面板过长。

可复用现有数据：

- 前端已有 `taskStore.allTasks`，第一版可以先从本地 allTasks 过滤，减少后端命令复杂度。
- 如果后续 allTasks 规模明显变大，再切到后端 `search_linkable_tasks`。

### P2.3 与任务创建流程的关系

第一版建议：

- 新建任务弹窗不急着支持引用其他任务。
- 用户创建任务后，在任务详情里添加引用。

原因：

- 附件在新建流程里有明确文件暂存需求，用户期望更强。
- 任务引用在详情里添加更自然，能降低创建弹窗复杂度。
- 不引入抽屉式 UI，也不让新建弹窗变得过重。

### P2 验收标准

- 任务详情能添加、展示、打开、删除引用任务。
- 搜索候选不包含当前任务。
- 搜索候选不出现已删除任务。
- 点击引用项后当前详情切到被引用任务。
- 详情关闭 / 重新打开后引用列表仍正确。
- `pnpm build` 和 `pnpm lint` 通过。

## P3：同步、备份、真实环境联调

目标：确认附件和任务引用在完整使用链路里都能闭环。

### P3.1 附件同步联调

场景：

1. 设备 A 给任务添加托管附件。
2. 设备 A 执行同步。
3. 设备 B 执行同步。
4. 设备 B 的任务详情能看到附件。
5. 设备 B 能打开下载后的托管附件。

重点检查：

- 上传顺序：附件 blob 先于 metadata 上传。
- 加密同步：远端不能出现附件明文。
- hash mismatch 时本地状态应变成 failed / missing，而不是写入坏文件。
- localReference 不上传本机文件内容。

### P3.2 备份恢复联调

场景：

1. 创建带托管附件的任务。
2. 执行备份。
3. 恢复到新数据库或临时环境。
4. 任务详情能看到附件并打开。

补充：

- localReference 不复制文件内容，恢复后只保留路径记录或根据策略不导入路径；当前更推荐“不跨机器承诺可用”。
- webLink 恢复后应正常打开链接。

### P3.3 任务引用联调

场景：

1. 任务 A 引用任务 B。
2. 执行同步。
3. 另一设备可见 A -> B 引用。
4. 删除引用后再次同步，另一设备引用消失。
5. 备份恢复后引用仍存在。

### P3.4 回归检查

必须覆盖：

- 新建任务弹窗仍是弹窗，没有变成抽屉。
- 修改任务仍走当前任务详情面板，没有新增列表抽屉。
- 已有列表、看板、日历、月视图、周视图任务点击逻辑不受影响。
- 批量模式不被附件拖拽误触。
- 移动端 / Android 构建至少不因桌面专用 API 直接失败；桌面拖拽代码要用 `isTauri()` 和平台能力保护。

## 4. 推荐实施顺序

1. **先做 P0 附件入口**  
   用户最核心的“添加文件”会真正可用，而且底层已经完成，收益最高、风险相对可控。

2. **再做 P1 任务引用底层**  
   先把数据、同步、备份打牢，避免只做 UI 造成后续迁移返工。

3. **接 P2 任务引用 UI**  
   放到任务详情里，不做抽屉式改造。

4. **最后做 P3 联调与发布前验收**  
   重点验证跨设备同步、备份恢复和安装包实际可用。

## 5. 发布建议

建议拆成两个发布节奏：

### 版本 A：附件入口补全

包含：

- 任务详情附件区。
- 新建普通任务带附件。
- 拖拽文件。
- 文件选择按钮。
- 打开 / 定位 / 删除附件。
- webLink 添加入口。

适合作为 `v2.5.5` 或下一个补丁版本发布。

### 版本 B：任务引用

包含：

- `task_links` schema。
- 任务引用 service / command / sync / backup。
- 任务详情引用区。

如果 P1/P2 体量较大，建议作为 `v2.6.0` 发布，避免把 schema 变更和附件 UI 收尾都压进一个补丁版本。

## 6. 风险与注意事项

- **文件路径隐私**：localReference 只应保存在本机，不应进入跨设备附件 blob 同步；导出时也不要暴露完整本机路径。
- **Android 文件选择**：桌面路径和 Android content URI 不是一回事，移动端如果要支持真实文件导入，需要单独验证 Tauri dialog 插件返回值是否能被当前 Rust 文件接口处理。
- **大文件体验**：100MB 限制已有，但前端需要给出明确提示，避免用户误以为卡住。
- **循环任务附件继承**：不要默认让循环规则复制附件到每个实例，容易造成重复大文件；需要单独设计。
- **同步顺序**：任务引用依赖任务先存在，远端 apply 顺序必须明确。
- **抽屉式 UI**：明确排除，不作为本轮方案范围，也不要在实现中顺手改造。

## 7. 最小完成定义

这轮收尾完成时，至少要满足：

- issue #7 的附件部分从“底层已做”变成“用户能在任务详情 / 新建普通任务里实际使用”。
- 用户能清楚选择“复制文件”还是“引用本机路径”。
- 托管附件能同步、备份、恢复；本机引用不伪装成跨设备可用。
- 任务详情支持添加和打开被引用任务。
- 不实现抽屉式新增 / 修改任务。
- 通过相关构建、lint、Rust 测试，并留下桌面端拖拽截图或验证记录。
