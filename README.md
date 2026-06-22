# AI VoiceBot — Local Development

A fully local AI voice assistant running on Windows. No cloud, no telephony, no SIP. Everything on your PC.

## Architecture

```
Frontend (React/Vite :5173)
    ↕ REST + WebSocket proxy
Backend (Fastify :3001)
    ├── Ollama (Qwen3:8B  :11434)   — LLM responses
    ├── Whisper Server (Python :8001) — Speech-to-Text
    └── Piper (exe subprocess)        — Text-to-Speech
```

## Prerequisites

| Tool | Version | Where |
|------|---------|--------|
| Node.js | v20+ | https://nodejs.org |
| Python | 3.10+ | https://python.org |
| Ollama | latest | https://ollama.com |
| Piper | latest | https://github.com/rhasspy/piper/releases |

## One-Time Setup

```powershell
# From project root
.\scripts\setup.ps1
```

This installs npm packages, creates the Python venv, installs faster-whisper, and pulls the Qwen3:8B model from Ollama.

### Piper TTS (manual step)

1. Download `piper_windows_amd64.zip` from [Piper Releases](https://github.com/rhasspy/piper/releases/latest)
2. Extract to `C:\piper\` so `C:\piper\piper.exe` exists
3. Download the voice model from [Hugging Face](https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_US/lessac/medium):
   - `en_US-lessac-medium.onnx`
   - `en_US-lessac-medium.onnx.json`
4. Save both files to `C:\piper\models\`

> **Different voice?** Change `PIPER_MODEL_PATH` in `backend/.env` and point to any other `.onnx` model.

## Start Development

```powershell
.\scripts\dev.ps1
```

Opens 4 terminal windows (Whisper, Ollama, Backend, Frontend) and opens the app at **http://localhost:5173**.

## Manual Start (if scripts fail)

```powershell
# Terminal 1 — Whisper STT
cd stt-server
.\venv\Scripts\python.exe server.py

# Terminal 2 — Ollama (if not already running)
ollama serve

# Terminal 3 — Backend
cd backend
npm run dev

# Terminal 4 — Frontend
cd frontend
npm run dev
```

## Feature Phases

| Phase | Feature | Status |
|-------|---------|--------|
| 1 | Text chat | ✅ |
| 2 | Microphone recording | ✅ |
| 3 | Speech-to-Text (Whisper) | ✅ |
| 4 | AI responses (Ollama streaming) | ✅ |
| 5 | Text-to-Speech (Piper) | ✅ |
| 6 | Conversation history (SQLite) | ✅ |

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Service health check |
| GET | `/api/conversations` | List conversations |
| POST | `/api/conversations` | Create conversation |
| GET | `/api/conversations/:id` | Get with messages |
| PATCH | `/api/conversations/:id` | Rename |
| DELETE | `/api/conversations/:id` | Delete |
| POST | `/api/conversations/:id/messages` | Send text message |
| POST | `/api/audio/transcribe` | Upload audio → transcript |
| POST | `/api/audio/synthesize` | Text → audio file |
| POST | `/api/audio/voice-message?conversationId=X` | Full voice pipeline |
| GET | `/api/audio/files/:file` | Serve audio file |

**WebSocket:** `ws://localhost:3001/ws?conversationId=<id>`

Events: `message_new`, `token`, `message_complete`, `error`, `ping`

## Environment Variables

Copy `backend/.env.example` → `backend/.env` and adjust:

```env
OLLAMA_MODEL=qwen3:8b          # Any model installed in Ollama
PIPER_EXE_PATH=C:/piper/piper.exe
PIPER_MODEL_PATH=C:/piper/models/en_US-lessac-medium.onnx
WHISPER_MODEL=base              # tiny/base/small/medium/large (set in stt-server)
```

## Whisper Model Size

Set `WHISPER_MODEL` env var before starting the STT server:

| Model | Size | Speed | Accuracy |
|-------|------|-------|----------|
| tiny | 75 MB | fastest | low |
| base | 145 MB | fast | good |
| small | 466 MB | medium | better |
| medium | 1.5 GB | slow | high |

## Project Structure

```
AI VoiceBot/
├── backend/src/
│   ├── config/         # Env validation, constants
│   ├── domain/         # Entities + repository interfaces
│   ├── infrastructure/ # SQLite, Ollama, Whisper, Piper clients
│   ├── application/    # Business logic services
│   ├── api/            # Fastify routes + WebSocket hub
│   └── container.ts    # Dependency injection
├── frontend/src/
│   ├── components/     # React UI components
│   ├── hooks/          # useAudioRecorder, useConversation, useWebSocket
│   ├── services/       # API client, WebSocket service
│   └── store/          # Zustand global state
├── stt-server/         # Python FastAPI + faster-whisper
└── scripts/            # PowerShell setup + dev launchers
```
