@echo off
rem ============================================================
rem  Double-click this file to start the TutorMini backend.
rem  It also syncs utils/config.js with this PC's current LAN IPv4
rem  and brings the cloudflared quick tunnel up in the background,
rem  so phones can reach the backend without editing any address.
rem  (Kept ASCII-only on purpose: cmd.exe reads .cmd as ANSI,
rem   Chinese text here would be garbled. Chinese messages are
rem   printed via PowerShell with UTF-8, so this file has no
rem   non-ASCII characters at all.)
rem ============================================================
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"

set "MSG1=W3hdIOayoeacieaJvuWIsCBOb2RlLmpz77yM5ZCO56uv6LW35LiN5p2l44CCDQogICAg6K+35YiwIGh0dHBzOi8vbm9kZWpzLm9yZy8g5LiL6L29IExUUyDniYjlronoo4XvvIjkuIDot6/kuIvkuIDmraXvvInvvIzlho3lj4zlh7vmnKzmlofku7bjgII="
set "MSG2=5q2j5Zyo5ZCv5Yqo5ZCO56uv4oCm77yI6L+Z5Liq56qX5Y+j6KaB5LiA55u05byA552A77yM5YWz5o6J5bCx562J5LqO5ZCO56uv5YGc5q2i77yJ"
set "MSG3=5ZCO56uv5bey6YCA5Ye677ya5LiK6Z2i5bCx5piv5Y6f5Zug44CC5L+u5aW95ZCO6YeN5paw5Y+M5Ye75pys5paH5Lu244CC"

set "NODE_EXE="

rem PowerShell (used only to print the Chinese hints) - absolute path so it
rem works even in a shell with a stripped PATH.
set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" set "PS=powershell"

rem 1) Official install location from the registry (works even if PATH is stale).
for /f "tokens=3" %%i in ('reg query "HKLM\SOFTWARE\Node.js" /v InstallPath 2^>nul ^| findstr /i "REG_SZ"') do set "NODE_DIR=%%i"
if not defined NODE_DIR for /f "tokens=3" %%i in ('reg query "HKLM\SOFTWARE\WOW6432Node\Node.js" /v InstallPath 2^>nul ^| findstr /i "REG_SZ"') do set "NODE_DIR=%%i"
if not defined NODE_DIR for /f "tokens=3" %%i in ('reg query "HKCU\SOFTWARE\Node.js" /v InstallPath 2^>nul ^| findstr /i "REG_SZ"') do set "NODE_DIR=%%i"
if defined NODE_DIR if "!NODE_DIR:~-1!"=="\" (set "NODE_EXE=!NODE_DIR!node.exe") else (set "NODE_EXE=!NODE_DIR!\node.exe")
if defined NODE_EXE if not exist "%NODE_EXE%" set "NODE_EXE="

rem 2) Whatever "node" resolves to on PATH.
if not defined NODE_EXE for /f "delims=" %%i in ('where node 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%i"

rem 3) Common install folders (in case PATH was not refreshed yet).
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LocalAppData%\Programs\nodejs\node.exe" set "NODE_EXE=%LocalAppData%\Programs\nodejs\node.exe"

rem 4) Last resort: the Node that ships inside the Codex runtime cache.
if not defined NODE_EXE (
  set "BUNDLED=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
  if exist "!BUNDLED!" set "NODE_EXE=!BUNDLED!"
)

if not defined NODE_EXE (
  "%PS%" -NoProfile -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Write-Host ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('%MSG1%')))"
  pause
  exit /b 1
)

echo Using node: "!NODE_EXE!"
"%PS%" -NoProfile -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Write-Host ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('%MSG2%')))"
echo.

rem ---- housekeeping 1: keep utils/config.js in sync with this PC's LAN IPv4 ----
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\sync-lan-ip.ps1"

rem ---- housekeeping 2: quick tunnel for phones (background, hidden window).
rem      Already running = it just prints the current public URL and exits. ----
start "" /b "%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\tunnel-bg.ps1"

echo.
"!NODE_EXE!" "%~dp0server\server.js"

echo.
"%PS%" -NoProfile -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Write-Host ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('%MSG3%')))"
pause
