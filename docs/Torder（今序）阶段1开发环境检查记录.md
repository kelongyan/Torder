# Torder（今序）阶段 1 开发环境检查记录

## 环境信息

| 项目 | 检测结果 | 状态 |
| --- | --- | --- |
| 操作系统 | Windows | 通过 |
| Node.js | v25.2.1 | 可用，建议后续统一到 Node.js 24 LTS |
| pnpm | 11.1.3 | 通过 |
| rustc | 1.96.0 | 通过 |
| Cargo | 1.96.0 | 通过 |
| Visual Studio Build Tools | 2022，已安装 VC x86/x64 工具 | 通过 |
| WebView2 Runtime | 150.0.4078.65 | 通过 |

## 工程配置

- 桌面框架：Tauri 2
- 前端：React 19 + TypeScript + Vite
- 样式：Tailwind CSS 4
- 状态管理：Zustand
- UI 基础组件：Radix UI Dialog
- 图标：lucide-react
- 代码检查：ESLint
- 格式化：Prettier
- 包管理：pnpm，不使用 npm
- pnpm 构建脚本白名单：仅允许 `esbuild`

## 验证记录

| 验证项 | 命令或方式 | 结果 |
| --- | --- | --- |
| 依赖安装 | `pnpm install` | 通过 |
| 前端检查 | `pnpm lint` | 通过 |
| 前端构建 | `pnpm build` | 通过，1848 modules transformed |
| Rust 格式 | `cargo fmt --check` | 通过 |
| Rust 编译检查 | `cargo check` | 通过 |
| 浏览器 UI | Playwright 打开首页并操作工程信息弹窗 | 通过，控制台无错误 |
| 窄窗口布局 | Playwright 600px 视口检查 | 通过，无横向溢出 |
| 桌面开发启动 | `pnpm tauri dev` | 通过 |
| 桌面窗口标题 | Windows 进程窗口检测 | `Torder（今序）` |

## 产物

- 基础工程：项目根目录、`src/`、`src-tauri/`
- 前端基础截图：`output/playwright/阶段1-基础工程.png`
- pnpm 锁文件：`pnpm-lock.yaml`
- Tauri/Cargo 锁文件：`src-tauri/Cargo.lock`

## 注意事项

- 当前 Node.js v25.2.1 可以完成安装、构建和开发启动，但它不是 LTS 版本。进入 CI 或发布阶段前建议统一到 Node.js 24 LTS。
- SQLite 和 Repository 将在阶段 2 接入；阶段 1 页面仅用于验证工程地基，不代表最终产品 UI。
