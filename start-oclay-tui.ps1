# The Oclay TUI in its styled black window. Launched by the supervisor
# (start-oclay-all.ps1); closing this window tears down the API + tunnel.
$Host.UI.RawUI.WindowTitle = 'Oclay TUI'
$Host.UI.RawUI.BackgroundColor = 'Black'
$Host.UI.RawUI.ForegroundColor = 'DarkGray'
Clear-Host
Set-Location -LiteralPath $PSScriptRoot
& '.\.venv\Scripts\python.exe' -m app.local_helper_tui
$code = $LASTEXITCODE
if ($code -ne 0) {
    Write-Host ''
    Write-Host ("Oclay TUI exited with code {0}." -f $code)
    Read-Host 'Press Enter to close'
}
exit $code
