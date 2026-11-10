<#
 * 查看本机IP（小程序端 utils/config.js 里第二个地址的来源）
 *
 * 双击项目根目录的「查看本机IP.cmd」运行。它做三件事：
 *   1) 列出这台电脑当前的局域网 IPv4 —— 手机真机要填的就是它；
 *   2) 看后端有没有绑在 0.0.0.0:3000 上（只绑 127.0.0.1 的话手机连不上）；
 *   3) 逐个地址探活 /api/health，并和 utils/config.js 里写死的地址对照，给出该改成什么。
 *
 * 注意：本文件必须保持「UTF-8 带 BOM」。Windows PowerShell 5.1 读不带 BOM 的 .ps1 时
 * 会按 ANSI 解码，中文会变成乱码（旁边那几个 .cmd 启动器写成纯 ASCII 就是为了避开这个坑）。
 #>

$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$port = 3000
$root = Split-Path -Parent $PSScriptRoot          # 本脚本在 tools\ 下，上一级就是项目根目录
$cfgPath = Join-Path $root 'utils\config.js'

function Write-Head($text) {
  Write-Host ''
  Write-Host $text -ForegroundColor Cyan
}

# ---------- 1) 当前电脑的局域网 IPv4 ----------
Write-Head '=== 本机局域网地址（手机真机要用的就是它） ==='
$ips = @()
foreach ($nic in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
  if ($nic.OperationalStatus -ne 'Up') { continue }
  if ($nic.NetworkInterfaceType -eq 'Loopback') { continue }
  foreach ($u in $nic.GetIPProperties().UnicastAddresses) {
    if ($u.Address.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) { continue }
    $ip = $u.Address.ToString()
    if ($ip -like '127.*' -or $ip -like '169.254.*') { continue }   # 回环和"没拿到 IP"的自动地址
    $ips += $ip
    Write-Host ("  {0,-16} {1}" -f $ip, $nic.Name)
  }
}
if ($ips.Count -eq 0) {
  Write-Host '  没找到局域网 IPv4：电脑可能没连上 Wi-Fi / 网线。' -ForegroundColor Yellow
}

# ---------- 2) 后端监听情况 ----------
Write-Head '=== 后端监听情况（必须是 0.0.0.0:3000） ==='
$listening = $false
try {
  foreach ($l in @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction Stop)) {
    $listening = $true
    $pname = (Get-Process -Id $l.OwningProcess -ErrorAction SilentlyContinue).ProcessName
    if ($l.LocalAddress -eq '0.0.0.0') {
      Write-Host ("  {0}:{1}  {2}  → OK，所有网卡都能连" -f $l.LocalAddress, $l.LocalPort, $pname) -ForegroundColor Green
    } else {
      Write-Host ("  {0}:{1}  {2}  → 只绑了本机，手机连不上（HOST 要设成 0.0.0.0）" -f $l.LocalAddress, $l.LocalPort, $pname) -ForegroundColor Yellow
    }
  }
} catch {
  # 某些系统/权限下 Get-NetTCPConnection 不可用，退回 netstat
  $net = netstat -ano | Select-String (':' + $port) | Select-String 'LISTENING'
  if ($net) {
    $listening = $true
    $net | ForEach-Object { Write-Host ('  ' + $_.Line.Trim()) }
  }
}
if (-not $listening) {
  Write-Host '  3000 端口没有人在听：后端没启动，先双击「启动后端.cmd」。' -ForegroundColor Red
}

# ---------- 3) 逐个地址探活 ----------
Write-Head '=== 逐个地址探活 /api/health（手机浏览器打开同一个地址，看到的就是这个结果） ==='
$good = @()
foreach ($ip in $ips) {
  $url = 'http://' + $ip + ':' + $port + '/api/health'
  $ok = $false
  $detail = ''
  try {
    $r = Invoke-WebRequest -Uri $url -TimeoutSec 5 -UseBasicParsing
    $ok = ($r.StatusCode -eq 200)
    $detail = 'HTTP ' + [int]$r.StatusCode
  } catch {
    $detail = '连不上'
  }
  if ($ok) {
    $good += $ip
    Write-Host ("  {0}  {1}  ← 手机要用的地址" -f $url, $detail) -ForegroundColor Green
  } else {
    Write-Host ("  {0}  {1}" -f $url, $detail) -ForegroundColor DarkGray
  }
}

