# Torder（今序）阶段 4 主界面验证记录

## 实现范围

- 桌面应用整体布局
- 今日、全部任务、已完成、过期四个智能视图导航
- 快速创建任务
- 任务列表项和状态元信息
- 任务完成与取消完成
- 右侧任务详情抽屉
- 标题、备注、清单、优先级、截止时间和提醒时间编辑
- 删除任务二次确认
- 空状态、加载状态和错误提示
- 浅色主题及基础响应式布局
- `Ctrl+N` 聚焦快速创建，`Esc` 关闭详情抽屉

## 数据连接方式

- Tauri 桌面端：通过 task service、Zustand store 和 Tauri command 访问真实 SQLite。
- 浏览器预览：使用仅存在于浏览器进程内的内存数据，便于 Playwright 验证；不会写入正式数据库。
- 前端组件不直接访问 SQLite。

## Playwright 验证流程

1. 默认进入今日视图并显示过期及今天到期任务。
2. 在快速输入框按 Enter 创建任务。
3. 打开新任务的详情抽屉。
4. 编辑标题、备注、清单和优先级并保存。
5. 再次打开详情后按 Esc 关闭。
6. 标记任务完成，任务从今日视图移除。
7. 切换到已完成视图，确认任务出现。
8. 打开任务详情，点击删除并进行二次确认。
9. 切换到过期视图，完成最后一条过期任务并确认空状态。
10. 在过期视图按 `Ctrl+N`，确认自动切换到今日并聚焦输入框。
11. 将视口缩小到 600px，确认没有横向溢出。

验证结果：全部通过，浏览器控制台 0 error。

## 构建与桌面验证

```powershell
pnpm format:check
pnpm lint
pnpm build
cargo fmt --manifest-path .\src-tauri\Cargo.toml --check
cargo check --manifest-path .\src-tauri\Cargo.toml
cargo test --manifest-path .\src-tauri\Cargo.toml
pnpm tauri dev
```

- 桌面进程：`torder.exe`
- 窗口标题：`Torder（今序）`
- 进程响应状态：正常
- SQLite 文件：存在并正常连接

## 截图

- `output/playwright/阶段4-主界面.png`
- `output/playwright/阶段4-任务详情.png`
- `output/playwright/阶段4-窄窗口.png`

## 后续边界

- 搜索、组合筛选、标签管理和清单管理留在阶段 5。
- 设置、主题切换和导入导出留在阶段 6。
- 托盘、通知和更多快捷键留在阶段 7。
