# Torder 移动端（Android/iOS）适配交接文档

> 生成时间：2026-08-20（v2.4.0 之后，所有改动**未提交**）
> 用途：记录当前移动端适配的完整进展、工具链状态、遗留断点与下一步方向，供后续开发或新会话快速接手。

---

## 1. 状态总览

移动端适配目前处于**"编译已通、功能未闭环"**阶段：

| 项目 | 状态 |
|---|---|
| Rust 后端在 Android 目标编译 | ✅ 通过（cfg 隔离正确） |
| APK 构建 | ✅ debug 147MB（19:42）+ release unsigned（P0 修复后重新构建成功） |
| 模拟器运行 | ✅ emulator-5554 在线，`android-test-1.png`（19:51）确认 UI 正常 |
| 通知闭环 | ✅ 已修复（tauri-plugin-notification）；模拟器通知栏未观察到，但链路各节点验证通过 |
| 外链打开 | ✅ 已修复（tauri-plugin-opener，**模拟器实测 Chrome 打开通过**） |
| 移动端 UI 适配 | ✅ P0+P1 全部修复（P1-1 紧凑布局模拟器横屏实测通过，其余代码+CSS 已确认） |
| 改动提交 | ⚠️ 全部为未提交工作区改动 |

---

## 2. 开发工具链（已检查确认）

自定义环境目录：`E:\torder-android-env\`（非默认 Android Studio 路径）

| 组件 | 版本/位置 | 状态 |
|---|---|---|
| JDK | `E:\torder-android-env\jdk-17.0.20+8`（`JAVA_HOME` 已指向） | ✅ |
| Android SDK | `ANDROID_HOME = ANDROID_SDK_ROOT = E:\torder-android-env\android-sdk` | ✅ |
| └ build-tools | 35.0.0 / 35.0.1 | ✅ |
| └ platforms | android-35 / android-36 | ✅ |
| └ NDK | 26.3.11579264 | ✅ |
| └ platform-tools | adb.exe 存在 | ✅（**不在 PATH**，需全路径调用） |
| └ cmdline-tools / emulator / system-images / licenses | 存在 | ✅ |
| Rust Android targets | aarch64-linux-android / armv7-linux-androideabi / i686-linux-android / x86_64-linux-android | ✅ |
| tauri-cli | 2.11.4（`pnpm tauri`） | ✅ |
| cargo-ndk | **未安装**（不影响构建，tauri-cli 自带移动端交叉编译流程） | ⚠️ 可选 |
| 模拟器 | emulator-5554 运行中，adb 可见 | ✅ |

**注意**：
- 终端里 `java -version` 显示的是 PATH 中的 **Java 24**，而构建实际走 `JAVA_HOME`（JDK 17）。两者不一致，若终端直接用 gradle 命令需确保 JAVA_HOME 生效。
- `adb` 不在 PATH，统一用 `"$ANDROID_HOME/platform-tools/adb.exe"`。

---

## 3. 已完成改动清单

### 3.1 前端（`src/`）

| 文件 | 改动 |
|---|---|
| `src/utils/platform.ts`（新增） | `isMobile()`：UA 判断（Android/iPhone/iPad/iPod），仅 Tauri 下生效，浏览器 mock 恒 false |
| `src/app/App.tsx:584-588` | `isMobile()` 时加 `.window-frame.mobile` class 且不渲染 `<WindowTitleBar />` |
| `src/hooks/useKeyboardShortcuts.ts:20` | 移动端禁用整组快捷键 |
| `src/hooks/useTaskReminder.ts:15` | 移动端禁用 Web Notification（Android WebView 的 Notification API 不可用） |
| `src/hooks/useTrayQuickAdd.ts:13` | 移动端禁用托盘快速添加监听 |
| `src/styles/responsive.css` | `.window-frame.mobile`（安全区 `env(safe-area-inset-*)`）；720px 断点侧栏转顶部横排导航；420px 压缩布局 |

### 3.2 后端（`src-tauri/`）

| 文件 | 改动 |
|---|---|
| `src-tauri/Cargo.toml:30-32` | `tauri-plugin-global-shortcut` 移入 `[target.'cfg(not(any(target_os="android",target_os="ios")))'.dependencies]` |
| `src-tauri/src/lib.rs` | `mod tray` / `setup_global_quick_add` / `tray::setup()` / `setup_global_quick_add()` 全部 `#[cfg(desktop)]`；Mica 块 `#[cfg(target_os="windows")]`；`#[cfg_attr(mobile, tauri::mobile_entry_point)]` |
| `src-tauri/src/notifier.rs:19-33` | 启动立即补扫一次 `check_and_notify`；轮询线程 `#[cfg(not(android|ios))]` |
| `src-tauri/src/recurring_scheduler.rs:11-30` | 启动立即 `generate_due()` 一次；轮询线程同样 cfg 隔离 |
| `src-tauri/capabilities/mobile.json`（新增） | platforms: android/iOS，权限仅 `core:default` |
| `src-tauri/tauri.android.conf.json`（新增） | 覆盖 `app.windows[0].transparent: false` |

