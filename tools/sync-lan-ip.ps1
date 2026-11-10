<#
 * 同步局域网地址（对应小程序端 utils/config.js 里 DEV_BASES 的第二项）
 *
 * 由「启动后端.cmd」在起后端之前自动跑一次：把这台电脑当前拿到的局域网 IPv4 写进
 * utils/config.js 的 DEV_BASES 第二项。换电脑 / 换 WiFi / 重连校园网之后电脑 IP 会变，
 * 有了这一步就不用再双击「查看本机IP.cmd」手改那一行。
 *
 * 只改 DEV_BASES 这一段里的第二个地址，别的行一律不动；认不出原格式就打印提示跳过，
 * 不硬改文件。（穿透地址那一行由 tools\tunnel-bg.ps1 / tools\tunnel.ps1 写 TUNNEL_BASE。）
 *
 * 注意：本文件必须保持「UTF-8 带 BOM」，否则 Windows PowerShell 5.1 会按 ANSI 读，中文乱码。
 #>

$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$port = 3000
$root = Split-Path -Parent $PSScriptRoot          # 本脚本在 tools\ 下，上一级就是项目根目录
$cfgPath = Join-Path $root 'utils\config.js'

# 当前电脑的局域网 IPv4（手机真机要用的就是它）
function Get-LanIpv4 {
  $found = @()
  foreach ($nic in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
    if ($nic.OperationalStatus -ne 'Up') { continue }
    if ($nic.NetworkInterfaceType -eq 'Loopback') { continue }
    # 虚拟机 / WSL / 蓝牙这些网卡上的地址手机连不到，直接跳过
    $name = [string]$nic.Name + ' ' + [string]$nic.Description
    if ($name -match 'vEthernet|VMware|VirtualBox|Hyper-V|WSL|Loopback|Tailscale|Bluetooth') { continue }
    foreach ($u in $nic.GetIPProperties().UnicastAddresses) {
      if ($u.Address.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) { continue }
      $ip = $u.Address.ToString()
      if ($ip -like '127.*' -or $ip -like '169.254.*') { continue }
      $found += $ip
    }
  }
  if ($found.Count -eq 0) { return '' }
  # 家里 / 宿舍一般是 192.168.x，校园网是 10.x，其它的排最后
  $sorted = @($found | Where-Object { $_ -like '192.168.*' }) +
            @($found | Where-Object { $_ -like '10.*' }) +
            @($found | Where-Object { $_ -notlike '192.168.*' -and $_ -notlike '10.*' })
  return [string]$sorted[0]
}

$ip = Get-LanIpv4
if ($ip -eq '') {
  Write-Host '没找到局域网 IPv4（电脑可能没连上 WiFi / 网线），utils/config.js 不动。' -ForegroundColor Yellow
  exit 0
}

if (-not (Test-Path -LiteralPath $cfgPath)) {
  Write-Host ('没找到 ' + $cfgPath + '，跳过。') -ForegroundColor Yellow
  exit 0
}

$cfg = [IO.File]::ReadAllText($cfgPath, [Text.Encoding]::UTF8)
$newline = "`n"
if ($cfg.Contains("`r`n")) { $newline = "`r`n" }

$blockMatch = [regex]::Match($cfg, '(?ms)^const DEV_BASES = \[.*?\];')
if (-not $blockMatch.Success) {
  Write-Host 'utils/config.js 里没找到 DEV_BASES 那一段（可能被改过），请手动填手机用的地址。' -ForegroundColor Yellow
  exit 0
}

$block = $blockMatch.Value
$urls = [regex]::Matches($block, "'(https?://[^']*)'")
$newUrl = 'http://' + $ip + ':' + $port + '/api'
$newBlock = ''
$tail = ''

if ($urls.Count -ge 2) {
  # 第二项就是手机真机用的局域网地址（第一项是模拟器的 127.0.0.1，不碰）
  $second = $urls[1]
  $oldUrl = $second.Groups[1].Value
  if ($oldUrl -eq $newUrl) {
    Write-Host ('局域网地址没变（' + $ip + '），utils/config.js 不用改。') -ForegroundColor Green
    exit 0
  }
  $newBlock = $block.Substring(0, $second.Index) + "'" + $newUrl + "'" +
              $block.Substring($second.Index + $second.Length)
  $tail = '（' + $oldUrl + ' → ' + $newUrl + '）'
} elseif ($urls.Count -eq 1) {
  # 只有模拟器那条：把手机用的地址补进去
  $only = $urls[0]
  $insertAt = $only.Index + $only.Length
  $newBlock = $block.Substring(0, $insertAt) + ',' + $newline + "  '" + $newUrl + "'" +
              $block.Substring($insertAt)
  $tail = '（新增手机用地址 ' + $newUrl + '）'
} else {
  Write-Host 'DEV_BASES 里没有 http 地址，跳过（请手动填手机用的地址）。' -ForegroundColor Yellow
  exit 0
}

$updated = $cfg.Substring(0, $blockMatch.Index) + $newBlock + $cfg.Substring($blockMatch.Index + $blockMatch.Length)
try {
  [IO.File]::WriteAllText($cfgPath, $updated, (New-Object Text.UTF8Encoding($false)))
} catch {
  Write-Host '写不进 utils/config.js（这个目录当前没有写权限，比如 Codex 正开着沙箱）。' -ForegroundColor Red
  Write-Host '手动把 DEV_BASES 的第二项改成：' -ForegroundColor Red
  Write-Host ("  '" + $newUrl + "'") -ForegroundColor Red
  Write-Host '（或者让 Codex 帮你改这一行。）' -ForegroundColor Yellow
  exit 1
}

# 复核一次，确认真写进去了（写权限被拦时别报"已写入"）
$check = [IO.File]::ReadAllText($cfgPath, [Text.Encoding]::UTF8)
if (-not $check.Contains($newUrl)) {
  Write-Host 'utils/config.js 好像没写成功，请手动把 DEV_BASES 的第二项改成：' -ForegroundColor Red
  Write-Host ("  '" + $newUrl + "'") -ForegroundColor Red
  exit 1
}

Write-Host ('已把局域网地址写进 utils/config.js' + $tail) -ForegroundColor Green
Write-Host '手机和电脑同一个 WiFi 时走这个地址；校园网隔离（手机连不上）就靠穿透地址。' -ForegroundColor Green
