"""
NeoLeadge Meeting Transcription Service
Whisper (multilingual) + Speaker Diarization
Supports: Tunisian Arabic, French, English

Security notes (Sprint 7 lockdown):
    * Binds to 127.0.0.1 by default (see run.bat / run.sh).
    * Requires a shared secret via the `X-Transcription-Secret` header.
    * CORS is locked to a single trusted origin (the NestJS backend).
    * Upload size capped at 100 MB with magic-bytes sniffing.
    * Whisper inference runs in an executor under a module-level lock.
"""

import os

# Must be set before any HuggingFace imports to avoid symlink errors on Windows
os.environ["HF_HUB_DISABLE_SYMLINKS"] = "1"
import asyncio
import tempfile
import logging
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, UploadFile, File, HTTPException, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from transcriber import TranscriptionService

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── Security configuration ───────────────────────────────────────────────────
# Shared secret required on every /transcribe call. Fail fast at import time
# so the service never boots in an unauthenticated state.
TRANSCRIPTION_SECRET: str = os.environ.get("TRANSCRIPTION_SECRET", "").strip()
if not TRANSCRIPTION_SECRET:
    raise RuntimeError(
        "TRANSCRIPTION_SECRET environment variable is required. "
        "Set it to a random string of at least 32 characters before starting the service."
    )

# CORS origin — the NestJS backend at port 5122 by default.
ALLOWED_ORIGIN: str = os.environ.get("ALLOWED_ORIGIN", "http://localhost:5122")

# Max upload size: 100 MB
MAX_UPLOAD_BYTES: int = 100 * 1024 * 1024

# Single-flight lock around the Whisper model to avoid concurrent GPU/CPU
# contention. One transcription at a time per process.
_model_lock: asyncio.Lock = asyncio.Lock()
# Separate lock for the embedding model so /transcribe and /embed can run
# in parallel. Embedding inference is fast (~30ms / 200 tokens on CPU) but
# we still serialise per-model to avoid loading thrash under burst load.
_embed_lock: asyncio.Lock = asyncio.Lock()

