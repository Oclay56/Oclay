# Supervisor: starts the local API + tunnel (minimized), runs the Oclay TUI, and
# shuts the API + tunnel down when the TUI window closes. This lets one launcher
# (Oclay.bat) bring the whole local stack up and down together.
$ErrorActionPreference = 'SilentlyContinue'
Set-Location -LiteralPath $PSScriptRoot
$ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$common = @('-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass')

# Background services, minimized so only the TUI is in the foreground. They stay
# reachable in the taskbar if you ever need the logs or the tunnel URL.
$api = Start-Process $ps -ArgumentList ($common + @('-File', (Join-Path $PSScriptRoot 'start-oclay-api.ps1'))) -WindowStyle Minimized -PassThru
$tunnel = Start-Process $ps -ArgumentList ($common + @('-File', (Join-Path $PSScriptRoot 'start-oclay-tunnel.ps1'))) -WindowStyle Minimized -PassThru

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
