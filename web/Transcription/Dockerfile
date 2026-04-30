FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for audio processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Run as a non-root user — limits blast radius of any RCE via ffmpeg/torchaudio.
# /app/.cache is the cache root for HuggingFace + speechbrain downloads. We
# create + chown it BEFORE the volume mount so the named volume inherits
# nonroot ownership instead of root.
RUN addgroup --system nonroot && adduser --system --ingroup nonroot nonroot \
    && mkdir -p /app/.cache \
    && chown -R nonroot:nonroot /app
USER nonroot

COPY --chown=nonroot:nonroot . .

# Download models on build (optional, speeds up first request)
# RUN python -c "from faster_whisper import WhisperModel; WhisperModel('large-v3', device='cpu', compute_type='int8')"

EXPOSE 8000

# SECURITY NOTE (Sprint 7 lockdown):
# -----------------------------------------------------------------------------
# This container MUST be run on an isolated internal network only. The
# container listens on 0.0.0.0 because inside a container the loopback
# interface is not reachable from the host, but the service itself enforces:
#   1. A shared-secret header (TRANSCRIPTION_SECRET, required at startup).
#   2. A locked CORS origin (ALLOWED_ORIGIN, default http://localhost:5122).
#   3. A 100 MB upload cap + magic-bytes sniffing.
#
# When deploying:
#   * NEVER publish port 8000 to the public internet (no `-p 0.0.0.0:8000:8000`).
#     Bind to loopback only (`-p 127.0.0.1:8000:8000`) or keep it on a private
#     Docker network shared with the NestJS backend.
#   * ALWAYS pass a strong TRANSCRIPTION_SECRET via `-e` or a secrets manager.
# -----------------------------------------------------------------------------
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
