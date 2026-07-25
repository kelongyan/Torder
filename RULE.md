# Torder 开发与设计标准规范（RULE.md）

> 本规则为 Torder 桌面应用界面设计、交互动效与 Windows 打包构建的默认约定。所有后续 UI 开发与修改默认全量遵循此标准。

---

## 🎨 第一部分：UI 视觉设计系统与交互规范（默认标准）

### 1. 色彩与主题模式规范 (Theme Standards)

* **深色模式 (Dark Mode)**：
  * **主背景 (`--bg-primary`)**：深邃沉静的冷暗调 `#0e1017`。
  * **侧边栏与卡片 (`--bg-secondary`)**：高雅阶梯色 `#161822`。
  * **组件底座 (`--bg-tertiary`)**：温润层次色 `#1f2230`。
  * **品牌 Accent**：高雅靛蓝 `#6366f1`（Indigo），Hover 呈现柔发光 `#818cf8`。
* **浅色模式 (Light Mode)**：
  * **主背景 (`--bg-primary`)**：通透清爽的雪白底色 `#f8fafc`。
  * **侧边栏与卡片 (`--bg-secondary`)**：洁净纯白 `#ffffff`。
  * **组件底座 (`--bg-tertiary`)**：灰蓝软底 `#f1f5f9`。
  * **文字分级**：主字 Crisp Slate 900 (`#0f172a`)，次字 Slate 600 (`#475569`)，弱字 Slate 400 (`#94a3b8`)。

### 2. 边缘与发光视效规范 (Borders & Specular Highlights)

* **半透明淡墨边框**：全站禁止使用僵硬的硬灰色实线，统一采用基于半透明度 `rgba(255, 255, 255, 0.08)` (深色) 或 `rgba(15, 23, 42, 0.08)` (浅色) 的半透明线条。
* **顶部 1px 精细高光 (Specular Highlight)**：所有悬浮卡片、输入框、气泡弹窗顶部统一保留 `inset 0 1px 0 rgba(255, 255, 255, 0.08)` 的极细微高光。
* **双重弥散阴影 (Layered Ambient Shadows)**：悬浮元素统一使用双重弥散软阴影，避免死板混沌。

### 3. 输入框与折叠拉伸动画 (Inputs & Expanded Interactions)

* **获焦光晕**：输入框获焦 (`:focus` / `:focus-within`) 统一带有 Accent 环形外发光圈 (`0 0 0 3px color-mix(...)`) 与沉浸内阴影。
* **展开式输入框交互**：复杂录入组件（如快捷新建任务框）默认保持单行紧凑折叠态，点击或获得焦点时平滑向下拉伸展开属性 Chips，且需对属性按钮添加 `onMouseDown` 防失焦保护。

### 4. 按钮、软胶囊与下拉菜单 (Buttons & Segmented Controls)

* **分段软胶囊 (Segmented Control)**：顶部布局/视图切换统一采用胶囊分段组件，包含专属 Lucide 图标 + 文本。
* **图标按钮动效**：深浅色切换、更多设置等 `.icon-button` 在 Hover 时带有旋转（45°/360°）、放大与 Accent 柔光发光的悬浮反馈。
* **毛玻璃与 Click Outside**：下拉菜单一律使用 `backdrop-filter: blur(16px)` 毛玻璃，且**必须挂载全局 Click Outside 监听**，点击外部或选中选项后自动平滑收起。

### 5. 弹窗规范 (Dialog Standards)

* **统一容器框架**：所有弹窗组件必须 100% 继承全局 `<DialogShell>` 框架与 `<DialogFooter>` 按钮组件，严禁自写缺乏 Padding 或脱离 Theme Token 的裸 HTML 结构。
* **色盘 Picker 规范**：调色盘点 (`color-picker-dot`) 必须带有对应色彩的 Glow 发光圈与弹性缩放反馈。

---

## 📦 第二部分：打包与构建规则

### 1. 目标：为 16GB 低内存开发机产出最小可行安装包

* 开发机仅有 **16GB 内存 / 12 核**，编译期峰值内存严控，宁可二进制稍大不能 OOM。
* 产物必须是**单文件可分发的 Windows 安装包**，构建完成后自动覆盖复制到桌面。

### 2. 安装包格式：NSIS（单 .exe）

* `tauri.conf.json` → `bundle.targets = "nsis"`。
* NSIS 产物为单个 `.exe` 安装包，体积小、构建内存开销低。

### 3. Cargo 构建 profile

```toml
[profile.release]
panic = "abort"
codegen-units = 16
lto = false
opt-level = "s"
strip = true
```

### 4. 并行度限制与构建命令

```powershell
Set-Location F:\Torder
$env:CARGO_HOME = "D:\cargo"
$env:RUSTUP_HOME = "D:\rustup"
$env:PATH = "D:\cargo\bin;C:\Program Files (x86)\NSIS;$env:PATH"
$env:CARGO_BUILD_JOBS = "4"
pnpm tauri build
```

---

**一句话总结**：跟随 Slate-Charcoal & Pure Snow 设计系统 + 1px 细微高光 + 动态展开输入框 + 胶囊分段 Tab + NSIS 单文件打包落桌面。
