#Requires -Version 7.0
<#
  sync-to-gitee.ps1 — 把代码与 Release 同步到 Gitee（gitee.com/yankelong/Torder）

  GitHub 是唯一源仓库，Gitee 是发布镜像；本脚本单向同步，不要在 Gitee 上直接改代码。

  用法:
    pwsh scripts/sync-to-gitee.ps1 -CodeOnly
      # 只推送 main/dev/v3 + 全部 tags（日常代码同步）
    pwsh scripts/sync-to-gitee.ps1 -Tag v2.7.6 -Assets "src-tauri\target\release\bundle\nsis\Torder_2.7.6_x64-setup.exe","torder-2.7.6-universal.apk" -NotesFile notes.md
      # 推代码 + 创建/复用 Gitee Release + 上传附件（自动生成同名 .sha256 sidecar）

  令牌: 明文存放于仓库根 `.gitee-token`（已在 .gitignore，绝不提交公开仓库）。
  规则来源: RULE.md §10/§11
#>
[CmdletBinding()]
param(
  [string]$Tag,
  [string[]]$Assets = @(),
  [string]$NotesFile,
  [switch]$CodeOnly
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$tokenPath = Join-Path $root ".gitee-token"
if (-not (Test-Path $tokenPath)) { throw "缺少 $tokenPath（Gitee 个人令牌，明文本地存放）" }
$token = (Get-Content $tokenPath -Raw).Trim()
$api = "https://gitee.com/api/v5/repos/yankelong/Torder"
$pushUrl = "https://oauth2:$token@gitee.com/yankelong/Torder.git"

# 1. 代码与 tags 同步（gh-pages 是 GitHub Pages 专用分支，Gitee Pages 已停服，不同步）
Write-Host "[sync] 推送 main/dev/v3 + 全部 tags ..." -ForegroundColor Cyan
git push $pushUrl refs/heads/main:refs/heads/main refs/heads/dev:refs/heads/dev refs/heads/v3:refs/heads/v3 --tags
if ($LASTEXITCODE -ne 0) { throw "git push 失败 (exit $LASTEXITCODE)" }
Write-Host "[ok] 代码与 tags 已同步" -ForegroundColor Green
if ($CodeOnly) { exit 0 }

if (-not $Tag) { throw "需要 -Tag（如 v2.7.6）" }
if ($Assets.Count -eq 0) { throw "需要 -Assets（至少一个安装包）" }

# 2. 定位或创建 Release（tag 必须已随 git 同步存在）
$releases = & curl.exe -sS --max-time 30 "$api/releases?access_token=$token&per_page=100" | ConvertFrom-Json
$release = $releases | Where-Object { $_.tag_name -eq $Tag } | Select-Object -First 1

if ($release) {
  Write-Host "[sync] Release $Tag 已存在 (id $($release.id))，复用" -ForegroundColor Cyan
} else {
  $tags = & curl.exe -sS --max-time 30 "$api/tags?access_token=$token" | ConvertFrom-Json
  $tagSha = ($tags | Where-Object { $_.name -eq $Tag } | Select-Object -First 1).commit.sha
  if (-not $tagSha) { throw "Gitee 上不存在 tag $Tag（git push --tags 后再试）" }

  $bodyArgs = @("-F", "access_token=$token", "-F", "tag_name=$Tag", "-F", "target_commitish=$tagSha", "-F", "name=Torder（今序）$Tag", "-F", "prerelease=false")
  if ($NotesFile) {
    if (-not (Test-Path $NotesFile)) { throw "NotesFile 不存在: $NotesFile" }
    $bodyArgs += "-F"; $bodyArgs += "body=<$NotesFile;type=text/plain;charset=utf-8"
  } else {
    $bodyArgs += "-F"; $bodyArgs += "body=Torder（今序）$Tag"
  }
  $created = & curl.exe -sS --max-time 60 -X POST "$api/releases" @bodyArgs | ConvertFrom-Json
  if (-not $created.id) { throw "创建 Release 失败: $($created | ConvertTo-Json -Depth 3)" }
  $release = $created
  Write-Host "[ok] Release $Tag 已创建 (id $($release.id))" -ForegroundColor Green
}

# 3. 上传附件 + 自动生成 .sha256 sidecar（更新器完整性校验依赖它）
foreach ($asset in $Assets) {
  $resolved = Resolve-Path $asset
  $name = Split-Path $resolved -Leaf
  $hash = (Get-FileHash -Algorithm SHA256 $resolved).Hash.ToLower()
  $sidecar = Join-Path $env:TEMP "$name.sha256"
  "$hash  $name" | Set-Content -NoNewline -Encoding ascii $sidecar

  Write-Host "[upload] $name ($([math]::Round((Get-Item $resolved).Length / 1MB, 1)) MB) ..." -ForegroundColor Cyan
  $uploaded = & curl.exe -sS --max-time 900 -X POST "$api/releases/$($release.id)/attach_files" -F "access_token=$token" -F "file=@$resolved" | ConvertFrom-Json
  if (-not $uploaded.id) { throw "上传 $name 失败: $($uploaded | ConvertTo-Json -Depth 3)" }
  Write-Host "[upload] $name.sha256 ..." -ForegroundColor Cyan
  $uploadedSidecar = & curl.exe -sS --max-time 60 -X POST "$api/releases/$($release.id)/attach_files" -F "access_token=$token" -F "file=@$sidecar" | ConvertFrom-Json
  if (-not $uploadedSidecar.id) { throw "上传 $name.sha256 失败: $($uploadedSidecar | ConvertTo-Json -Depth 3)" }
  Write-Host "[ok] $name + .sha256 已上传" -ForegroundColor Green
}

# 4. 打印最终下载地址（latest.json 与发布说明引用它）
$final = & curl.exe -sS --max-time 30 "$api/releases/$($release.id)?access_token=$token" | ConvertFrom-Json
Write-Host "[done] $Tag 附件清单:" -ForegroundColor Green
$final.assets | ForEach-Object { Write-Host "  $($_.browser_download_url)" }
Write-Host "提醒: latest.json 的 downloadUrl 需引用上面的 Gitee 地址（RULE.md §10）。" -ForegroundColor Yellow
