# Starts the Oclay backend locally, loading .env first. Everything runs on this
# machine -- a local SQLite job queue bridges to the Stake helper, and the LOCAL
# pick ledger (data/pick_ledger.sqlite) holds your full history.
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$Host.UI.RawUI.WindowTitle = 'Oclay API (local)'

if (Test-Path '.env') {
    foreach ($line in Get-Content '.env') {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#') -or -not $trimmed.Contains('=')) { continue }
        $idx = $trimmed.IndexOf('=')
        $name = $trimmed.Substring(0, $idx).Trim()
        $value = $trimmed.Substring($idx + 1).Trim().Trim('"').Trim("'")
        if ($name) { Set-Item -Path ("env:" + $name) -Value $value }
    }
    Write-Host 'Loaded settings from .env' -ForegroundColor DarkGray
}

Write-Host 'Starting Oclay local API on http://127.0.0.1:8000 ...' -ForegroundColor Green
Write-Host 'Leave this window open while you use the GPT.' -ForegroundColor DarkGray
& '.\.venv\Scripts\python.exe' -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --proxy-headers --forwarded-allow-ips=*
Read-Host 'API stopped. Press Enter to close'
