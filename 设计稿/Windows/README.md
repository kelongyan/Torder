# Torder（今序）· Windows 桌面端 UI 设计稿

纯静态（HTML + CSS + 原生 ESM JavaScript，**零框架、零构建、零 npm 依赖**）的 Windows 桌面端 UI 渲染稿，
用于在重构真实 Tauri 桌面端之前确定信息架构、视觉语言与交互骨架。风格令牌与组件语言与
[`../phone/`](../phone/) 移动端设计稿保持一致（同一套 Dracula 令牌、同一套 mock 数据语义），
但本稿是**桌面功能全集**：自定义标题栏、可折叠侧栏、五种布局、拖拽手柄语义、命令面板、
迷你速记窗、桌面便签、8 Tab 设置等手机端剔除的能力在此全部保留。

> 这是**设计稿**，不连接 SQLite / Rust / WebDAV；所有数据来自 `js/data/mock.js` 的内存演示数据，
> 刷新即复位。查询语义（系统视图、排序、优先级、看板分列）镜像真实前端 `taskQuery.ts`，保证看到的
> 结构与真实产品一致。

## 启动方式

ESM 模块在 `file://` 下会被浏览器 CORS 拦截，**必须通过 HTTP 打开**。任选一种：

```powershell
# 仓库自带的零依赖静态服务器（默认 5181 端口，避免与手机稿 5180 冲突）
node tools/serve.mjs 5181
# 然后浏览器访问 http://localhost:5181/

# 或任意静态服务器，例如：
npx serve .
```

左侧 `showcase-nav` 是**开发导览面板（非产品 UI）**：系统视图 / 清单标签 / 五种布局 / 全部弹层 /
两个独立窗口 / 主题与强调色切换，点击即可逐屏走查。

### URL 速查

| 路径 | 内容 |
| --- | --- |
| `#/today` `#/view/:view` | 8 个系统视图：all/today/planned/overdue/no-date/important/completed/deleted |
| `#/list/:id` | 清单视图（list-work / list-life / list-study / list-home） |
| `#/tag/:标签` | 标签视图 |
| `#/search` | 全库搜索 |
| `#/recurring` | 循环任务规则 |
| `#/mini` | 迷你速记窗（独立窗口 mock 舞台） |
| `#/widget` | 桌面便签（独立窗口 mock 舞台） |

布局可在当前视图内用查询参数切换：`#/view/today?layout=list|board|agenda|month|week`。

走查参数（设计稿专用）：`?theme=light|dark`、`?accent=violet|blue|teal|green|amber|rose`、
`?font=small|standard|large`，例如 `?theme=light&accent=green#/view/today`。

快捷键（与真实产品对齐）：`Ctrl K` 命令面板、`Ctrl N` 新建、`Ctrl B` 折叠侧栏、`,` 切换排序方向、
`Ctrl Shift M` 迷你速记窗。

## 目录结构（模块化拆分，单文件职责单一）