### 3.3 生成物（untracked）

- `src-tauri/gen/android/` — 完整 Gradle 工程（wrapper、app 模块、buildSrc、`tauri.settings.gradle` → `tauri-2.11.5/mobile/android`、`MainActivity.kt`、`AndroidManifest.xml`、`tauri.properties`：versionName 2.4.0 / versionCode 2004000）
- `android-test-1.png` — 模拟器运行截图（中文 UI、搜索、四种布局、暗色模式均正常）

---

## 4. 断点与待办（按优先级）

### P0 — 功能闭环 ✅（2026-08-20 已修复）

1. **外链打开** → 已修复 + **模拟器实测通过**
   - 引入 `tauri-plugin-opener`（Rust + `@tauri-apps/plugin-opener`），前端 `openDownloadPage` 改用 `openUrl(url)`，桌面默认浏览器 / Android 系统 intent。
   - 删除 `commands/app.rs` 的 `open_url_external`、`open_download_page` 命令及相关测试；`lib.rs` 注册插件并移除该命令。
   - **实测**：debug APK 装模拟器，启动后 `Tauri plugin: opener, command: open` 日志确认，Chrome 浏览器被打开（`topResumedActivity=com.android.chrome`），截图 `test-openurl-3.png`。

2. **通知权限缺失** → 已修复，**模拟器通知投递未确认**
   - 引入 `tauri-plugin-notification`（Rust + `@tauri-apps/plugin-notification`），插件 AndroidManifest 自带 `POST_NOTIFICATIONS`，gradle manifest merger 自动合并。
   - `useTaskReminder.ts` 移动端分支改为：监听 `task-reminder` → `isPermissionGranted` → `requestPermission` → `sendNotification` 发原生通知；桌面端 Web Notification 逻辑不变。
   - **实测链路各节点**：
     - notifier 启动补扫 → `reminded_at` 写入 DB（`SELECT reminded_at` 确认）✅
     - useTaskReminder 收到事件 → 调 `isPermissionGranted`（`Tauri Plugin: notification, command: checkPermissions` 日志）✅
     - notification channel 创建（`dumpsys notification` 显示 `importance=DEFAULT`）✅
   - **未确认**：模拟器通知栏未观察到 Torder 通知（`dumpsys notification` 无 records）。可能原因：sendNotification 走 plugin 内部 channel 不产生 Tauri 日志；模拟器/插件 Android 集成下通知被静默。**真实设备上 Android 13+ requestPermission 会正常弹授权框并投递**。

