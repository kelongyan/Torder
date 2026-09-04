# Torder 今序 · 移动端 UI 设计稿

安卓端 UI **彻底重构**用的纯静态高保真设计稿：只用原生 HTML / CSS / JavaScript（ES Modules），
**无构建步骤、无 npm 依赖、无框架**，双击即可在浏览器里运行与点按。

> 目标不是把桌面版「压缩」到手机，而是按移动端的信息架构与手势习惯重新设计，
> 后续安卓端重构时，以本稿为交互与视觉基准。数据模型、枚举、查询语义均与主项目
> （React/Rust 侧）保持同名同义，方便逐屏对照实现。

---

## 1. 如何预览

### 方式 A：本地静态服务器（推荐，ES Module 要求 http 协议）

```powershell
node tools/serve.mjs        # 默认 http://localhost:5180/
# 或指定端口：node tools/serve.mjs 8080
```

### 方式 B：任意静态服务器

`python -m http.server`、`pnpm vite` 等均可，根目录指向本文件夹。

### 预览建议

- 桌面浏览器：页面居中渲染 390 × 844 的手机框（含模拟状态栏），窗口宽度 ≤ 760px 时自动铺满。
- DevTools 切换设备模拟（Pixel 7 / iPhone 尺寸）可查看真机铺满效果与安全区。
- 任务行支持**鼠标拖拽**模拟左右滑动（真机为触摸手势）。

### 批量自检截图（可选）

```powershell
node tools/serve.mjs                 # 先起服务
pwsh tools/shoot.ps1                 # 输出到 .tmp-shots/
```

---

## 2. 信息架构（IA）

### 底部 Tab：4 主 Tab + 中央 FAB

| Tab | 路由 | 职责 |
| --- | --- | --- |
| 今天 | `#/today` | 默认落地页：问候、今日节奏、逾期/时间轴/全天/已完成 |
| 浏览 | `#/browse` | 智能视图（8 系统视图）、我的清单、标签、工具入口 |
| ＋ FAB | `#/new` | 任意位置快速新建任务 |
| 日历 | `#/calendar` | 月历网格 + 选中日任务/日历事件 |
| 我的 | `#/me` | 外观、任务默认、通知、数据同步、工具、关于 |

### 页面栈（次级全屏页，右进左出）

| 路由 | 屏幕 |
| --- | --- |
| `#/view/:view` | 系统视图任务列表（all/today/planned/overdue/no-date/important/completed/deleted） |
| `#/list/:listId` | 清单任务列表（含清单色卡头） |
| `#/tag/:tag` | 标签筛选结果 |
| `#/task/:id` | 任务详情（桌面端是右侧抽屉，移动端改为全屏页 + 底部固定操作条） |
| `#/task/:id/edit`、`#/new` | 任务新建/编辑表单 |
| `#/search` | 全库搜索（桌面端命令面板的移动形态） |
| `#/recurring` | 循环规则列表 |
| `#/focus` | 专注模式（可运行的倒计时） |
| `#/review` | 每日回顾 |

### 浮层（全部为底部 Bottom Sheet / 居中 Dialog，不使用 hover 浮层）

排序、筛选、任务更多操作、清单选择、清单新建/编辑、提醒选择、主题/强调色、WebDAV 配置等。

---

## 3. 明确剔除的「桌面/Windows 专属」能力

这些在移动端**不做**，设计稿中也没有入口，重构时无需移植：

- 桌面便签（Widget）窗口及其全部外观个性化（纸张/字体/钉选/缩放手柄/桌面拖拽）
- 任务拖拽排序、看板/日历拖拽（移动端改为点选、长按 Action Sheet、滑动手势）
- 迷你速记窗、全局快捷键、命令面板（Ctrl K）、快捷键设置页
- 自定义窗口标题栏、Mica/透明窗口、托盘菜单、开机自启注册表项
- 看板（board）/周日历（week）等为宽屏设计的布局；移动端只保留**列表 + 月历**两种主形态
- 本地路径型附件（localReference）；移动端只保留 managed 同步附件与 webLink

移动端**保留**：循环任务、提醒、专注、每日回顾、日历事件、WebDAV 同步、备份/导入导出、标签、子任务。

---

## 4. 目录结构（模块化，单一职责）