```
Windows/
├─ index.html               # 唯一页面：挂 6 个 CSS + main.js，含 #showcase / #app 两个挂载点
├─ css/
│  ├─ tokens.css            # 设计令牌：颜色/间距/字号/层级/尺寸（深/浅双主题、6 强调色、3 字号）
│  ├─ base.css              # reset、排版、通用工具语义类、滚动条
│  ├─ shell.css             # 窗口骨架：自定义标题栏、侧栏（248/折叠64）、主区、详情抽屉、showcase
│  ├─ components.css        # 组件：按钮/输入/分段/开关/弹层/菜单/看板列/进度环…
│  ├─ task.css              # 任务行、分组卡片、时间轴、优先级条、复选圈
│  └─ views.css             # 各视图与独立窗：月历/周历/搜索/循环/迷你窗/便签
├─ js/
│  ├─ main.js               # 入口：路由↔store 同步、showcase 导览构建、走查查询参数
│  ├─ app.js                # 装配：ctx 方法集、订阅合帧整体重渲染、快捷键、主窗/独立窗分流
│  ├─ core/                 # 与框架无关的底层
│  │  ├─ dom.js             # h() 虚拟节点辅助（数值样式自动补 px、SVG 白名单、XSS 转义边界）
│  │  ├─ icons.js           # 图标入口；icons.generated.js 由工具从 lucide 抽取（108 枚，勿手改）
│  │  ├─ format.js          # 日期/相对时间/ overdue 判定
│  │  ├─ store.js           # 唯一状态源：mock 装载、查询语义（镜像 taskQuery.ts）、变更与统计
│  │  ├─ router.js          # hash 路由（主窗/mini/widget 三模式）
│  │  ├─ modal.js           # openDialog/openPopover/openContextMenu/openConfirm/openCommand
│  │  └─ toast.js
│  ├─ data/
│  │  ├─ enums.js           # 权威枚举：8 系统视图、5 布局、4 排序、看板列、提醒、8 清单色、8 设置 Tab…
│  │  └─ mock.js            # 演示数据（与 phone 稿共用同一份语义：4 清单 / 26 任务 / 3 规则 / 3 日历事件）
│  ├─ components/           # 主窗结构件
│  │  ├─ titleBar.js        # 自定义标题栏（拖拽区语义、最小化/最大化/关闭=隐藏到托盘 mock）
│  │  ├─ sidebar.js         # 侧栏：系统导航+计数、清单/标签、保存视图、同步状态；可折叠 64px
│  │  ├─ header.js          # 主工具条：标题、5 布局分段（滑动拇指）、排序/筛选/全局动作/新建
│  │  ├─ taskRow.js         # 任务行：拖拽手柄、复选圈、优先级条、meta、悬停操作、右键菜单
│  │  ├─ detailDrawer.js    # 右侧 384px 任务详情抽屉
│  │  ├─ common.js          # 分组卡片、空态、进度环、快速创建、小节标题
│  │  └─ menus.js           # 排序/筛选/视图更多/清单选择/任务右键菜单
│  └─ views/                # 视图与弹层，每个文件可独立阅读
│     ├─ listView.js        # 列表：今日时间轴（现在时刻红线）、逾期红卡、清单分组、回收站
│     ├─ boardView.js       # 看板三列：待处理(中低优先,蓝)/进行中(高优先,红)/已完成(绿)
│     ├─ monthView.js       # 月历 6×7：任务圆点 + 日历事件色带 + 选中日任务面板
│     ├─ weekView.js        # 周视图：7 天 × 时网格，任务块按时间定位
│     ├─ agendaView.js      # 日程（日历事件列表）
│     ├─ searchView.js      # 全库搜索（标题/备注/标签，常用标签）
│     ├─ recurringView.js   # 循环规则卡片
│     ├─ taskDialog.js      # 新建/编辑任务（优先级 chips、清单/日期/提醒/循环/标签）
│     ├─ settingsDialog.js  # 设置 8 Tab：常规/外观/默认值/提醒通知/WebDAV/数据备份/快捷键/关于
│     ├─ focusDialog.js     # 专注模式（真实走秒的 SVG 倒计时环）
│     ├─ reviewDialog.js    # 每日回顾
│     ├─ statsDialog.js     # 统计概览（7 日柱状等）
│     ├─ commandPalette.js  # Ctrl K 命令面板（分组、模糊过滤、键盘上下选择）
│     ├─ miniWindow.js      # 迷你速记窗（独立 Tauri 窗 mock：自然语言速记、失焦隐藏语义）
│     └─ noteWidget.js      # 桌面便签（纸张主题、八向缩放手柄、置顶/钉住 mock）
└─ tools/
   ├─ serve.mjs             # 零依赖静态文件服务器
   ├─ extract-icons.mjs     # 从 node_modules/lucide-react 抽取图标路径生成 icons.generated.js
   └─ shoot.ps1             # headless Chromium 批量截图走查脚本（产出 .tmp/shots/）
```

## 与手机稿（`../phone/`）的关系

- **共享**：`mock.js` 数据语义、Dracula 设计令牌语言、`dom.js`/`format.js` 等 core 写法、组件视觉基调。
- **桌面独有（本稿保留，手机稿刻意剔除）**：
  自定义无边框标题栏与窗口控制、侧栏及折叠、看板/月历/周视图/日程全部五种布局、
  任务行拖拽排序手柄与右键上下文菜单、命令面板、迷你速记窗、桌面便签 widget、
  批量选择、WebDAV 同步状态与设置、开机自启/最小化到托盘/系统通知等桌面偏好。
- **响应式差异**：桌面为「侧栏 + 主区 + 详情抽屉」三栏结构；手机为底部导航 + 页面栈，不在本稿范围。

## 重构真实端时的对照锚点

- 结构件对照 `src/components/layout/WindowTitleBar.tsx` `Sidebar.tsx` `MainHeader.tsx`；
- 五种布局对照 `src/components/task/TaskListView.tsx` `TaskBoard.tsx` `TaskCalendar.tsx`
  `MonthCalendar.tsx` `WeekCalendar.tsx`；
- 详情对照 `src/components/detail/TaskDetailPanel.tsx`；
- 设置对照 `src/components/dialog/SettingsDialog.tsx`；独立窗对照 `src/app/MiniApp.tsx` 与 Widget 体系；
- 查询语义以真实 `src/services/taskQuery.ts` 为准，本稿 `store.js` 为其可读镜像。

## 维护约定

- 语义化 class，不使用 Tailwind 工具类；主题只走 `tokens.css` 的 CSS 变量（`data-theme` /
  `data-accent` / `data-font-size` 挂在 `<html>`）。
- 新增枚举值同步 `data/enums.js` 与消费侧；新增图标先在 `tools/extract-icons.mjs` 的 `ICON_NAMES`
  补名，再 `node tools/extract-icons.mjs` 重新生成，不要手改 `icons.generated.js`。
- 用户可见文本一律走 `text`/转义通道，不用未转义 `html` 拼接。
- 修改后自检：`Get-ChildItem -Recurse -Filter *.js | ForEach-Object { node --check $_.FullName }`。
