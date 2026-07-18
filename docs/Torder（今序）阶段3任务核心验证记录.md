# Torder（今序）阶段 3 任务核心验证记录

## 实现范围

- 任务创建、读取、完整编辑和软删除
- 标记完成与取消完成
- 完成时间自动写入和取消完成时清空
- 今日、全部未完成、已完成、过期四个智能视图
- 冻结版默认排序规则
- Tauri command、前端 task service 和 Zustand task store
- 标签关联命令保持可用

## 智能视图规则

- 今日：过期未完成任务，以及本地时区今天到期的未完成任务
- 全部：所有未完成且未软删除的任务
- 已完成：所有已完成且未软删除的任务，按完成时间倒序
- 过期：截止时间早于当前时间的未完成任务

## 默认排序

1. 过期未完成任务
2. 今天到期任务
3. 有提醒时间任务
4. 紧急优先级任务
5. 优先级倒序
6. 手动排序值
7. 创建时间倒序

## 自动测试

Rust 测试覆盖：

1. 数据库迁移、默认清单和重启持久化。
2. 创建任务并读取完整字段。
3. 更新任务并写入完成时间。
4. 取消完成并清空完成时间。
5. 软删除后普通查询不可见。
6. 标签与任务关联。
7. 今日、全部、已完成、过期视图结果。
8. 过期、今日、提醒、紧急任务的排序优先级。
9. 本地自然日转换为 UTC 后仍正确进入今日视图。

验证结果：2 passed，0 failed。

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

## UI 与桌面验证

- Playwright 打开阶段 3 页面和工程信息弹窗：通过。
- 浏览器控制台：0 error。
- 600px 视口：`scrollWidth = innerWidth = 600`。
- 桌面进程：`torder.exe`。
- 窗口标题：`Torder（今序）`。
- 正式 SQLite 文件存在并可正常初始化。
- 验证截图：`output/playwright/阶段3-任务核心.png`。

## 下一阶段边界

- 阶段 4 将现有 task store 和 service 接入正式桌面 UI。
- 主界面布局、任务详情抽屉、空状态、加载状态、错误提示和删除确认均留在阶段 4。
- 搜索、组合筛选以及清单和标签管理界面继续留在阶段 5。
