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

| 参数 | 值 | 理由 |
| --- | --- | --- |
| `panic` | `"abort"` | 去掉 unwinding 元数据，减小体积 |
| `codegen-units` | `4` | ¹ 提高编译并行度、分散内存压力（`1` 会把压力堆到 LTO 阶段） |
| `lto` | `"thin"` | thin-LTO 内存峰值远低于 fat-LTO(`true`)，体积仍显著小于无 LTO |
| `opt-level` | `"s"` | 优化体积(`3` 是速度，`"z"` 更激进但编译更慢) |
| `strip` | `true` | 去除符号，显著减小产物 |

平衡点：**牺牲约 5–15% 的体积，换取编译峰值内存下降和稳定跑完**。在 16GB 机器上，默认 Tauri 的 `codegen-units=1` + `lto=true` 容易把内存吃满导致 OOM 或被杀。

## 4. 并行度：显式限制 cargo jobs，压低内存峰值

构建时显式传入 `-j`，不要把 12 核跑满：

```bash
pnpm tauri build -- -j 4
```

- `-j 4`：限制**最多 4 个 rustc 并行**。每个 rustc release 进程峰值可达 1–2GB；4 个同时跑把编译期占用压在可接受范围，保留余量给前端构建（Vite/Rollup）和系统。
- 若机器比本规则假设的更吃力（如 8GB），把 `-j 4` 降到 `-j 2`，并改 `codegen-units = 2`。
- 不要同时运行 `pnpm dev` / 浏览器 / 大型 IDE 的繁重索引，先释放内存。

## 5. 构建命令（完整）

```bash
# 切到项目目录
cd /f/Torder

# 低内存模式打包（NSIS 单 exe），限制并行度
pnpm tauri build -- -j 4
```

构建分两步：`pnpm build`（Vite 前端，较快）→ `cargo tauri build`（Rust + 打包，较慢、内存重）。

## 6. 产物落到桌面

构建成功后，安装包自动定位并复制到桌面：

```bash
# 产物路径（首次为单架构子目录）
SRC=$(ls -d src-tauri/target/release/bundle/nsis/*/torder_*_x64_*.exe 2>/dev/null | head -n1)

# 落到桌面，文件名带版本号便于区分
DEST="/c/Users/Administrator/Desktop/$(basename "$SRC")"
cp -f "$SRC" "$DEST"

echo "安装包已落到桌面：$DEST"
ls -lh "$DEST"
```

- 桌面路径：`/c/Users/Administrator/Desktop`。
- 若 NSIS 产物路径随 Tauri 版本变化（架构目录名可能不同），用上述 glob 自动定位；不要硬编码中间目录名。

## 7. 验证（最低限度）

部署前必做：

1. **文件可落地**：`ls -lh` 确认桌面 `.exe` 存在、大小合理（通常 5–30MB，含 WebView2 引导）。
2. **校验产物**：`file` 或右键属性确认为合法 PE 安装包，非空文件或错误页。
3. （可选）在干净环境或当前桌面双击，确认安装→启动→主界面正常。

不强制做完整安装/卸载回归——见 README 当前阶段说明；但**打包当天**至少双击跑一遍能启动。

## 8. 何时可以偏离本规则

- 发布候选 / 正式对外发行版：可回归 `codegen-units=1` + `lto=true` + 真机内存充足时追求最小体积；但保留本 RULE 为**开发期默认**。
- 换了高内存构建服务器：`-j` 可按核心数放宽，但 profile 参数保留。
- 需要 MSI/其他格式：本规则以 NSIS 为准，其他格式单独立项。

---

**本规则一句话总结**：低内存机 → NSIS 单 exe + thin-LTO + codegen-units=4 + `-j 4` + 产物落桌面。
