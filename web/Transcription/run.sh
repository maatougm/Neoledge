#!/bin/bash
set -euo pipefail

echo "=== NeoLeadge Transcription Service ==="
echo ""
echo "Installing dependencies..."
pip install -r requirements.txt
echo ""
echo "Starting service on http://127.0.0.1:8000 (loopback only)"
echo ""
echo "Supported languages: Tunisian Arabic, French, English"
echo "Model: whisper-large-v3 (auto-downloads on first run)"
echo ""

# Bind to the loopback interface only — the service must never be exposed
# on a public / LAN interface. The NestJS backend proxies every call.
export WHISPER_MODEL=large-v3
export DEVICE=cpu
export COMPUTE_TYPE=int8

# TRANSCRIPTION_SECRET is REQUIRED. Generate a strong random value, e.g.:
#   openssl rand -hex 32
# and set it in your environment (or copy it into the matching NestJS .env).
if [ -z "${TRANSCRIPTION_SECRET:-}" ]; then
    echo ""
    echo "[ERROR] TRANSCRIPTION_SECRET is not set. Refusing to start."
    echo "        Set it in the environment before running this script."
    exit 1
fi

# Optional: override the allowed CORS origin (defaults to http://localhost:5122)
# export ALLOWED_ORIGIN=http://localhost:5122

uvicorn app:app --host 127.0.0.1 --port 8000
