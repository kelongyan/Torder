#Requires -Version 7.0
<#
  build-windows.ps1 — Torder Windows 安装包一键打包（16GB 低内存机规则）

  用法:
    pwsh scripts/build-windows.ps1                  # 打包 + 校验 + 清理旧版安装包
    pwsh scripts/build-windows.ps1 -CopyToDesktop   # 同上，额外复制最新安装包到桌面
    pwsh scripts/build-windows.ps1 -KeepAll         # 打包后保留全部历史安装包

  规则来源: 根目录 RULE.md
#>
[CmdletBinding()]
param(
  [switch]$CopyToDesktop,
  [switch]$KeepAll
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# 1. 本机工具链路径（不修改系统环境变量，仅作用于当前进程）
$env:CARGO_HOME = "D:\cargo"
$env:RUSTUP_HOME = "D:\rustup"
$env:PATH = "D:\cargo\bin;C:\Program Files (x86)\NSIS;$env:PATH"
$env:CARGO_BUILD_JOBS = "4"

# 2. 前置检查
if (-not (Get-Command makensis.exe -ErrorAction SilentlyContinue)) {
  throw "makensis.exe 不在 PATH。请安装 NSIS（winget install NSIS.NSID）或确认安装路径。"
}

# 3. 构建（tauri.conf.json 的 beforeBuildCommand 会自动跑 pnpm build，无需手动前置）
Write-Host "[build] pnpm tauri build (CARGO_BUILD_JOBS=4)..." -ForegroundColor Cyan
pnpm tauri build
if ($LASTEXITCODE -ne 0) { throw "pnpm tauri build 失败 (exit $LASTEXITCODE)" }

# 4. 定位最新安装包
$bundleDir = Join-Path $root "src-tauri\target\release\bundle\nsis"
$setup = Get-ChildItem (Join-Path $bundleDir "*_x64-setup.exe") |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $setup) { throw "未在 $bundleDir 找到 NSIS 安装包" }

# 5. 校验：PE 文件头 (MZ) + SHA256
$head = [System.IO.File]::ReadAllBytes($setup.FullName)
if ($head.Length -lt 2 -or [Text.Encoding]::ASCII.GetString($head, 0, 2) -ne "MZ") {
  throw "文件头校验失败：$($setup.Name) 不是合法的 PE 文件"
}
$sha = (Get-FileHash -Algorithm SHA256 $setup.FullName).Hash
Write-Host "[ok] $($setup.Name)  $([math]::Round($setup.Length / 1MB, 1)) MB" -ForegroundColor Green
Write-Host "[ok] SHA256: $sha" -ForegroundColor Green

# 6. 清理旧版本（可再生成，默认只留最新）
if (-not $KeepAll) {
  Get-ChildItem (Join-Path $bundleDir "*_x64-setup.exe") |
    Where-Object { $_.FullName -ne $setup.FullName } |
    ForEach-Object {
      Remove-Item -LiteralPath $_.FullName -Force
      Write-Host "[del] 旧版本: $($_.Name)" -ForegroundColor Yellow
    }
}

# 7. 复制到桌面
if ($CopyToDesktop) {
  $desktop = [Environment]::GetFolderPath("Desktop")
  $dest = Join-Path $desktop $setup.Name
  Copy-Item -LiteralPath $setup.FullName -Destination $dest -Force
  Write-Host "[ok] 已复制到桌面: $dest" -ForegroundColor Green
} else {
  Write-Host "[ok] 产物位置: $($setup.FullName)" -ForegroundColor Green
}
