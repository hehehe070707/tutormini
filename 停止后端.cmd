@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" set "PS=powershell"
set "MSG_OK=W+KIml0g5ZCO56uv5bey5YGc5q2i77yI56uv5Y+jIDMwMDAg5bey6YeK5pS+77yJ44CC"
set "MSG_NONE=56uv5Y+jIDMwMDAg5LiK5rKh5pyJ5ZCO56uv5Zyo6LeR77yM5LiN55So5YGc44CC"
set "MSG_OTHER=56uv5Y+jIDMwMDAg6KKr5Yir55qE56iL5bqP5Y2g552A77yI6L+b56iL5ZCN77ya"
set "MSG_TUN_OK=W+KIml0g56m/6YCP6Zqn6YGT5bey5YGc5q2i77yIY2xvdWRmbGFyZWQg5bey6YCA5Ye677yJ44CC"
set "MSG_TUN_NONE=5rKh5pyJ56m/6YCP6Zqn6YGT5Zyo6LeR77yM5LiN55So5YGc44CC"

"%PS%" -NoProfile -Command "$p=@(Get-Process cloudflared -ErrorAction SilentlyContinue); if ($p.Count -gt 0) { $p | Stop-Process -Force; exit 0 } exit 2"
if errorlevel 2 (
  "%PS%" -NoProfile -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Write-Host ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('%MSG_TUN_NONE%')))"
) else (
  "%PS%" -NoProfile -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Write-Host ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('%MSG_TUN_OK%')))"
)

set "TARGET_PID="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000" ^| findstr /i "LISTENING"') do set "TARGET_PID=%%p"

if not defined TARGET_PID (
  "%PS%" -NoProfile -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Write-Host ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('%MSG_NONE%')))"
  echo.
  pause
  exit /b 0
)

set "PNAME="
for /f "delims=" %%n in ('%PS% -NoProfile -Command "(Get-Process -Id !TARGET_PID! -ErrorAction SilentlyContinue).ProcessName"') do set "PNAME=%%n"

if /i "!PNAME!"=="node" (
  "%PS%" -NoProfile -Command "Stop-Process -Id !TARGET_PID! -Force -ErrorAction SilentlyContinue"
  "%PS%" -NoProfile -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Write-Host ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('%MSG_OK%')))"
) else (
  "%PS%" -NoProfile -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Write-Host ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('%MSG_OTHER%')) + '!PNAME! !TARGET_PID!)')"
)
echo.
pause
