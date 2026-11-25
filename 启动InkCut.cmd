@echo off
setlocal
cd /d "%~dp0"
if defined INKCUT_FFMPEG if exist "%INKCUT_FFMPEG%" goto ffok
if exist "tools\ffmpeg.exe" goto ffok
where ffmpeg.exe >nul 2>nul && goto ffok
echo FFmpeg is required. Place ffmpeg.exe in tools or add it to PATH. See README.md.
pause
exit /b 1
:ffok
if not exist "runtime\electron.exe" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-runtime.ps1"
  if errorlevel 1 (pause & exit /b 1)
)
set ELECTRON_RUN_AS_NODE=
start "" "%~dp0runtime\electron.exe" "%~dp0."
