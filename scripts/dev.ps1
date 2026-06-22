<#
.SYNOPSIS
    Start all AI VoiceBot services in separate terminal windows.
    Run from the project root: .\scripts\dev.ps1
#>

$root = Split-Path -Parent $PSScriptRoot

Write-Host ""
Write-Host "=== Starting AI VoiceBot (dev mode) ===" -ForegroundColor Cyan

# -- Whisper STT server -------------------------------------------------------
$whisperPython = "$root\stt-server\venv\Scripts\python.exe"
if (Test-Path $whisperPython) {
    Write-Host "[STT]      Starting Faster-Whisper server on :8001..." -ForegroundColor Yellow
    $sttCmd = "Set-Location '$root\stt-server'; & '$whisperPython' server.py"
    Start-Process powershell -ArgumentList @("-NoExit", "-Command", $sttCmd) -WindowStyle Normal
} else {
    Write-Warning "[STT]      Python venv not found. Run setup.ps1 first. STT will be unavailable."
}

Start-Sleep -Milliseconds 500

# -- Ollama -------------------------------------------------------------------
$ollamaRunning = $false
try {
    Invoke-WebRequest -Uri "http://localhost:11434/api/tags" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop | Out-Null
    $ollamaRunning = $true
} catch { }

if (-not $ollamaRunning) {
    $ollamaCmd = Get-Command ollama -ErrorAction SilentlyContinue
    $ollamaExe = if ($ollamaCmd) { $ollamaCmd.Source } else { $null }
    if ($ollamaExe) {
        Write-Host "[Ollama]   Starting Ollama on :11434..." -ForegroundColor Yellow
        Start-Process powershell -ArgumentList @("-NoExit", "-Command", "ollama serve") -WindowStyle Normal
        Start-Sleep -Seconds 3
    } else {
        Write-Warning "[Ollama]   Not found. Install from https://ollama.com"
    }
} else {
    Write-Host "[Ollama]   Already running on :11434" -ForegroundColor Green
}

# -- Backend ------------------------------------------------------------------
Write-Host "[Backend]  Starting Fastify on :3001..." -ForegroundColor Yellow
$backendCmd = "Set-Location '$root\backend'; npm run dev"
Start-Process powershell -ArgumentList @("-NoExit", "-Command", $backendCmd) -WindowStyle Normal

Start-Sleep -Milliseconds 800

# -- Frontend -----------------------------------------------------------------
Write-Host "[Frontend] Starting Vite on :5173..." -ForegroundColor Yellow
$frontendCmd = "Set-Location '$root\frontend'; npm run dev"
Start-Process powershell -ArgumentList @("-NoExit", "-Command", $frontendCmd) -WindowStyle Normal

Start-Sleep -Seconds 2

Write-Host ""
Write-Host "=== All services started ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Frontend  ->  http://localhost:5173"
Write-Host "  Backend   ->  http://localhost:3001"
Write-Host "  Ollama    ->  http://localhost:11434"
Write-Host "  Whisper   ->  http://localhost:8001"
Write-Host ""
Write-Host "Open http://localhost:5173 in your browser."
Write-Host "Press Ctrl+C in each window to stop."

Start-Process "http://localhost:5173"
