@echo off
rem Removes the logon auto-start entry named TutorMiniBackend.cmd
chcp 65001 >nul
setlocal

set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" set "PS=powershell"
set "MSG_OFF=W+KIml0g5bey5Y+W5raI5byA5py66Ieq5Yqo5ZCv5Yqo44CC5Lul5ZCO6ZyA6KaB5omL5Yqo5Y+M5Ye7IOWQr+WKqOWQjuerry5jbWTjgII="

set "TARGET=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\TutorMiniBackend.cmd"
if exist "%TARGET%" del /f /q "%TARGET%"

"%PS%" -NoProfile -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Write-Host ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('%MSG_OFF%')))"
echo.
pause
