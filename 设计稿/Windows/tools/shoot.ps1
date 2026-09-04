# shoot.ps1 — 用本机 Headless Chromium 批量截设计稿（零依赖，需先 node tools/serve.mjs 5181）
# 用法：pwsh tools/shoot.ps1
param(
  [int]$Port = 5181,
  [string]$OutDir = (Join-Path $PSScriptRoot "..\.tmp\shots"),
  [int]$W = 1600,
  [int]$H = 960
)

$candidates = @(
  "$env:LOCALAPPDATA\ms-playwright\chromium-1237\chrome-win64\chrome.exe",
  "$env:LOCALAPPDATA\ms-playwright\chromium-1234\chrome-win64\chrome.exe"
)
$chrome = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { throw "未找到 Headless Chromium，请修改 shoot.ps1 中的路径" }

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$OutDir = (Resolve-Path $OutDir).Path

$routes = @(
  @{ name = "01-today";   hash = "#/view/today" },
  @{ name = "02-board";   hash = "#/view/all?layout=board" },
  @{ name = "03-month";   hash = "#/view/today?layout=month" },
  @{ name = "04-week";    hash = "#/view/planned?layout=week" },
  @{ name = "05-overdue"; hash = "#/view/overdue" },
  @{ name = "06-list";    hash = "#/list/list-work" },
  @{ name = "07-search";  hash = "#/search" },
  @{ name = "08-rules";   hash = "#/recurring" },
  @{ name = "09-trash";   hash = "#/view/deleted" },
  @{ name = "10-mini";    hash = "#/mini" },
  @{ name = "11-widget";  hash = "#/widget" }
)

foreach ($r in $routes) {
  $out = Join-Path $OutDir "$($r.name).png"
  $url = "http://localhost:$Port/$($r.hash)"
  $args = @(
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-sandbox",
    "--window-size=$W,$H", "--virtual-time-budget=2500",
    "--screenshot=$out", $url
  )
  Start-Process -FilePath $chrome -ArgumentList $args -Wait -WindowStyle Hidden
  Write-Host "shot -> $out"
}
