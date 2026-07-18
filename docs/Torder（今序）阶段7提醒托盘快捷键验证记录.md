# Torder（今序）阶段 7 提醒、托盘、快捷键验证记录

## 1. 验证结论

阶段 7 已完成应用运行期间提醒、过期提醒补发、一次性提醒状态、稍后 10 分钟、应用内提醒、托盘驻留和应用内快捷键。浏览器交互验证使用内存任务，Tauri 隔离验证使用独立标识 `com.zhaxideler.torder.stage7`，未向正式数据库写入测试任务。

Windows 桌面版通知已接入 `@tauri-apps/plugin-notification` 的原生发送路径。未安装开发程序没有注册开始菜单应用身份，本机实测会执行提醒扫描并写入 `reminded_at`，但 Windows 不展示系统 Toast；安装态可见性列为阶段 8 安装包的阻塞验收项。Tauri 2 通知插件的桌面端不提供 `onAction` 回调，因此 Windows 第一版通过应用内提醒的“查看任务”定位任务，未伪造系统通知点击能力。

## 2. 实现范围

- `src-tauri/src/db/task_repository.rs`
  - 查询到期且未提醒的未完成任务
  - 写入 `reminded_at` 防止重复
  - 稍后提醒重设 `remind_at` 并清空 `reminded_at`
- `src-tauri/src/commands/task.rs`
  - `list_due_reminders`
  - `mark_task_reminded`
  - `snooze_task_reminder`
- `src/services/reminderService.ts`
  - Tauri 命令与浏览器内存回退
  - 通知权限检查和官方通知发送
  - 浏览器提醒状态更新
- `src/components/reminder/ReminderToast.tsx`
  - 应用内提醒、查看任务、稍后 10 分钟和关闭操作
- `src-tauri/src/tray.rs`
  - 关闭窗口隐藏到托盘
  - 左键恢复窗口
  - 打开、快速新建、退出菜单
- `src/app/App.tsx`
  - 启动后 400ms 首次扫描，每 30 秒继续扫描
  - 提醒队列与重复保护
  - `Ctrl+N`、`Ctrl+F`、`Ctrl+,`、`Esc`
  - 今日快速创建应用默认提醒提前量

## 3. 自动检查

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

- Prettier、ESLint、TypeScript、Vite 构建全部通过
- Rust 编译检查通过
- Rust 测试 `5 passed; 0 failed`
- 新增测试覆盖过期提醒、未来提醒、已完成任务排除、提醒后不重复、稍后提醒和非法分钟数

## 4. Playwright 交互验证

Playwright 使用 `pnpm dlx @playwright/cli@latest`，页面数据来自浏览器内存，不连接正式 SQLite。

已验证：

- 过期提醒启动后自动进入应用内提醒队列
- “查看任务”切换至全部任务并打开对应详情
- “10 分钟后提醒”关闭当前提醒，任务提醒时间更新为当前时间后 10 分钟
- 默认提前 15 分钟创建的今日任务，截止时间为 `23:59`，提醒时间为 `23:44`
- `Ctrl+N` 聚焦快速创建输入框
- `Ctrl+F` 聚焦搜索输入框
- `Ctrl+,` 打开设置页
- `Esc` 关闭任务详情、标签对话框和应用内提醒
- 深色主题提醒样式正常
- 600px 视口 `scrollWidth = innerWidth = 600`
- 浏览器控制台 `0 error`、`0 warning`

## 5. Tauri 实机验证

已验证：

- 正式 Tauri 窗口启动并保持响应
- 关闭窗口后窗口隐藏，进程继续运行
- 左键托盘图标恢复并聚焦主窗口
- 托盘菜单包含“打开 Torder”“快速新建任务”“退出”
- 托盘“快速新建任务”恢复窗口后，快速创建输入框获得键盘焦点
- 托盘“退出”使 Torder 进程正常结束
- 修复了 Windows 桌面端误用移动端通知动作监听导致的 `notification.registerListener not allowed` 启动错误
- 隔离数据库到期提醒被扫描，`reminded_at` 正常写入，应用内提醒正常展示

待阶段 8 安装态复验：

- Windows 系统 Toast 可见性
- 安装后系统通知点击行为；若插件桌面端仍不提供回调，保持应用内“查看任务”为明确入口

## 6. 验证截图

- `output/playwright/阶段7-任务提醒.png`
- `output/playwright/阶段7-快捷键设置.png`
- `output/playwright/阶段7-深色提醒.png`
- `output/playwright/阶段7-窄窗口.png`
- 托盘菜单已在 Tauri 实机环境完成本地验证（截图不纳入公开仓库）

## 7. 阶段边界

- 未实现托盘今日数量：方案标注为技术条件允许时的可选项，不阻塞 MVP
- 未实现全局快捷键：阶段 0 冻结边界不包含全局唤起，避免提前引入权限和冲突处理
- 第一版提醒要求应用正在运行；应用退出后不会后台定时唤醒
