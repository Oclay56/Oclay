# Supervisor: starts the local API + tunnel, runs the Oclay TUI, and shuts the
# API + tunnel down when the TUI window closes. This lets one launcher
# (Oclay.bat) bring the whole local stack up and down together.
#
# By default the API + tunnel run completely hidden (no window, no taskbar entry,
# visible only in Task Manager). Set SHOW_BACKGROUND_TERMINALS=true in .env to
# launch them as visible (minimized) windows for debugging.
$ErrorActionPreference = 'SilentlyContinue'
Set-Location -LiteralPath $PSScriptRoot

# UTF-8 for every child process so the rich reports render cleanly.
$env:PYTHONUTF8 = '1'

# Prefer PowerShell 7 (pwsh) for the child windows; fall back to 5.1.
$ps = (Get-Command pwsh.exe -ErrorAction SilentlyContinue).Source
if (-not $ps) { $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe' }
$common = @('-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass')

# Read SHOW_BACKGROUND_TERMINALS from .env (default: false -> run hidden).
$showBackground = $false
$envPath = Join-Path $PSScriptRoot '.env'
if (Test-Path -LiteralPath $envPath) {
    foreach ($line in Get-Content -LiteralPath $envPath) {
        if ($line -match '^\s*SHOW_BACKGROUND_TERMINALS\s*=\s*(.*)$') {
            $value = ($matches[1] -replace '\s+#.*$', '').Trim().Trim('"').Trim("'").ToLowerInvariant()
            $showBackground = @('true', '1', 'yes', 'on') -contains $value
        }
    }
}

# Launch a background helper script. When visible (debug), it runs in a minimized
# window like before. When hidden (default), it runs with no window and no taskbar
# entry via CreateNoWindow -- which also sidesteps the Windows Terminal "default
# terminal" handoff that a normal/minimized launch would pop up.
function Start-BackgroundHelper {
    param([string]$Script)
    $scriptPath = Join-Path $PSScriptRoot $Script
    if ($showBackground) {
        return Start-Process $ps -ArgumentList ($common + @('-File', $scriptPath)) -WindowStyle Minimized -PassThru
    }
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $ps
    $psi.Arguments = '-NoLogo -NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $scriptPath
    $psi.WorkingDirectory = $PSScriptRoot
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    return [System.Diagnostics.Process]::Start($psi)
}

$api = Start-BackgroundHelper 'start-oclay-api.ps1'
$tunnel = Start-BackgroundHelper 'start-oclay-tunnel.ps1'

# The TUI in its own styled window; block until the user closes it.
$tui = Start-Process $ps -ArgumentList ($common + @('-File', (Join-Path $PSScriptRoot 'start-oclay-tui.ps1'))) -PassThru
if ($tui) { Wait-Process -Id $tui.Id }

# TUI closed -> stop the API + tunnel, including their child processes
# (uvicorn / cloudflared / ngrok), via a tree kill.
foreach ($proc in @($api, $tunnel)) {
    if ($proc -and -not $proc.HasExited) {
        Start-Process taskkill -ArgumentList @('/PID', $proc.Id, '/T', '/F') -WindowStyle Hidden -Wait
    }
}
