$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$port = 3000
$root = Split-Path -Parent $PSScriptRoot
$cfgPath = Join-Path $root 'utils\config.js'

function Get-LanIpv4 {
  $found = @()
  foreach ($nic in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
    if ($nic.OperationalStatus -ne 'Up') { continue }
    if ($nic.NetworkInterfaceType -eq 'Loopback') { continue }

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

$check = [IO.File]::ReadAllText($cfgPath, [Text.Encoding]::UTF8)
if (-not $check.Contains($newUrl)) {
  Write-Host 'utils/config.js 好像没写成功，请手动把 DEV_BASES 的第二项改成：' -ForegroundColor Red
  Write-Host ("  '" + $newUrl + "'") -ForegroundColor Red
  exit 1
}

Write-Host ('已把局域网地址写进 utils/config.js' + $tail) -ForegroundColor Green
Write-Host '手机和电脑同一个 WiFi 时走这个地址；校园网隔离（手机连不上）就靠穿透地址。' -ForegroundColor Green
