@echo off
setlocal

cd /d "%~dp0"
title Oclay TUI

if not exist ".venv\Scripts\python.exe" (
  echo ERROR: Could not find .venv\Scripts\python.exe
  echo Run setup first, then try this launcher again.
  echo.
  if exist ".tools\uv\uv.exe" (
    echo Suggested setup command:
    echo   .\.tools\uv\uv.exe venv .venv --python 3.13
    echo   .\.tools\uv\uv.exe pip install -r requirements-local.txt
  ) else (
    echo Install Python 3.13 or uv, then create .venv and install requirements-local.txt.
  )
  echo.
  pause
  exit /b 1
)

if not exist ".env" (
  echo ERROR: Could not find .env
  if exist "env" (
    echo Found a file named "env". Rename it to ".env" if it contains your local settings.
  ) else (
    echo Oclay needs local Supabase settings in %CD%\.env
    echo Use .env.example as the template, then fill in your local values.
  )
  echo.
  pause
  exit /b 1
)

rem Prefer PowerShell 7 (pwsh, UTF-8 + modern rendering); fall back to 5.1.
set "PS_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
where pwsh.exe >nul 2>nul && set "PS_EXE=pwsh.exe"
if not exist "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" if "%PS_EXE%"=="%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" (
  echo ERROR: Could not find PowerShell.
  echo.
  pause
  exit /b 1
)

rem Launch the supervisor: it brings up the local API + tunnel (minimized) and the
rem TUI together, and shuts the API + tunnel down when the TUI window is closed.
start "Oclay" /min "%PS_EXE%" -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0start-oclay-all.ps1"
exit /b 0
