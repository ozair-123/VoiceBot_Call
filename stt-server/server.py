"""
Faster-Whisper HTTP transcription server.
Runs at http://localhost:8001
"""
from __future__ import annotations

import os
import tempfile
import time
import logging
from pathlib import Path

import uvicorn
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse
from faster_whisper import WhisperModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

MODEL_SIZE = os.getenv("WHISPER_MODEL", "base")
DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
HOST = os.getenv("WHISPER_HOST", "0.0.0.0")
PORT = int(os.getenv("WHISPER_PORT", "8001"))

app = FastAPI(title="Faster-Whisper STT Server", version="1.0.0")
model: WhisperModel | None = None


@app.on_event("startup")
def load_model() -> None:
    global model
    logger.info(f"Loading Whisper model '{MODEL_SIZE}' on {DEVICE} ({COMPUTE_TYPE})…")
    model = WhisperModel(MODEL_SIZE, device=DEVICE, compute_type=COMPUTE_TYPE)
    logger.info("Whisper model loaded.")


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "model": MODEL_SIZE, "device": DEVICE}


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)) -> JSONResponse:
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded yet")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty audio file")

    suffix = Path(file.filename or "audio.webm").suffix or ".webm"

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        start = time.monotonic()
        segments, info = model.transcribe(tmp_path, beam_size=5, vad_filter=True)
        text = " ".join(seg.text.strip() for seg in segments).strip()
        elapsed_ms = int((time.monotonic() - start) * 1000)

        logger.info(f"Transcribed {len(content)} bytes in {elapsed_ms}ms: {text[:80]!r}")

        return JSONResponse({
            "text": text,
            "language": info.language,
            "language_probability": round(info.language_probability, 3),
            "duration_ms": elapsed_ms,
        })
    finally:
        os.unlink(tmp_path)


if __name__ == "__main__":
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
