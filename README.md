<div align="center">
  <img src="./src/assets/torder-logo.png" width="116" alt="今序 Logo" />

  <h1>今序 · Torder</h1>

  <p><strong>把今天排好，让事情自然向前。</strong></p>
  <p>本地优先、暗色优先、轻量克制的 Windows 桌面待办应用。</p>

  <p>
    <img src="https://img.shields.io/badge/Release-v2.0.0-6366F1?style=flat-square" alt="Release v2.0.0" />
    <img src="https://img.shields.io/badge/Tauri-2-24C8DB?style=flat-square&logo=tauri&logoColor=white" alt="Tauri 2" />
    <img src="https://img.shields.io/badge/React-19-149ECA?style=flat-square&logo=react&logoColor=white" alt="React 19" />
    <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript 5" />
    <img src="https://img.shields.io/badge/Rust-Stable-000000?style=flat-square&logo=rust&logoColor=white" alt="Rust" />
    <img src="https://img.shields.io/badge/SQLite-Local--first-003B57?style=flat-square&logo=sqlite&logoColor=white" alt="SQLite" />
    <img src="https://img.shields.io/badge/pnpm-Only-F69220?style=flat-square&logo=pnpm&logoColor=white" alt="pnpm only" />
  </p>
</div>

<br />

<div align="center">
  <img src="./docs/assets/torder-preview.png" width="920" alt="今序 v2.0.0 宽屏首页" />
</div>

<br />

> 🌙 **v2.0.0 是一次以原型稿为准的 UI 与功能重构。** 今序现在更像一个安静的任务工作台：左侧整理入口，中间专注执行，右侧查看细节。没有账号、没有云同步，也没有多余的管理负担。

## ✨ v2.0.0 更新重点

| 方向 | 变化 |
| --- | --- |
| 🎨 视觉重构 | 暗色优先三栏工作台，整体从旧版绿色玻璃风格切换到深色靛蓝体系 |
| 🧭 导航重构 | 侧栏聚合搜索、系统视图、我的清单和新建清单入口 |
| ✅ 任务闭环 | 新建任务弹窗、右侧详情面板、编辑、完成、删除一条线打通 |
| 🗂️ 视图增强 | 支持列表、看板、日历三种布局 |
| 🔎 搜索优化 | 标题与描述实时过滤，关键词高亮 |
| 🧹 功能减法 | 移除标签、提醒、备份导入导出、独立设置页等原型外能力 |
| 🖥️ 桌面保留 | 保留 Tauri 托盘；托盘快速新建改为打开新建任务弹窗 |

## 🧩 核心能力

### 📝 任务管理

- 创建、编辑、完成、删除任务
- 任务标题、描述、优先级、所属清单、截止日期与具体时间
- 截止时间展示具体时刻，并提供今天、明天、逾期等辅助文案
- 右侧详情面板常驻展示选中任务，支持只读与编辑状态切换

### 🧭 视图与清单

- 系统视图：全部、今天、计划中、重要、已完成
- 默认清单：工作、个人、学习
- 支持创建自定义清单
- 侧栏 badge 展示各视图和清单的任务数量

### 🗂️ 多布局工作台

- 列表视图：时间线式任务列表，适合日常处理
- 看板视图：按待处理、进行中、已完成分列
- 日历视图：按截止日期分组，无日期任务进入未安排

### ⚡ 操作体验

- `Ctrl + N` 打开新建任务弹窗
- `?` 打开快捷键面板
- `B` 切换批量选择模式
- `Esc` 关闭弹窗、菜单、快捷键面板或退出编辑状态
- 更多菜单支持排序和显示/隐藏已完成

## 🛠️ 技术栈

| 层级 | 技术 |
| --- | --- |
| 桌面容器 | Tauri 2 |
| 前端 | React 19 · TypeScript · Vite |
| 状态管理 | Zustand |
| 样式 | Tailwind CSS 4 |
| 图标 | Lucide React |
| 本地能力 | Rust · SQLite · rusqlite |
| 桌面能力 | Tauri Tray · Window Vibrancy |
| 包管理 | pnpm only |

## 📁 项目结构

```text
Torder/
├─ src/                     # React 前端
│  ├─ app/                 # 应用编排、日期和视图规则
│  ├─ services/            # Tauri IPC 与浏览器预览服务
│  ├─ stores/              # Zustand 状态
│  └─ styles/              # 全局样式和设计令牌
├─ src-tauri/
│  ├─ src/                 # Rust 命令、Repository、数据库迁移、托盘能力
│  ├─ icons/               # 桌面与安装包图标
│  └─ capabilities/        # Tauri 权限配置
├─ docs/                   # 方案书、验证记录和预览图
└─ output/playwright/      # UI 回归截图
```

## 🚀 本地开发

### 环境要求

- Windows 10 / 11
- Node.js 20.19+ 或 22.12+
- pnpm
- Rust stable
- Visual Studio Build Tools，需包含 Desktop development with C++
- WebView2 Runtime

### 启动开发环境

```powershell
pnpm install
pnpm tauri dev
```

### 质量检查

```powershell
pnpm lint
pnpm build
cargo +stable-x86_64-pc-windows-msvc test --manifest-path src-tauri/Cargo.toml
```

### 低内存 Windows 打包

```powershell
$env:Path = 'D:\cargo\bin;' + $env:Path
$env:RUSTUP_TOOLCHAIN = 'stable-x86_64-pc-windows-msvc'
$env:CARGO_BUILD_JOBS = '4'
pnpm tauri build
```

生成的 NSIS 安装包位于：

```text
src-tauri/target/release/bundle/nsis/
```

## 🔐 数据与隐私

今序默认把任务数据保存在当前 Windows 用户目录：

```text
%APPDATA%\com.zhaxideler.torder\torder.sqlite
```

- 任务数据本地存储，不上传到远程服务器
- 应用不要求登录，不绑定账号体系
- v2.0.0 按原型稿移除了标签、提醒和备份导入导出入口
- 如需手动迁移数据，请先备份上面的 SQLite 数据库文件

## 📚 文档

- [产品需求简表](./docs/Torder（今序）产品需求简表.md)
- [MVP 功能清单](./docs/Torder（今序）MVP功能清单.md)
- [技术方案书](./docs/Torder（今序）技术方案书.md)
- [分阶段开发方案书](./docs/Torder（今序）分阶段开发方案书.md)
- [原型稿重构分阶段方案](./docs/Torder（今序）原型稿重构分阶段方案.md)

## 🏷️ 当前版本

- 版本：`v2.0.0 release`
- 平台：Windows x64
- 安装包：见 GitHub Releases
- 状态：原型稿重构主流程已完成，进入真实使用反馈阶段

---

<div align="center">
  <strong>今序</strong><br />
  <sub>Local tasks. Clear mind.</sub>
</div>