# Initialize service (loaded during startup)
transcription_service: TranscriptionService | None = None
# Lazily-loaded embedding model (multilingual-e5-small ~110 MB).
# Loaded once in lifespan(); a single SentenceTransformer instance shared
# across requests is the supported usage pattern of the library.
embedding_model = None
EMBED_MODEL_NAME: str = os.environ.get("EMBED_MODEL", "intfloat/multilingual-e5-small")
EMBED_DIM: int = 384  # multilingual-e5-small output dimension


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load ML models on startup, cleanup on shutdown."""
    global transcription_service, embedding_model
    model_size = os.environ.get("WHISPER_MODEL", "large-v3")
    device = os.environ.get("DEVICE", "cpu")  # "cpu" or "cuda"
    compute_type = os.environ.get("COMPUTE_TYPE", "int8")  # "int8" for CPU, "float16" for GPU
    logger.info(f"Loading models: whisper={model_size}, device={device}, compute={compute_type}")
    transcription_service = TranscriptionService(
        model_size=model_size,
        device=device,
        compute_type=compute_type,
    )

    # Phase 4 — multilingual-e5-small for cahier semantic retrieval.
    # Lazy import so the transcription service still boots even if
    # sentence-transformers isn't installed yet (e.g. during the
    # incremental rollout window).
    if os.environ.get("EMBED_ENABLED", "true").lower() != "false":
        try:
            from sentence_transformers import SentenceTransformer  # type: ignore[import-not-found]
            logger.info(f"Loading embedding model: {EMBED_MODEL_NAME}")
            embedding_model = SentenceTransformer(EMBED_MODEL_NAME, device=device)
            # Warm-up: first encode call triggers JIT/model materialisation.
            # Cost is amortised at boot rather than billed to the first user.
            embedding_model.encode(["passage: warmup"], convert_to_numpy=True, normalize_embeddings=True)
            logger.info("Embedding model loaded and warmed")
        except ImportError:
            logger.warning("sentence-transformers not installed — /embed endpoint will return 503")
        except Exception as exc:  # pragma: no cover — startup-time only
            logger.exception(f"Embedding model failed to load: {exc}")
            embedding_model = None

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
    allow_origins=[ALLOWED_ORIGIN],
    allow_methods=["POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-Transcription-Secret"],
)


# ── Embedding request/response models ──────────────────────────────────────


class EmbedRequest(BaseModel):
    texts: list[str]
    # e5-family models expect `passage: ` / `query: ` prefixes for asymmetric
    # retrieval. Wired through the API; the NestJS client picks `passage`
    # when indexing and `query` when an agent searches.
    input_type: str = "passage"


class EmbedResponse(BaseModel):
    embeddings: list[list[float]]
    model: str
    dim: int


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
    # Kept for backwards-compatibility; True only when BOTH models are loaded.
    models_loaded: bool
    whisper_loaded: bool
    diarization_loaded: bool
    supported_languages: list[str]


ALLOWED_EXTENSIONS = {".mp3", ".wav", ".webm", ".ogg", ".m4a", ".mp4", ".flac"}


def _sniff_audio_magic_bytes(data: bytes) -> bool:
    """Verify the first bytes match a known audio/video container header.

    Returns True if the payload looks like one of the allowed formats,
    False otherwise. Intentionally conservative — false negatives are
    acceptable (caller returns 415), false positives are not.
    """
    if len(data) < 12:
        return False

    header = data[:12]

    # WAV — "RIFF....WAVE"
    if header[0:4] == b"RIFF" and header[8:12] == b"WAVE":
        return True
    # MP3 — ID3 tag, or MPEG sync frame (0xFFFB / 0xFFF3 / 0xFFFA / 0xFFF2)
    if header[0:3] == b"ID3":
        return True
    if header[0] == 0xFF and (header[1] & 0xE0) == 0xE0:
        return True
    # OGG / Opus — "OggS"
    if header[0:4] == b"OggS":
        return True
    # WebM / Matroska — EBML header
    if header[0:4] == b"\x1a\x45\xdf\xa3":
        return True
    # FLAC — "fLaC"
    if header[0:4] == b"fLaC":
        return True
    # MP4 / M4A — "....ftyp...."
    if header[4:8] == b"ftyp":
        return True

    return False


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    whisper_ok = transcription_service is not None
    diarization_ok = (
        transcription_service is not None
        and transcription_service._embedding_model is not None
    )
    return HealthResponse(
        status="ok",
        models_loaded=whisper_ok and diarization_ok,
        whisper_loaded=whisper_ok,
        diarization_loaded=diarization_ok,
        supported_languages=["ar", "fr", "en"],
    )


@app.post("/transcribe", response_model=TranscriptResponse)
async def transcribe(
    request: Request,
    audio: UploadFile = File(...),
    x_transcription_secret: str | None = Header(default=None, alias="X-Transcription-Secret"),
) -> TranscriptResponse:
    # 1. Shared-secret auth — reject anything that doesn't match.
    if not x_transcription_secret or x_transcription_secret != TRANSCRIPTION_SECRET:
        raise HTTPException(401, "Unauthorized")

    if transcription_service is None:
        raise HTTPException(503, "Service not ready — models still loading")

    # 2. Up-front Content-Length guard — cheap rejection for oversize uploads.
    content_length_header = request.headers.get("content-length")
    if content_length_header is not None:
        try:
            content_length = int(content_length_header)
        except ValueError:
            raise HTTPException(400, "Invalid Content-Length header")
        if content_length > MAX_UPLOAD_BYTES:
            raise HTTPException(
                413,
                f"Fichier trop volumineux. Taille maximale : {MAX_UPLOAD_BYTES // (1024 * 1024)} Mo.",
            )

    # 3. Validate extension before reading any bytes.
    ext = Path(audio.filename or "audio.webm").suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            400,
            f"Format non supporte. Formats acceptes : {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    # 4. Stream-read in chunks with a hard byte cap (defence in depth against
    #    a spoofed Content-Length or chunked-encoding client).
    chunks: list[bytes] = []
    total_bytes = 0
    chunk_size = 1024 * 1024  # 1 MB
    while True:
        chunk = await audio.read(chunk_size)
        if not chunk:
            break
        total_bytes += len(chunk)
        if total_bytes > MAX_UPLOAD_BYTES:
            raise HTTPException(
                413,
                f"Fichier trop volumineux. Taille maximale : {MAX_UPLOAD_BYTES // (1024 * 1024)} Mo.",
            )
        chunks.append(chunk)
    content = b"".join(chunks)

    # 5. Magic-bytes sniff — reject payloads whose extension and header disagree.
    if not _sniff_audio_magic_bytes(content):
        raise HTTPException(415, "Contenu audio non reconnu.")

    # 6. Persist to a temp file — Whisper needs a path.
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        # 7. Run the blocking Whisper pipeline in an executor, serialised by a
        #    single module-level lock so concurrent requests never race on the
        #    underlying WhisperModel.
        async with _model_lock:
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                None,
                lambda: transcription_service.transcribe(tmp_path),
            )
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Transcription failed: {e}", exc_info=True)
        # 8. Never leak the stack / internal error text to clients.
        raise HTTPException(500, "Erreur de transcription interne.")
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            logger.warning(f"Failed to clean up temp file: {tmp_path}")


# ── /embed — sentence-transformers inference ────────────────────────────────


# Hard caps to keep one call bounded. A 64-text batch at ~30ms each on CPU
# is ~2 seconds — fine for an agent tool call. Per-text length is capped
# because e5-small was trained on ≤512 tokens; we slice generously at 2000
# chars (~500 tokens worst-case) and let the model truncate internally.
MAX_EMBED_BATCH: int = 64
MAX_EMBED_TEXT_CHARS: int = 2000


@app.post("/embed", response_model=EmbedResponse)
async def embed(
    payload: EmbedRequest,
    x_transcription_secret: str | None = Header(default=None, alias="X-Transcription-Secret"),
) -> EmbedResponse:
    """Embed up to MAX_EMBED_BATCH texts in one call.

    Auth: same shared secret as /transcribe. The endpoint is internal-only
    (called by NestJS over the docker network) so we don't expose it via the
    public CORS allowlist — only the backend can reach it.

    `input_type` controls the e5 prefix:
      - "passage" (default) — indexing path (segments, field values).
      - "query"             — agent search-time path.
    Mixing prefixes degrades cosine similarity; callers MUST be consistent.
    """
    # 1. Auth — same gate as /transcribe.
    if not x_transcription_secret or x_transcription_secret != TRANSCRIPTION_SECRET:
        raise HTTPException(401, "Unauthorized")

    # 2. Service availability — startup may have failed (no sentence-transformers).
    if embedding_model is None:
        raise HTTPException(503, "Embedding model not loaded")

    # 3. Validate the request — fail fast with clear messages.
    if not isinstance(payload.texts, list):
        raise HTTPException(400, "texts must be a list")
    if len(payload.texts) == 0:
        return EmbedResponse(embeddings=[], model=EMBED_MODEL_NAME, dim=EMBED_DIM)
    if len(payload.texts) > MAX_EMBED_BATCH:
        raise HTTPException(400, f"batch too large: max {MAX_EMBED_BATCH}")
    if payload.input_type not in ("passage", "query"):
        raise HTTPException(400, "input_type must be 'passage' or 'query'")

    # 4. e5 family expects an asymmetric prefix on each text. Strip whitespace
    #    + cap length here rather than letting the tokenizer silently truncate.
    prefix = f"{payload.input_type}: "
    prepared: list[str] = []
    for raw in payload.texts:
        if not isinstance(raw, str):
            raise HTTPException(400, "every text must be a string")
        clean = raw.strip()[:MAX_EMBED_TEXT_CHARS]
        if not clean:
            # Empty input → zero vector. Caller can filter; we won't refuse
            # the whole batch over one bad row.
            prepared.append(prefix)
            continue
        prepared.append(prefix + clean)

    # 5. Run inference under the embed-specific lock. CPU-bound — push to
    #    the default executor so we don't block the event loop.
    async with _embed_lock:
        loop = asyncio.get_event_loop()
        try:
            vectors = await loop.run_in_executor(
                None,
                lambda: embedding_model.encode(  # type: ignore[union-attr]
                    prepared,
                    convert_to_numpy=True,
                    normalize_embeddings=True,  # cosine-distance ready
                    batch_size=min(MAX_EMBED_BATCH, len(prepared)),
                    show_progress_bar=False,
                ),
            )
        except Exception as exc:
            logger.exception(f"Embedding inference failed: {exc}")
            raise HTTPException(500, "Embedding inference failed")

    return EmbedResponse(
        embeddings=[v.tolist() for v in vectors],
        model=EMBED_MODEL_NAME,
        dim=EMBED_DIM,
    )
