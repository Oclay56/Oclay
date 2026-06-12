@echo off
setlocal
cd /d "%~dp0"
title Oclay Local API + Tunnel

if not exist ".venv\Scripts\python.exe" (
  echo ERROR: Could not find .venv\Scripts\python.exe
  echo Run setup first, then try this launcher again.
  echo.
  pause
  exit /b 1
)

if not exist ".env" (
  echo ERROR: Could not find .env
  echo Oclay needs local Supabase settings in %CD%\.env
  echo.
  pause
  exit /b 1
)

set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" (
  echo ERROR: Could not find Windows PowerShell at %PS%
  echo.
  pause
  exit /b 1
)

echo Starting the Oclay local API and a public tunnel in two windows...
echo Copy the trycloudflare.com URL from the Tunnel window into your GPT Action.
start "Oclay API" "%PS%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-oclay-api.ps1"
start "Oclay Tunnel" "%PS%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-oclay-tunnel.ps1"
exit /b 0
