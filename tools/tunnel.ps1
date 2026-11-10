<#
 * 穿透后端（cloudflared 快速隧道）
 *
 * 双击项目根目录的「穿透后端.cmd」运行：把本机 http://127.0.0.1:3000 暴露成一个公网
 * https 地址。手机不在同一个 WiFi（甚至用 4G）也能连，用来绕开校园网的 AP 隔离。
 *
 * 注意：本文件必须保持「UTF-8 带 BOM」，否则 Windows PowerShell 5.1 会按 ANSI 读，中文乱码。
 #>

$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$port = 3000
$root = Split-Path -Parent $PSScriptRoot

# cloudflared 可能在哪：PATH / 项目根目录 / winget 装的默认位置
function Find-Cloudflared {
  $candidates = @()
  $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($cmd) { $candidates += $cmd.Source }
  $candidates += (Join-Path $root 'cloudflared.exe')
  $candidates += (Join-Path $env:ProgramFiles 'cloudflared\cloudflared.exe')
  if (${env:ProgramFiles(x86)}) { $candidates += (Join-Path ${env:ProgramFiles(x86)} 'cloudflared\cloudflared.exe') }
  if ($env:LOCALAPPDATA) { $candidates += (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\cloudflared.exe') }
  foreach ($c in $candidates) {
    if ($c -and (Test-Path -LiteralPath $c)) { return $c }
  }
  return ''
}

$exe = Find-Cloudflared
if ($exe -eq '') {
  Write-Host ''
  Write-Host '没找到 cloudflared，先把穿透工具装上（任选一种）：' -ForegroundColor Yellow
  Write-Host '  1) PowerShell 里执行： winget install --id Cloudflare.cloudflared'
  Write-Host '  2) 或去 https://github.com/cloudflare/cloudflared/releases'
  Write-Host '     下 cloudflared-windows-amd64.exe，改名成 cloudflared.exe，'
  Write-Host ('     放到项目根目录（' + $root + '），再双击本文件。')
  exit 1
}

# 顺手确认后端在本机跑着，否则穿透出去也是个空地址
$backendUp = $false
try {
  $r = Invoke-WebRequest -Uri ('http://127.0.0.1:' + $port + '/api/health') -TimeoutSec 5 -UseBasicParsing
  $backendUp = ($r.StatusCode -eq 200)
} catch { $backendUp = $false }
if (-not $backendUp) {
  Write-Host ''
  Write-Host '提醒：本机 127.0.0.1:3000 现在探活失败 —— 后端可能没启动。' -ForegroundColor Yellow
  Write-Host '先双击「启动后端.cmd」，再双击本文件。' -ForegroundColor Yellow
}

Write-Host ''
Write-Host '正在启动 Cloudflare 快速隧道…（这个窗口要一直开着，关掉 = 穿透停止）' -ForegroundColor Cyan
Write-Host '地址会自动写进 utils/config.js（TUNNEL_BASE 那一行），不用手改。' -ForegroundColor Green
Write-Host '开发阶段「详情 → 本地设置 → 不校验合法域名」要继续勾着：' -ForegroundColor Yellow
Write-Host 'trycloudflare 的域名不是你的，加不进小程序后台的 request 合法域名。' -ForegroundColor Yellow
Write-Host ''

# 把隧道地址写回 utils/config.js 的 TUNNEL_BASE 那一行（只动这一行，格式不对就跳过，不硬改）
function Set-TunnelBase($publicUrl) {
  $cfgPath = Join-Path $root 'utils\config.js'
  $apiBase = $publicUrl.TrimEnd('/') + '/api'
  if (-not (Test-Path -LiteralPath $cfgPath)) {
    Write-Host ('没找到 ' + $cfgPath + '，请手动把它填进 DEV_BASES。') -ForegroundColor Yellow
    return
  }
  $pattern = "(?m)^const TUNNEL_BASE = '.*';"
  $cfg = [IO.File]::ReadAllText($cfgPath, [Text.Encoding]::UTF8)
  if (-not [regex]::IsMatch($cfg, $pattern)) {
    Write-Host 'config.js 里没有 TUNNEL_BASE 那一行（可能被改过），请手动把地址填进 DEV_BASES。' -ForegroundColor Yellow
    return
  }
  $updated = [regex]::Replace($cfg, $pattern, "const TUNNEL_BASE = '" + $apiBase + "';")
  try {
    [IO.File]::WriteAllText($cfgPath, $updated, (New-Object Text.UTF8Encoding($false)))
  } catch {
    Write-Host ''
    Write-Host '写不进 utils/config.js（这个目录当前没有写权限，比如 Codex 正开着沙箱）。' -ForegroundColor Red
    Write-Host '手动把这一行改成：' -ForegroundColor Red
    Write-Host ("const TUNNEL_BASE = '" + $apiBase + "';") -ForegroundColor Red
    return
  }
  $check = [IO.File]::ReadAllText($cfgPath, [Text.Encoding]::UTF8)
  if (-not $check.Contains($apiBase)) {
    Write-Host ''
    Write-Host 'utils/config.js 好像没写成功，请手动把 TUNNEL_BASE 改成：' -ForegroundColor Red
    Write-Host ("const TUNNEL_BASE = '" + $apiBase + "';") -ForegroundColor Red
    return
  }
  Write-Host ''
  Write-Host '=================== 隧道已就绪 ===================' -ForegroundColor Green
  Write-Host ('公网地址   ' + $apiBase) -ForegroundColor Green
  Write-Host '已自动写入 utils/config.js' -ForegroundColor Green
  Write-Host '回微信开发者工具点一下「编译」，手机重开小程序即可。' -ForegroundColor Green
  Write-Host '手机用 4G 或校园网 WiFi 都能连，不用和电脑同一个网。' -ForegroundColor Green
  Write-Host '==================================================' -ForegroundColor Green
  Write-Host ''
}

# cloudflared 的输出同时显示在窗口里，并顺手从里面抓出隧道地址
$tunnelReady = $false
& $exe tunnel --url ('http://127.0.0.1:' + $port) --no-autoupdate 2>&1 | ForEach-Object {
  $text = [string]$_
  Write-Host $text
  if (-not $tunnelReady) {
    $m = [regex]::Match($text, 'https://[a-z0-9-]+\.trycloudflare\.com')
    if ($m.Success) {
      $tunnelReady = $true
      Set-TunnelBase $m.Value
    }
  }
}

Write-Host ''
Write-Host '穿透已停止（cloudflared 已退出）。' -ForegroundColor Cyan
