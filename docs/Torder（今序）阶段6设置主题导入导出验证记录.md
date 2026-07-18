# Torder（今序）阶段 6 设置主题导入导出验证记录

## 1. 验证结论

- 阶段状态：已完成
- 验证日期：2026-07-18
- 验证人：小y（Codex）
- 结论：设置持久化、主题切换、开机启动和完整 JSON 导入导出均通过自动检查与 UI 回归，可进入阶段 7

## 2. 已实现范围

- 设置页导航和响应式布局
- 跟随系统、浅色、深色主题即时切换
- 主题和默认设置写入 SQLite `settings` 表
- 启动默认视图设置
- 默认提醒提前量设置
- Windows 开机启动开关
- 数据库位置、schema 版本、任务数和清单数展示
- 应用名称、版本和平台展示
- 原生 JSON 保存与打开文件对话框
- 完整数据导出、导入预检、整体替换确认和事务恢复
- 导出成功、导入失败、恢复成功状态反馈

本阶段新增官方 Tauri 插件：

- `@tauri-apps/plugin-dialog` / `tauri-plugin-dialog`
- `@tauri-apps/plugin-autostart` / `tauri-plugin-autostart`

## 3. 设置与主题规则

数据库迁移升级至 schema v2，并初始化：

- `theme`：`"system"`
- `defaultView`：`"today"`
- `defaultReminderMinutes`：`null`
- `launchAtStartup`：`false`

主题通过根节点 `.dark` 类和 Tailwind dark variant 生效；选择“跟随系统”时监听 `prefers-color-scheme` 变化。

## 4. JSON 备份格式

顶层结构：

```json
{
  "app": "Torder",
  "version": "0.1.0",
  "formatVersion": 1,
  "exportedAt": "2026-07-18T00:00:00.000Z",
  "data": {
    "tasks": [],
    "lists": [],
    "tags": [],
    "taskTags": [],
    "settings": []
  }
}
```

导出文件名格式：`Torder-backup-YYYY-MM-DD-HHmmss.json`。

导入前检查：

- 应用标识和格式版本
- 顶层及五类数据数组结构
- 任务、清单、标签和设置的 ID、名称及唯一性
- 任务状态和优先级范围
- 必需的 `inbox` 清单
- 任务到清单、任务标签到任务和标签的引用完整性
- 重复任务标签关联
- 设置值是否为合法 JSON

V1.0 冲突策略为“确认后整体恢复”，不做记录级合并。恢复过程在单个 SQLite 事务中执行，任何错误都会回滚并保留原数据。

## 5. 自动检查

执行命令：

```powershell
pnpm format:check
pnpm lint
pnpm build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

结果：

- Prettier、ESLint、TypeScript 和 Vite 构建通过
- Rust 格式和编译检查通过
- Rust 自动测试：`4 passed / 0 failed`
- 自动测试验证完整导出、恢复任务/标签关联/设置及非法备份不改变现有数据

## 6. Playwright UI 回归

浏览器预览使用内存数据，不写入正式 SQLite。已验证：

1. 设置入口在桌面和移动布局均可访问
2. 三种主题可切换，深色主题根节点状态为 `class="dark"`
3. 默认视图、默认提醒时间和开机启动设置即时保存
4. 导出触发真实 JSON 下载，包含 4 条任务、3 个清单、2 个标签、2 条关联和 4 项设置
5. 缺少收件箱的非法备份显示错误，不进入确认步骤
6. 合法备份显示任务、清单、标签数量和整体替换提示
7. 确认后恢复 1 条任务、1 个标签及关联，并应用备份中的主题和默认视图
8. 浏览器控制台错误数为 0
9. 600px 窄窗口下 `innerWidth`、文档 `scrollWidth` 和 `bodyScrollWidth` 均为 `600`

截图：

- `output/playwright/阶段6-设置页.png`
- `output/playwright/阶段6-深色主题.png`
- `output/playwright/阶段6-导入确认.png`
- `output/playwright/阶段6-窄窗口.png`

## 7. 桌面实机验证

执行：

```powershell
pnpm tauri dev
```

结果：

- 桌面窗口标题为 `Torder（今序）`
- Torder 进程正常响应
- Vite 开发服务正常监听 `127.0.0.1:1420`
- 正式数据库迁移至 schema v2
- 正式数据库已初始化四项默认设置
- 未向正式数据库写入 Playwright 测试任务

## 8. 阶段交接

阶段 7 可通过 `loadAppSettings()` 读取 `defaultReminderMinutes`，并继续复用现有 Repository、Tauri command 和错误反馈结构。提醒触发后应更新 `reminded_at`，避免重复通知；开机启动已经由官方插件接通，不需要重新实现。
