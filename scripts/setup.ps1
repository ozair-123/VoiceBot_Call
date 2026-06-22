<#
.SYNOPSIS
    One-shot setup script for AI VoiceBot on Windows.
    Run from the project root: .\scripts\setup.ps1
#>

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

Write-Host "`n=== AI VoiceBot Setup ===" -ForegroundColor Cyan

# ── Node.js ──────────────────────────────────────────────────────────────────
Write-Host "`n[1/6] Checking Node.js..." -ForegroundColor Yellow
$nodeVer = node --version 2>$null
if (-not $nodeVer) {
    Write-Error "Node.js not found. Install from https://nodejs.org (v20+)"
}
Write-Host "  Node $nodeVer" -ForegroundColor Green

# ── Backend deps ─────────────────────────────────────────────────────────────
Write-Host "`n[2/6] Installing backend dependencies..." -ForegroundColor Yellow
Set-Location "$root\backend"
npm install
Write-Host "  Backend deps installed." -ForegroundColor Green

# ── Frontend deps ─────────────────────────────────────────────────────────────
Write-Host "`n[3/6] Installing frontend dependencies..." -ForegroundColor Yellow
Set-Location "$root\frontend"
npm install
Write-Host "  Frontend deps installed." -ForegroundColor Green

# ── Python / STT server ───────────────────────────────────────────────────────
Write-Host "`n[4/6] Setting up Python STT server (faster-whisper)..." -ForegroundColor Yellow
Set-Location "$root\stt-server"

$pythonCmd = $null
foreach ($cmd in @("python", "python3", "py")) {
    try {
        $v = & $cmd --version 2>&1
        if ($v -match "Python 3\.\d+") { $pythonCmd = $cmd; break }
    } catch { }
}

if (-not $pythonCmd) {
    Write-Warning "Python 3 not found. STT (voice input) will be unavailable."
    Write-Warning "Install Python 3.10+ from https://python.org and re-run setup."
} else {
    Write-Host "  Using $pythonCmd ($($(&$pythonCmd --version)))" -ForegroundColor Green

    if (-not (Test-Path "$root\stt-server\venv")) {
        & $pythonCmd -m venv "$root\stt-server\venv"
    }

    $pip = "$root\stt-server\venv\Scripts\pip.exe"
    & $pip install --upgrade pip --quiet
    & $pip install -r "$root\stt-server\requirements.txt"
    Write-Host "  STT dependencies installed." -ForegroundColor Green
}

# ── Ollama ────────────────────────────────────────────────────────────────────
Write-Host "`n[5/6] Checking Ollama..." -ForegroundColor Yellow
$ollamaCmd = Get-Command ollama -ErrorAction SilentlyContinue
$ollamaPath = if ($ollamaCmd) { $ollamaCmd.Source } else { $null }
if (-not $ollamaPath) {
    Write-Warning "Ollama not found. Install from https://ollama.com"
    Write-Warning "After installing, run:  ollama pull qwen3:8b"
} else {
    Write-Host "  Ollama found at $ollamaPath" -ForegroundColor Green
    Write-Host "  Pulling qwen3:8b model (this may take a while)..." -ForegroundColor Yellow
    ollama pull qwen3:8b
    Write-Host "  Model ready." -ForegroundColor Green
}

# ── Piper TTS ─────────────────────────────────────────────────────────────────
Write-Host "`n[6/6] Piper TTS setup..." -ForegroundColor Yellow
$piperDir = "C:\piper"
$piperExe = "$piperDir\piper.exe"
$modelsDir = "$piperDir\models"

if (Test-Path $piperExe) {
    Write-Host "  Piper already installed at $piperExe" -ForegroundColor Green
} else {
    Write-Host "  Piper not found at $piperExe." -ForegroundColor Yellow
    Write-Host @"

  To install Piper TTS manually:
  1. Download piper_windows_amd64.zip from:
     https://github.com/rhasspy/piper/releases/latest
  2. Extract to C:\piper\  (so C:\piper\piper.exe exists)
  3. Download a voice model (.onnx + .onnx.json) from:
     https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_US/lessac/medium
     Save to C:\piper\models\en_US-lessac-medium.onnx
  4. Update PIPER_EXE_PATH and PIPER_MODEL_PATH in backend\.env if needed.

"@ -ForegroundColor Gray
}

New-Item -ItemType Directory -Force -Path $modelsDir | Out-Null

# ── Data dirs ─────────────────────────────────────────────────────────────────
New-Item -ItemType Directory -Force -Path "$root\backend\data\audio" | Out-Null

Write-Host "`n=== Setup complete! ===" -ForegroundColor Cyan
Write-Host "Run:  .\scripts\dev.ps1   to start all services" -ForegroundColor White
