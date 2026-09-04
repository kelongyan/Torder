# shoot.ps1 — 用本机 Playwright 自带 Chromium 对设计稿各路由批量截图（验证用）
# 前置：先启动 node tools/serve.mjs；用法：pwsh tools/shoot.ps1
param(
  [int]$Port = 5180,
  [string]$OutDir = "$PSScriptRoot/../.tmp-shots"
)
$chromeCandidates = @(
  "$env:USERPROFILE\AppData\Local\ms-playwright\chromium-1237\chrome-win64\chrome.exe",
  "$env:USERPROFILE\AppData\Local\ms-playwright\chromium-1234\chrome-win64\chrome.exe"
)
$chrome = $chromeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { throw "未找到 Chromium，请改用浏览器手动预览" }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$routes = @(
  @{ name = "01-today"; path = "/#/today" },
  @{ name = "02-browse"; path = "/#/browse" },
  @{ name = "03-calendar"; path = "/#/calendar" },
  @{ name = "04-me"; path = "/#/me" },
  @{ name = "05-view-overdue"; path = "/#/view/overdue" },
  @{ name = "07-new"; path = "/#/new" },
  @{ name = "08-search"; path = "/#/search" },
  @{ name = "09-recurring"; path = "/#/recurring" },
  @{ name = "10-focus"; path = "/#/focus" },
  @{ name = "11-review"; path = "/#/review" },
  @{ name = "12-view-deleted"; path = "/#/view/deleted" },
  @{ name = "13-view-completed"; path = "/#/view/completed" },
  @{ name = "14-list-work"; path = "/#/list/list-work" }
)

foreach ($r in $routes) {
  $url = "http://localhost:$Port$($r.path)"
  $out = Join-Path $OutDir "$($r.name).png"
  $args = @(
    "--headless=new","--disable-gpu","--hide-scrollbars","--no-sandbox",
    "--window-size=1280,940","--virtual-time-budget=2500",
    "--screenshot=$out", $url
  )
  Start-Process -FilePath $chrome -ArgumentList $args -Wait -WindowStyle Hidden
  Write-Output "shot: $($r.name)"
}