```
设计稿/
├─ index.html               # 唯一入口，只负责骨架与样式装配顺序
├─ css/
│  ├─ tokens.css            # 设计令牌：颜色(双主题+6强调色)/字号/间距/圆角/触摸/安全区
│  ├─ base.css              # reset、排版、原子工具类
│  ├─ shell.css             # 预览舞台/页面栈转场/顶栏/Tab栏/FAB/Sheet/Toast
│  ├─ components.css        # 复用组件：按钮/开关/分段/卡片/设置行/表单项…
│  ├─ task.css              # 任务行、滑动动作、分组卡片、今日时间轴
│  └─ views.css             # 各屏幕专属样式
├─ js/
│  ├─ main.js               # 启动入口（唯一顶层副作用）
│  ├─ app.js                # 装配层：路由表、外壳挂载、store→视图刷新
│  ├─ core/                 # 与业务无关的基础设施
│  │  ├─ dom.js             # h() 元素构造、事件委托、转义
│  │  ├─ router.js          # 页面栈：push/back/tab/replace + 转场
│  │  ├─ store.js           # 单一数据源 + 查询语义（镜像 taskQuery.ts）
│  │  ├─ sheet.js           # Bottom Sheet / Dialog
│  │  ├─ gestures.js        # 任务行左右滑动手势
│  │  ├─ toast.js
│  │  ├─ format.js           # 日期语义，镜像 taskDates.ts
│  │  ├─ icons.js + icons.generated.js   # 内联 SVG（自动生成，勿手改）
│  ├─ data/
│  │  ├─ enums.js           # 枚举常量（镜像 constants/*.ts、types/database.ts）
│  │  └─ mock.js            # 按“今天”相对生成的演示数据（字段同 Task/TaskList…）
│  ├─ components/           # 跨视图复用组件
│  │  ├─ chrome.js          # 模拟状态栏 / 顶栏 / 底部 Tab
│  │  ├─ taskRow.js ├─ common.js ├─ sheets.js
│  └─ views/                # 一屏一文件：today/browse/taskList/calendar/
│                           # taskDetail/taskForm/search/recurring/focus/review/settings
└─ tools/
   ├─ serve.mjs             # 零依赖预览服务器
   ├─ extract-icons.mjs     # 从主项目 lucide-react 抽取 SVG 路径（可复现）
   └─ shoot.ps1             # 批量截图自检
```

**维护约定**

1. 颜色/尺寸只允许出现在 `tokens.css`，组件与视图只消费变量，不写裸色值。
2. 一屏一文件，超过通用复用度的结构下沉到 `components/`；视图之间不互相 import。
3. 所有用户文本经 `dom.esc()` 或 `h({text})` 输出，禁止字符串拼 HTML 插入未转义内容。
4. 新增图标：在 `tools/extract-icons.mjs` 的 `ICON_NAMES` 加名后重跑脚本。

---

## 5. 与主项目的语义对照（重构对接）

| 设计稿 | 主项目 |
| --- | --- |
| `data/enums.js` SYSTEM_VIEWS / PRIORITIES / REMINDER_OPTIONS / LIST_COLORS | `constants/taskConfig.ts`、`taskViews.ts`、`reminderConfig.ts`、`listConfig.ts` |
| `core/store.js` matchesView / queryTasks / buildCounts | `services/taskQuery.ts`、`utils/taskHelpers.ts` |
| `core/format.js` 日期标签 | `utils/taskDates.ts` |
| `data/mock.js` 字段 | `types/database.ts`（Task / TaskList / RecurringRule / CalendarEvent，camelCase） |
| `css/tokens.css` 颜色角色 | `styles/theme-tokens.css`（--text-1/--accent/--red… 同名映射） |
| 页面栈转场、滑动手势、Sheet | 安卓侧对应导航组件（建议 Navigation Compose / 自绘 WebView 转场均可对照） |

### 关键交互规格

- 触摸目标 ≥ 44px，FAB 56px；间距走 4px 栅格（`--sp-*`）。
- 任务行：**右滑完成（绿，露出左侧）/ 左滑删除（红，露出右侧）**，阈值 64px，动作区宽 80px；点击进详情；勾选圆钮即时完成；回收站中行内动作为 恢复 / 彻底删除。
- 页面转场 280ms `cubic-bezier(0.16,1,0.3,1)`；Sheet 320ms；触感用 `navigator.vibrate`（真机 HapticFeedback 对应）。
- 安全区：`env(safe-area-inset-*)` 已接入顶栏、Tab 栏、Sheet 与底部操作条。
- 深色为默认（与桌面 Dracula 基调一致），浅色与 6 个强调色可在「我的 → 外观」实时切换。

---

## 6. 已知边界（设计稿刻意不实现）

- 数据只存在于页面内存，「重置演示数据」可还原；不接 SQLite / Tauri IPC。
- 日期/时间选择使用浏览器原生控件（真机对应 Android 原生滚轮）。
- WebDAV、备份、导入导出等仅展示界面与说明，不发起真实请求。
