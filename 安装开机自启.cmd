@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"

set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" set "PS=powershell"
set "MSG_NO=W3hdIOayoeacieaJvuWIsCBOb2RlLmpz77yM6KOF5aW95LmL5ZCO5YaN6L+Q6KGM5pys6ISa5pys44CCDQogICAg5LiL6L2977yaaHR0cHM6Ly9ub2RlanMub3JnLyDvvIjpgIkgTFRT77yJ"
set "MSG_OK=W+KIml0g5bey6K6+572u5byA5py66Ieq5Yqo5ZCv5Yqo5ZCO56uv44CC5Lul5ZCO5byA5py65a6D6Ieq5bex5bCx6LW35p2l5LqG77yM5LiN55So5YaN5Y+M5Ye75Lu75L2V5Lic6KW/44CCDQogICAg5Y+W5raI77ya5Y+M5Ye7IOWPlua2iOW8gOacuuiHquWQry5jbWQgICAg56uL5Y2z5YGc5o6J77ya5Y+M5Ye7IOWBnOatouWQjuerry5jbWQ="

set "NODE_EXE="
set "NODE_DIR="
for /f "tokens=3" %%i in ('reg query "HKLM\SOFTWARE\Node.js" /v InstallPath 2^>nul ^| findstr /i "REG_SZ"') do set "NODE_DIR=%%i"
if not defined NODE_DIR for /f "tokens=3" %%i in ('reg query "HKLM\SOFTWARE\WOW6432Node\Node.js" /v InstallPath 2^>nul ^| findstr /i "REG_SZ"') do set "NODE_DIR=%%i"
if not defined NODE_DIR for /f "tokens=3" %%i in ('reg query "HKCU\SOFTWARE\Node.js" /v InstallPath 2^>nul ^| findstr /i "REG_SZ"') do set "NODE_DIR=%%i"
if defined NODE_DIR if "!NODE_DIR:~-1!"=="\" (set "NODE_EXE=!NODE_DIR!node.exe") else (set "NODE_EXE=!NODE_DIR!\node.exe")
if defined NODE_EXE if not exist "!NODE_EXE!" set "NODE_EXE="
if not defined NODE_EXE for /f "delims=" %%i in ('where node 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%i"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LocalAppData%\Programs\nodejs\node.exe" set "NODE_EXE=%LocalAppData%\Programs\nodejs\node.exe"
if not defined NODE_EXE (
  set "BUNDLED=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
  if exist "!BUNDLED!" set "NODE_EXE=!BUNDLED!"
)
if not defined NODE_EXE (
  "%PS%" -NoProfile -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Write-Host ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('%MSG_NO%')))"
  pause
  exit /b 1
)

set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "TARGET=!STARTUP!\TutorMiniBackend.cmd"

> "!TARGET!" echo @echo off
>> "!TARGET!" echo rem TutorMini backend - auto start at logon (delete this file to undo)
>> "!TARGET!" echo if not "%%1"=="min" start "" /min "%%~f0" min ^& exit /b
>> "!TARGET!" echo cd /d "%~dp0"
>> "!TARGET!" echo rem sync utils/config.js LAN IP + start the quick tunnel in the background
>> "!TARGET!" echo "%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\sync-lan-ip.ps1"
>> "!TARGET!" echo start "" /b "%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\tunnel-bg.ps1"
>> "!TARGET!" echo "!NODE_EXE!" "%~dp0server\server.js"
>> "!TARGET!" echo pause

if not exist "!TARGET!" (
  echo [x] Could not write the startup entry: !TARGET!
  pause
  exit /b 1
)

echo Startup entry: !TARGET!
echo Node used:     !NODE_EXE!
"%PS%" -NoProfile -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Write-Host ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('%MSG_OK%')))"
echo.
pause
