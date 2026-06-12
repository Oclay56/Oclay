# Opens a public tunnel to the local Oclay API so the Custom GPT can reach it.
#
# If OCLAY_NGROK_DOMAIN is set in .env (your free, permanent ngrok-free.app
# address), this uses ngrok so the URL NEVER changes -- set it in the GPT once
# and forget it. Otherwise it falls back to a Cloudflare quick tunnel, which
# works with zero setup but hands out a new random URL each run.
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$Host.UI.RawUI.WindowTitle = 'Oclay Tunnel'

# Load .env so we can read OCLAY_NGROK_DOMAIN.
if (Test-Path '.env') {
    foreach ($line in Get-Content '.env') {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#') -or -not $trimmed.Contains('=')) { continue }
        $idx = $trimmed.IndexOf('=')
        $name = $trimmed.Substring(0, $idx).Trim()
        $value = $trimmed.Substring($idx + 1).Trim().Trim('"').Trim("'")
        if ($name) { Set-Item -Path ("env:" + $name) -Value $value }
    }
}

$domain = $env:OCLAY_NGROK_DOMAIN
$ngrok = '.\.tools\ngrok.exe'

if ($domain -and (Test-Path $ngrok)) {
    Write-Host ''
    Write-Host ("Permanent URL: https://" + $domain) -ForegroundColor Green
    Write-Host 'This URL never changes. Set it in the GPT Action once; no more copy-paste.' -ForegroundColor Cyan
    Write-Host 'Keep this window open while you use the GPT.' -ForegroundColor DarkGray
    Write-Host ''
    & $ngrok http ("--domain=" + $domain) 8000
    Read-Host 'Tunnel stopped. Press Enter to close'
    return
}

# Fallback: Cloudflare quick tunnel (random URL each run).
$cloudflared = '.\.tools\cloudflared.exe'
if (-not (Test-Path $cloudflared)) {
    New-Item -ItemType Directory -Force '.tools' | Out-Null
    Write-Host 'Downloading cloudflared (one time)...' -ForegroundColor Yellow
    $url = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
    Invoke-WebRequest -Uri $url -OutFile $cloudflared -UseBasicParsing
}
Write-Host ''
Write-Host 'Opening a Cloudflare quick tunnel (temporary URL).' -ForegroundColor Green
Write-Host 'Tip: set OCLAY_NGROK_DOMAIN in .env for a permanent URL (see LOCAL_API_SETUP.md).' -ForegroundColor Yellow
Write-Host 'COPY the https://<something>.trycloudflare.com URL below into the GPT Action server.' -ForegroundColor Cyan
Write-Host ''
& $cloudflared tunnel --url http://127.0.0.1:8000
Read-Host 'Tunnel stopped. Press Enter to close'
