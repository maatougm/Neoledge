#!/bin/bash
echo "=== NeoLeadge Transcription Service ==="
echo ""
echo "Installing dependencies..."
pip install -r requirements.txt
echo ""
echo "Starting service on http://localhost:8000"
echo ""
echo "Supported languages: Tunisian Arabic, French, English"
echo "Model: whisper-large-v3 (auto-downloads on first run)"
echo ""
export WHISPER_MODEL=large-v3
export DEVICE=cpu
export COMPUTE_TYPE=int8
uvicorn app:app --host 0.0.0.0 --port 8000
