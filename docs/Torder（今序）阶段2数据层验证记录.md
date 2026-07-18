# Torder（今序）阶段 2 数据层验证记录

## 实现范围

- SQLite 数据库自动初始化
- `schema_migrations` 版本迁移机制
- `tasks`、`lists`、`tags`、`task_tags`、`settings` 核心表
- 任务状态、优先级、外键和唯一性约束
- 任务状态、截止时间、清单、提醒时间和标签关联索引
- 默认清单：收件箱、工作、生活
- 任务、清单、标签、设置 Repository
- Tauri command 和前端 TypeScript service/type
- 任务软删除、完成时间和提醒状态预留

## 数据库信息

- 数据库引擎：SQLite（`rusqlite`，bundled）
- 当前 schema 版本：1
- 实际数据文件：`C:\Users\Administrator\AppData\Roaming\com.zhaxideler.torder\torder.sqlite`
- 连接配置：foreign keys、WAL、NORMAL synchronous、5 秒 busy timeout
- 数据库文件首次启动后大小：77824 bytes

## 自动验证

Rust 数据层测试覆盖：

1. 首次初始化和 schema v1 迁移。
2. 自动创建 `inbox`、`work`、`life` 三个默认清单。
3. 创建任务并清理标题首尾空白。
4. 更新任务为完成状态并写入 `completed_at`。
5. 创建标签并更新 `task_tags` 关联。
6. 软删除任务，普通读取返回 not found。
7. 保存 JSON 设置值。
8. 关闭并重新初始化同一个数据库文件后，任务和设置仍然存在。

验证结果：1 passed，0 failed。

## 验证命令

```powershell
pnpm format:check
pnpm lint
pnpm build
cargo fmt --manifest-path .\src-tauri\Cargo.toml --check
cargo check --manifest-path .\src-tauri\Cargo.toml
cargo test --manifest-path .\src-tauri\Cargo.toml
pnpm tauri dev
```

## 实机验证

- Playwright 打开阶段 2 页面和工程信息弹窗：通过。
- 浏览器控制台：0 error。
- 600px 视口：无横向溢出。
- 第一次桌面启动：`torder.exe` 正常打开，数据库文件创建成功。
- 第二次桌面启动：沿用同一数据库文件，窗口正常打开，文件大小和修改时间保持一致。
- 验证截图：`output/playwright/阶段2-数据层.png`。

## 后续边界

- 阶段 3 使用现有 Repository 和 command 实现任务核心功能，不直接操作 SQLite。
- 智能视图查询和冻结版排序规则在阶段 3 接入。
- 搜索、组合筛选、清单和标签管理界面留在阶段 5。
