"""
NeoLeadge Meeting Transcription Service
Whisper (multilingual) + Speaker Diarization
Supports: Tunisian Arabic, French, English
"""

import os

# Must be set before any HuggingFace imports to avoid symlink errors on Windows
os.environ["HF_HUB_DISABLE_SYMLINKS"] = "1"
import tempfile
import logging
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from transcriber import TranscriptionService

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Max upload size: 100 MB
MAX_UPLOAD_BYTES = 100 * 1024 * 1024

# Initialize service (loaded during startup)
transcription_service: TranscriptionService | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load ML models on startup, cleanup on shutdown."""
    global transcription_service
    model_size = os.environ.get("WHISPER_MODEL", "large-v3")
    device = os.environ.get("DEVICE", "cpu")  # "cpu" or "cuda"
    compute_type = os.environ.get("COMPUTE_TYPE", "int8")  # "int8" for CPU, "float16" for GPU
    logger.info(f"Loading models: whisper={model_size}, device={device}, compute={compute_type}")
    transcription_service = TranscriptionService(
        model_size=model_size,
        device=device,
        compute_type=compute_type,
    )
    logger.info("Models loaded successfully")
    yield
    # shutdown — nothing to clean up


app = FastAPI(
    title="NeoLeadge Transcription Service",
    description="Audio transcription with speaker diarization — Arabic (Tunisian), French, English",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class TranscriptSegment(BaseModel):
    speaker: str  # "Speaker 1", "Speaker 2", etc.
    text: str
    start_time: float  # seconds
    end_time: float
    language: str  # "fr", "ar", "en"
    confidence: float


class TranscriptResponse(BaseModel):
    duration_seconds: float
    detected_languages: list[str]
    speaker_count: int
    segments: list[TranscriptSegment]
    full_text: str


class HealthResponse(BaseModel):
    status: str
    models_loaded: bool
    supported_languages: list[str]


ALLOWED_EXTENSIONS = {".mp3", ".wav", ".webm", ".ogg", ".m4a", ".mp4", ".flac"}


@app.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(
        status="ok",
        models_loaded=transcription_service is not None,
        supported_languages=["ar", "fr", "en"],
    )


@app.post("/transcribe", response_model=TranscriptResponse)
async def transcribe(audio: UploadFile = File(...)):
    if transcription_service is None:
        raise HTTPException(503, "Service not ready — models still loading")

    # Validate file type
    ext = Path(audio.filename or "audio.webm").suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            400,
            f"Format non supporte. Formats acceptes : {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    # Read content with size check
    content = await audio.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            413,
            f"Fichier trop volumineux. Taille maximale : {MAX_UPLOAD_BYTES // (1024 * 1024)} Mo.",
        )

    # Save to temp file (Whisper needs a file path)
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        result = transcription_service.transcribe(tmp_path)
        return result
    except Exception as e:
        logger.error(f"Transcription failed: {e}", exc_info=True)
        raise HTTPException(500, f"Erreur de transcription : {str(e)}")
    finally:
        os.unlink(tmp_path)