# ---------- 4) 和 utils/config.js 对照 ----------
Write-Head '=== 和 utils/config.js 对照 ==='
$cfgIp = ''
$cfgAny = $false
if (Test-Path -LiteralPath $cfgPath) {
  $cfg = Get-Content -LiteralPath $cfgPath -Raw -Encoding UTF8
  # 只认「给手机用的」那条：127.0.0.1 是模拟器用的，跳过
  foreach ($m in [regex]::Matches($cfg, 'http://(\d{1,3}(?:\.\d{1,3}){3}):' + $port + '/api')) {
    $cfgAny = $true
    if ($m.Groups[1].Value -notlike '127.*') { $cfgIp = $m.Groups[1].Value; break }
  }
}
if (-not $cfgAny) {
  Write-Host '  utils/config.js 里没找到 http://<IP>:3000/api 形式的地址。' -ForegroundColor Yellow
} elseif ($cfgIp -eq '') {
  Write-Host '  config.js 里只有本机地址 127.0.0.1（模拟器用），没写手机用的局域网地址。' -ForegroundColor Yellow
  if ($good.Count -gt 0) { Write-Host ("  在 DEV_BASES 里加上： 'http://{0}:{1}/api'" -f $good[0], $port) -ForegroundColor Yellow }
} elseif ($good -contains $cfgIp) {
  Write-Host ("  config.js 里写的 {0} 和当前电脑一致（探活也通过了）。" -f $cfgIp) -ForegroundColor Green
} elseif ($ips -contains $cfgIp) {
  Write-Host ("  config.js 里写的 {0} 就是本机地址，但 /api/health 探活失败：先确认后端在跑（双击「启动后端.cmd」）。" -f $cfgIp) -ForegroundColor Yellow
} else {
  Write-Host ("  config.js 里写的是 {0}，当前电脑实际是 {1} —— 手机连不上就是因为这个。" -f $cfgIp, ($ips -join ' / ')) -ForegroundColor Yellow
  if ($good.Count -gt 0) {
    Write-Host ("  把 DEV_BASES 第二项改成： 'http://{0}:{1}/api'" -f $good[0], $port) -ForegroundColor Yellow
  }
}

# ---------- 4.5) 顺带看一眼穿透地址 ----------
if (Test-Path -LiteralPath $cfgPath) {
  $cfgText = Get-Content -LiteralPath $cfgPath -Raw -Encoding UTF8
  $mt = [regex]::Match($cfgText, "const TUNNEL_BASE = '([^']*)';")
  if ($mt.Success -and $mt.Groups[1].Value -ne '') {
    Write-Head '=== 当前穿透地址（TUNNEL_BASE，由「穿透后端.cmd」自动写入） ==='
    Write-Host ('  ' + $mt.Groups[1].Value) -ForegroundColor Cyan
    Write-Host '  手机优先走这个，校园网隔离也能连；隧道窗口关掉后要重开一次「穿透后端.cmd」。'
  }
}

# ---------- 5) 手机连不上时的排查顺序 ----------
Write-Head '=== 手机连不上时按顺序做 ==='
Write-Host '  1. 手机和电脑连同一个 WiFi，手机浏览器打开 http://<上面那个IP>:3000/api/health'
Write-Host '     看到一串 JSON = 网络通了，问题只在 config.js 写死的地址。'
Write-Host '  2. 手机浏览器也打不开 = 校园网把手机和电脑隔开了（AP 隔离）：'
Write-Host '     让手机开热点、电脑连这个热点，再重跑本脚本拿新 IP（记得改 config.js）。'
Write-Host '  3. 还是不行就双击「穿透后端.cmd」，走公网 https，彻底绕开校园网。'
Write-Host '  4. iPhone：设置 → 微信 → 打开「本地网络」，否则访问局域网 IP 会一直超时。'
