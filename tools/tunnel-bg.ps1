<#
 * 后台把穿透隧道拉起来（不用自己盯着一个窗口）
 *
 * 由「启动后端.cmd」顺手调用：把本机 http://127.0.0.1:3000 通过 cloudflared 快速隧道
 * 暴露成公网 https 地址（手机用 4G / 校园网也能连），地址自动写进 utils/config.js 的
 * TUNNEL_BASE 那一行。
 *
 * 和「穿透后端.cmd」的区别：这个是后台跑完就退出的（cloudflared 隐藏窗口常驻），
 * 适合开机自启；想盯着隧道日志就双击「穿透后端.cmd」。
 * 已经在跑就不重复起（快速隧道只要进程活着，地址一直有效）。
 *
 * 注意：本文件必须保持「UTF-8 带 BOM」，否则 Windows PowerShell 5.1 会按 ANSI 读，中文乱码。
 #>

$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$port = 3000
$root = Split-Path -Parent $PSScriptRoot
$cfgPath = Join-Path $root 'utils\config.js'

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

# 读 config.js 里当前的穿透地址（没有就返回空串）
function Get-TunnelBase {
  if (-not (Test-Path -LiteralPath $cfgPath)) { return '' }
  $cfg = [IO.File]::ReadAllText($cfgPath, [Text.Encoding]::UTF8)
  $m = [regex]::Match($cfg, "const TUNNEL_BASE = '([^']*)';")
  if ($m.Success) { return $m.Groups[1].Value }
  return ''
}

# 把隧道地址写回 utils/config.js 的 TUNNEL_BASE 那一行（只动这一行，格式不对就跳过，不硬改）
function Set-TunnelBase($publicUrl) {
  $apiBase = $publicUrl.TrimEnd('/') + '/api'
  if (-not (Test-Path -LiteralPath $cfgPath)) {
    Write-Host ('没找到 ' + $cfgPath + '，请手动把它填进 DEV_BASES。') -ForegroundColor Yellow
    return $false
  }
  $pattern = "(?m)^const TUNNEL_BASE = '.*';"
  $cfg = [IO.File]::ReadAllText($cfgPath, [Text.Encoding]::UTF8)
  if (-not [regex]::IsMatch($cfg, $pattern)) {
    Write-Host 'config.js 里没有 TUNNEL_BASE 那一行（可能被改过），请手动把地址填进 DEV_BASES。' -ForegroundColor Yellow
    return $false
  }
  $updated = [regex]::Replace($cfg, $pattern, "const TUNNEL_BASE = '" + $apiBase + "';")
  try {
    [IO.File]::WriteAllText($cfgPath, $updated, (New-Object Text.UTF8Encoding($false)))
  } catch {
    Write-Host '写不进 utils/config.js（这个目录当前没有写权限，比如 Codex 正开着沙箱）。' -ForegroundColor Red
    Write-Host '手动把这一行改成：' -ForegroundColor Red
    Write-Host ("const TUNNEL_BASE = '" + $apiBase + "';") -ForegroundColor Red
    return $false
  }
  # 复核一次，确认真写进去了（写权限被拦时别报"已写入"）
  $check = [IO.File]::ReadAllText($cfgPath, [Text.Encoding]::UTF8)
  if (-not $check.Contains($apiBase)) {
    Write-Host 'utils/config.js 好像没写成功，请手动把 TUNNEL_BASE 改成：' -ForegroundColor Red
    Write-Host ("const TUNNEL_BASE = '" + $apiBase + "';") -ForegroundColor Red
    return $false
  }
  Write-Host ('公网地址   ' + $apiBase) -ForegroundColor Green
  Write-Host '已自动写入 utils/config.js（回开发者工具点一下「编译」，手机重开小程序）。' -ForegroundColor Green
  return $true
}

# ---------- 已经在跑就直接用 ----------
$alive = @(Get-Process -Name cloudflared -ErrorAction SilentlyContinue)
if ($alive.Count -gt 0) {
  Write-Host ('穿透隧道已经在后台跑着（PID ' + $alive[0].Id + '），不重复启动。') -ForegroundColor Green
  $cur = Get-TunnelBase
  if ($cur -ne '') { Write-Host ('当前穿透地址   ' + $cur) -ForegroundColor Green }
  Write-Host '想换一个新地址：先双击「停止后端.cmd」（会把隧道一起停掉），再重新启动后端。' -ForegroundColor DarkGray
  exit 0
}

$exe = Find-Cloudflared
if ($exe -eq '') {
  Write-Host '没找到 cloudflared，穿透没起来：手机暂时只能用同一个 WiFi 的局域网地址。' -ForegroundColor Yellow
  Write-Host '想装：PowerShell 里执行 winget install --id Cloudflare.cloudflared' -ForegroundColor Yellow
  exit 1
}

$logOut = Join-Path $env:TEMP 'tutormini-tunnel-out.log'
$logErr = Join-Path $env:TEMP 'tutormini-tunnel-err.log'
Remove-Item -LiteralPath $logOut, $logErr -ErrorAction SilentlyContinue

Write-Host '正在后台启动 Cloudflare 快速隧道…（地址到手就写进 utils/config.js）' -ForegroundColor Cyan
$proc = Start-Process -FilePath $exe `
  -ArgumentList 'tunnel', '--url', ('http://127.0.0.1:' + $port), '--no-autoupdate' `
  -WindowStyle Hidden -RedirectStandardOutput $logOut -RedirectStandardError $logErr -PassThru

$url = ''
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  $text = (Get-Content -LiteralPath $logOut -Raw -ErrorAction SilentlyContinue) +
          (Get-Content -LiteralPath $logErr -Raw -ErrorAction SilentlyContinue)
  $m = [regex]::Match([string]$text, 'https://[a-z0-9-]+\.trycloudflare\.com')
  if ($m.Success) { $url = $m.Value; break }
  if ($proc.HasExited) { break }
}

if ($url -eq '') {
  Write-Host '隧道没起来（可能是没网、被拦，或者 cloudflared 启动失败）：手机暂时只能用同一个 WiFi 的局域网地址。' -ForegroundColor Yellow
  $text = (Get-Content -LiteralPath $logErr -Raw -ErrorAction SilentlyContinue)
  if ($text) { Write-Host (([string]$text -split "`n" | Select-Object -Last 5) -join "`n") -ForegroundColor DarkGray }
  exit 1
}

# 后端和隧道通常是同一秒起来的，这里再给它几秒（只提醒，不拦）
$backendUp = $false
for ($i = 0; $i -lt 5; $i++) {
  try {
    $r = Invoke-WebRequest -Uri ('http://127.0.0.1:' + $port + '/api/health') -TimeoutSec 3 -UseBasicParsing
    if ($r.StatusCode -eq 200) { $backendUp = $true; break }
  } catch { }
  if ($i -lt 4) { Start-Sleep -Seconds 2 }
}
if (-not $backendUp) {
  Write-Host '提醒：本机 127.0.0.1:3000 还没探活成功 —— 确认后端窗口没报错（隧道先跑着，后端起来就能连）。' -ForegroundColor Yellow
}

if (Set-TunnelBase $url) { exit 0 }

Write-Host ('隧道本身已经在后台跑起来了，公网地址是：' + $url + '/api') -ForegroundColor Cyan
exit 1
