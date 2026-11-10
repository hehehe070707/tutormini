@echo off
rem ============================================================
rem  Double-click this file to expose the local backend
rem  (127.0.0.1:3000) as a public https URL through a
rem  Cloudflare quick tunnel. Use it when the campus Wi-Fi
rem  blocks phone <-> PC traffic.
rem  This file must stay pure ASCII: cmd.exe reads a .cmd as ANSI
rem  before chcp takes effect, so any Chinese character here would
rem  break the parser (comments included). Chinese output is printed
rem  by tools\tunnel.ps1 with UTF-8 instead.)
rem ============================================================
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" set "PS=powershell"

"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\tunnel.ps1"

echo.
pause