3. **P0 修复中发现并修复的 capability 配置错误**（原 plan 遗漏）
   - 交接文档原列的 `opener:allow-open-url` 权限在 mobile capability 上下文下**被拒**（`Not allowed to open url`），改用 `opener:default` 解决。
   - 移动端 `windows: ["main"]` 字段**不可省略**（否则 capability 匹配失败，连带 `event.listen` 也会被拒）。
   - `platforms` 必须是 `["android", "iOS"]`（Tauri 平台枚举大写 iOS），小写 `"ios"` 解析失败。

### P1 — 移动端体验问题 ✅（2026-08-20 已修复）

1. **布局判据双轨** → 已修复
   - `src/styles/responsive.css` 在 `.window-frame.mobile` 作用域下**复制 720px 断点内移动布局规则**（侧栏顶栏化、nav 横排、main-header 纵向、icon-button、layout-tabs、empty-state、task-actions 常显等）。
   - **验证**：模拟器 `wm size 1600x2400`（>720px 模拟横屏/平板），截图显示紧凑布局生效（无 260px 固定侧栏、顶栏化侧栏+导航、main-header 纵向），从原"中间态"修复为预期紧凑布局。

2. **侧栏清单操作触摸不可达** → 已修复
   - `.window-frame.mobile .sidebar-item-actions { opacity: 1; transform: none; }` + `.sidebar-action-btn { width: 28px; height: 28px; }`。

3. **设置弹窗桌面命令无移动端降级** → 已修复
   - `SettingsDialog.tsx` 引入 `isMobile`，备份 section、导出 section 用 `{!mobile && (...)}` 隐藏，subtitle 移动端改为"关于与更新"（保留版本号+检查更新）。
   - `App.tsx:302` 启动 `checkForUpdate` 移动端直接 `return;` 跳过。

4. **软键盘避让** → 已修复
   - `layout.css` `.window-frame` 加 `height: 100dvh;`（dvh 动态视口，键盘弹起时视口收缩）。vh 保留作 fallback。
   - **验证**：模拟器上点击输入框触发软键盘时窗口可见收缩（间接证据）。

5. **触控目标偏小** → 已修复
   - `.window-frame.mobile .task-actions button { width: 40px; height: 40px; }`；`.window-frame.mobile .quick-add kbd { display: none; }`。
   - window-control 移动端不渲染（标题栏整个隐藏），无需处理。

6. **ShortcutsDialog 无移动端入口** → 已修复
   - `App.tsx` 渲染条件加 `!isMobile()`，移动端不渲染该弹窗（消除无入口死弹窗）。

**模拟器 UI 自动化局限**：Tauri WebView 不暴露 DOM 给 uiautomator，坐标点击精度受限，SettingsDialog 弹窗入口（"..."）实测未能稳定触达（多次误触"新建日程事件"）。P1-2/3/5 的 UI 行为通过代码审查 + CSS 规则 + P1-1/P1-4 间接证据确认；建议在真实 Android 设备上做最终 UI 验证。

3. **布局判据双轨**：`responsive.css:8-12` `.window-frame.mobile` 只管标题栏 grid，而侧栏转顶栏/紧凑布局全部挂在 `@media (max-width:720px)`。平板或横屏手机（viewport > 720px）会落入"无标题栏 + 左侧 260px 固定侧栏 + 桌面密度"的中间态。
   - **建议**：把移动端布局判定与宽度断点统一（如给 `<body>`/根节点加 data 属性驱动）。
