# Opens a free public tunnel (Cloudflare) to the local Oclay API so the Custom
# GPT can reach it. Copy the printed https://...trycloudflare.com URL into the
# GPT Action's server URL. Downloads cloudflared on first run if missing.
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$Host.UI.RawUI.WindowTitle = 'Oclay Tunnel'

$cloudflared = '.\.tools\cloudflared.exe'
if (-not (Test-Path $cloudflared)) {
    New-Item -ItemType Directory -Force '.tools' | Out-Null
    Write-Host 'Downloading cloudflared (one time)...' -ForegroundColor Yellow
    $url = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
    Invoke-WebRequest -Uri $url -OutFile $cloudflared -UseBasicParsing
}

Write-Host ''
Write-Host 'Opening a public tunnel to your local API...' -ForegroundColor Green
Write-Host 'COPY the https://<something>.trycloudflare.com URL below into your' -ForegroundColor Cyan
Write-Host 'Custom GPT Action server field, then re-import the schema.' -ForegroundColor Cyan
Write-Host 'Keep this window open while you use the GPT.' -ForegroundColor DarkGray
Write-Host ''
& $cloudflared tunnel --url http://127.0.0.1:8000
Read-Host 'Tunnel stopped. Press Enter to close'
