# 打包规则（RULE）

> 本规则为 Torder Windows 安装包构建的默认约定。执行任何 `pnpm tauri build` 前，先按此规则检查。

## 1. 目标：为低内存开发机产出最小可行安装包

- 开发机仅有 **16GB 内存 / 12 核**，编译期峰值内存必须严控，宁可二进制稍大也不能 OOM。
- 产物必须是**单文件可分发的 Windows 安装包**，放在桌面，方便龙哥直接双击安装/分发。

## 2. 安装包格式：NSIS（单 .exe）

- `tauri.conf.json` → `bundle.targets = "nsis"`（不是 `msi`、不是 `all`）。
- 原因：NSIS 产物是单个 `.exe` 安装包，体积小、构建内存开销低；MSI（WiX）和冷启动内存更高。
- NSIS 依赖：系统需安装 NSIS（`winget install NSIS.NSID`），并确保 `makensis.exe` 在 PATH 内。

## 3. Rust 构建 profile：低内存优先，体积其次

`src-tauri/Cargo.toml` 的 `[profile.release]` 采用**低内存参数**，不做最大体积压缩：

| 参数            | 值        | 理由                                           |
| --------------- | --------- | ---------------------------------------------- |
| `panic`         | `"abort"` | 去掉 unwinding 元数据，减小体积                |
| `codegen-units` | `16`      | 拆分代码生成单元，避免单个优化任务占用过多内存 |
| `lto`           | `false`   | 完全关闭 LTO，优先降低链接阶段的内存峰值       |
| `opt-level`     | `"s"`     | 优化体积(`3` 是速度，`"z"` 更激进但编译更慢)   |
| `strip`         | `true`    | 去除符号，显著减小产物                         |

另外保留两项 Windows 专用降内存设置：

- `[profile.release.package.windows] opt-level = 0`：避免庞大的 Windows API 绑定进入高强度优化。
- `src-tauri/.cargo/config.toml` 中的 `windows_raw_dylib`：改用运行时 DLL 导入，降低 `windows` crate 的编译压力。

这组参数已在当前 16GB Windows 开发机上完成实机打包。平衡点是：**适度增大二进制，换取编译稳定性**；不要在普通开发构建中随意恢复 `codegen-units=1` 或开启 LTO。

## 4. 并行度：显式限制 cargo jobs，压低内存峰值

构建时通过 Cargo 环境变量限制并行度，不要把 12 核跑满：

```powershell
$env:CARGO_BUILD_JOBS = "4"
pnpm tauri build
```

- `CARGO_BUILD_JOBS=4`：限制**最多 4 个 rustc 并行**，给前端构建和系统保留内存。
- 当前 pnpm 版本下，不要使用 `pnpm tauri build -- -j 4`；该写法会丢失参数分隔符并触发 `unexpected argument '-j'`。
- 若机器比本规则假设的更吃力（如 8GB），把 `CARGO_BUILD_JOBS` 降到 `2`。
- 不要同时运行 `pnpm dev` / 浏览器 / 大型 IDE 的繁重索引，先释放内存。

## 5. 构建命令（完整）

```powershell
# 切到项目目录
Set-Location F:\Torder

# 本机 Rust/NSIS 未进入 PATH 时，临时补齐；不修改系统环境变量
$env:CARGO_HOME = "D:\cargo"
$env:RUSTUP_HOME = "D:\rustup"
$env:PATH = "D:\cargo\bin;C:\Program Files (x86)\NSIS;$env:PATH"

# 低内存模式打包（NSIS 单 exe），限制并行度
$env:CARGO_BUILD_JOBS = "4"
pnpm tauri build
```

构建分两步：`pnpm build`（Vite 前端，较快）→ `cargo tauri build`（Rust + 打包，较慢、内存重）。

## 6. 产物落到桌面

构建成功后，安装包自动定位并复制到桌面：

```powershell
$src = Get-ChildItem "src-tauri\target\release\bundle\nsis\*_x64-setup.exe" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $src) { throw "未找到 NSIS 安装包" }

$desktop = [Environment]::GetFolderPath("Desktop")
$dest = Join-Path $desktop $src.Name
Copy-Item -LiteralPath $src.FullName -Destination $dest -Force
Get-Item -LiteralPath $dest
```

- 桌面路径通过系统 API 获取，不硬编码用户名或 OneDrive 状态。
- 若 NSIS 产物命名发生变化，仍从 `src-tauri/target/release/bundle/nsis/` 中按最新修改时间定位。

## 7. 验证（最低限度）

部署前必做：

1. **文件可落地**：`Get-Item` 确认桌面 `.exe` 存在、大小合理（通常 5–30MB，含 WebView2 引导）。
2. **校验产物**：检查文件头为 `MZ`，并使用 `Get-FileHash -Algorithm SHA256` 记录校验值。
3. （可选）在干净环境或当前桌面双击，确认安装→启动→主界面正常。

---

**本规则一句话总结**：低内存机 → NSIS 单 exe + 关闭 LTO + codegen-units=16 + Cargo 4 并发 + 产物落桌面。