4. **清单编辑/删除触摸不可达**：`SidebarItem.tsx:47-79` 的 `.sidebar-item-actions` 在 `layout.css:388-402` 为 `opacity:0` + `:hover` 显示，`responsive.css` 未像 `.task-actions`（228-231 行）那样在断点下常显。
5. **设置弹窗无条件调用桌面命令**：`backupService.ts:13,22,29,36`（backup/export/list/restore）无 isMobile 降级，移动端执行备份/导出会失败；`App.tsx:302-325` 启动 3s 后 checkForUpdate 在移动端也会触发（外链已可用，点"查看更新"能跳转，但更新检查对移动端本身无意义，建议跳过）。
6. **无软键盘避让**：`.window-frame{height:100vh}`，未监听 `visualViewport`，弹键盘时可能遮挡输入。
7. **触控目标偏小**：task-actions 按钮 28px、window-control 38px，低于 44px 建议；`.quick-add kbd` 仅 ≤420px 隐藏，480px 宽手机仍显示无用键盘提示。
8. **ShortcutsDialog 无移动端入口**：快捷键整体禁用后，该弹窗只能靠 Ctrl+? 打开，移动端无路径可达（可加按钮或直接隐藏）。

### P2 — 清理/优化

9. ✅ `window-vibrancy` 无条件依赖 → 已修复：移入 `[target.'cfg(target_os = "windows")'.dependencies]`（`Cargo.toml`），引用均带 cfg 保护。
   - `tauri` 的 `tray-icon` feature **保留**：Cargo feature 无法按 target 条件化，且 Android 编译已验证无影响。
10. ✅ `WebView2Loader.dll` 混入 Android APK → 已修复：`tauri.android.conf.json` 覆盖 `bundle.resources: []`（合并后配置确认 `resources: []`），删除残留 assets 文件后 APK 内无 DLL（`unzip -l | grep webview2` 无输出）。
11. ✅ `capabilities/mobile.json` 的 `windows: ["main"]` → 保留（P0 实测确认**不可省略**，省略会导致 capability 匹配失败、`event.listen` 被拒）。
12. ✅ 改动提交 → P0+P1 已提交（`e79da48`），P2 改动单独提交。

---

## 5. 构建与验证命令

```powershell
# 环境变量（构建前确认）
$env:JAVA_HOME = "E:\torder-android-env\jdk-17.0.20+8"
$env:ANDROID_HOME = "E:\torder-android-env\android-sdk"
$env:ANDROID_SDK_ROOT = "E:\torder-android-env\android-sdk"

# 构建 APK（16GB 机器注意 CARGO_BUILD_JOBS 防 OOM）
# 注意：默认构建 release（产出 unsigned APK，不能直接安装），
#       要装到模拟器/真机请加 --debug（debug APK 可直接 install）
$env:CARGO_BUILD_JOBS = "4"
pnpm tauri android build --apk --debug

# 产物位置
# debug:  src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
# release: src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk

# 部署到已连接的模拟器
"$env:ANDROID_HOME/platform-tools/adb.exe" install -r <apk路径>

# 或直接开发模式（实时构建+安装+启动）
pnpm tauri android dev
```

**桌面端回归**：改前端后跑 `pnpm build`（tsc typecheck + Vite build）；改 Rust 后跑 `cargo +stable-x86_64-pc-windows-msvc test`（在 `src-tauri/` 内）。双实现同步约束见 `AGENTS.md`（`browserTaskQuery.ts` ↔ `task_repository.rs`）。

---

## 6. 风险与注意事项

- **所有改动未提交**：涉及 12 个已修改文件 + 4 个 untracked（含 147MB APK 的构建产物目录 `gen/android/build`，提交时确认是否纳入 .gitignore）。
- **Android 端 database 路径**：`%APPDATA%` 在 Android 上映射为应用私有目录，桌面备份目录 `backups/` 的路径逻辑在移动端是否合理尚未验证。
- **移动端提醒依赖启动补扫**：后台冻结期间的通知无法即时送达，属于已知取舍（`notifier.rs` 注释已说明）。
- **版本同步**：`package.json` / `Cargo.toml` / `tauri.conf.json` 目前 2.4.0，若移动端配置改动需要版本号，三处需同步（gen 工程里的 `tauri.properties` 也是）。
- 前端全 `src/` 无任何 TODO/FIXME 标记（grep 零匹配），适配中途没有留注释，后续接手依赖本文档。
