# Torder（今序）阶段 5 搜索筛选标签验证记录

## 1. 验证结论

- 阶段状态：已完成
- 验证日期：2026-07-18
- 验证人：小y（Codex）
- 结论：搜索、组合筛选、标签管理和任务标签关联均通过自动检查与 UI 回归，可进入阶段 6

## 2. 已实现范围

- 搜索任务标题、备注、清单名称和标签名称
- 通过智能视图区分未完成、已完成、今日和过期状态
- 按今天、过期、未来 7 天、无截止日期筛选
- 按优先级、清单和标签多选筛选
- 清空全部搜索与筛选条件
- 标签创建、编辑和删除
- 为任务添加和移除标签
- 搜索与筛选无结果空状态
- 查询请求序号保护，避免快速输入时旧响应覆盖新结果

组合规则：不同筛选维度使用 `AND`；同一维度内的多选项使用 `OR`。关键词中的 SQLite `LIKE` 通配符会转义。

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

- Prettier 检查通过
- ESLint 检查通过
- TypeScript 与 Vite 生产构建通过
- Rust 格式和编译检查通过
- Rust 自动测试：`3 passed / 0 failed`
- 1000 条任务查询满足自动测试中的 `< 300ms` 阈值

Rust 测试覆盖：

- 标题、备注、清单名称和标签名称搜索
- 日期、优先级、清单和标签组合筛选
- 同维度多选 `OR` 与跨维度 `AND`
- 1000 条任务的简单性能验证
- 原有数据库迁移、CRUD、智能视图、排序和完成流转回归

## 4. Playwright UI 回归

浏览器预览使用内存数据，不写入正式 SQLite。已验证：

1. 输入关键词后列表在 250ms 防抖后实时更新
2. 搜索标签名称可以找到关联任务
3. 日期、优先级、清单和标签可组合筛选
4. 清空筛选后恢复当前智能视图默认列表
5. 标签可以创建、重命名和二次确认删除
6. 任务详情可添加和移除标签，保存后筛选结果同步更新
7. 删除正在参与筛选的标签后，筛选条件会自动清理
8. 无匹配结果时显示专用空状态
9. 浏览器控制台错误数为 0
10. 600px 窄窗口下 `innerWidth`、文档 `scrollWidth` 和 `bodyScrollWidth` 均为 `600`

截图：

- `output/playwright/阶段5-搜索筛选.png`
- `output/playwright/阶段5-标签管理.png`
- `output/playwright/阶段5-窄窗口.png`

## 5. 桌面实机验证

执行：

```powershell
pnpm tauri dev
```

结果：

- Vite 开发服务正常监听 `127.0.0.1:1420`
- 桌面进程正常启动，窗口标题为 `Torder（今序）`
- Torder 进程处于响应状态
- 正式 Tauri 端继续通过 Repository 和 Tauri command 访问 SQLite
- 未向正式数据库写入 Playwright 测试数据

## 6. 阶段交接

阶段 6 可以复用当前 service、Repository 和 Zustand 分层实现设置、主题与导入导出。导入功能应先完成格式校验和冲突策略，再写入数据库；不要让前端直接操作 SQLite。
