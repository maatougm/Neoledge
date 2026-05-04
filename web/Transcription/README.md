# NeoLeadge Transcription Service

Local AI-powered meeting transcription with automatic speaker diarization.

## Supported Languages
- **Tunisian Arabic (Derja)** -- dialectal North African Arabic
- **French**
- **English**
- Mixed-language conversations (code-switching between languages)

## How It Works
1. Upload audio file (MP3, WAV, WebM, OGG, M4A, FLAC, MP4)
2. **Whisper large-v3** transcribes speech to text (auto-detects language)
3. **Speaker diarization** (speechbrain ECAPA-TDNN) identifies different speakers
4. Returns timestamped, speaker-labeled transcript segments as JSON

## Quick Start

### Windows
```bat
run.bat
```

### Linux/Mac
```bash
chmod +x run.sh
./run.sh
```

### Docker
```bash
docker build -t neoleadge-transcription .
docker run -p 8000:8000 neoleadge-transcription
```

## Security (Sprint 7 lockdown)

This service is intended to be called **only** by the NestJS backend on the
same host. It enforces:

- **Loopback binding** — `run.bat` and `run.sh` start uvicorn on
  `127.0.0.1:8000`. Do not change this unless you also place the service on
  a private / firewalled network.
- **Shared-secret auth** — every `POST /transcribe` must include the header
  `X-Transcription-Secret: <value>`, matching the `TRANSCRIPTION_SECRET`
  environment variable. The service **refuses to start** if the env var is
  unset or empty.
- **CORS lock** — only the origin in `ALLOWED_ORIGIN` (default
  `http://localhost:5122`) is permitted, restricted to `POST` and `OPTIONS`.
- **Upload guard** — 100 MB hard cap (Content-Length header + streaming
  check) and magic-bytes sniffing on the uploaded file.
- **Error hygiene** — 500 responses carry a generic message; full stack
  traces only go to server logs.

### Required environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TRANSCRIPTION_SECRET` | **yes** | Random string (32+ chars). Must match the value in the NestJS `.env`. |
| `ALLOWED_ORIGIN` | no | CORS origin, default `http://localhost:5122`. |

Generate a secret with either of:

```bash
# macOS / Linux / Git Bash
openssl rand -hex 32

# Windows PowerShell
powershell -c "[Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))"
```

## API

### POST /transcribe
Upload audio file, get transcript with speaker labels.

```bash
curl -X POST http://127.0.0.1:8000/transcribe \
  -H "X-Transcription-Secret: $TRANSCRIPTION_SECRET" \
  -F "audio=@meeting.mp3"
```

Response:
```json
{
  "duration_seconds": 120.5,
  "detected_languages": ["fr"],
  "speaker_count": 2,
  "segments": [
    {
      "speaker": "Speaker 1",
      "text": "Bonjour, on commence la reunion.",
      "start_time": 0.5,
      "end_time": 3.2,
      "language": "fr",
      "confidence": 0.92
    }
  ],
  "full_text": "Bonjour, on commence la reunion. ..."
}
```

### GET /health
Check service status and model readiness.

## Environment Variables
| Variable | Default | Description |
|----------|---------|-------------|
| WHISPER_MODEL | large-v3 | Whisper model size (tiny, base, small, medium, large-v3) |
| DEVICE | cpu | Device (cpu or cuda for GPU) |
| COMPUTE_TYPE | int8 | Quantization (int8 for CPU, float16 for GPU) |

## GPU Acceleration
For faster transcription with a CUDA GPU:
```bash
DEVICE=cuda COMPUTE_TYPE=float16 uvicorn app:app --host 0.0.0.0 --port 8000
```

## Model Sizes
| Model | VRAM | Speed | Accuracy |
|-------|------|-------|----------|
| tiny | ~1GB | Very fast | Low |
| base | ~1GB | Fast | OK |
| small | ~2GB | Medium | Good |
| medium | ~5GB | Slow | Very good |
| large-v3 | ~10GB | Slowest | Best (recommended for Arabic) |

For Tunisian Arabic, **large-v3 is strongly recommended** as it has the best dialectal Arabic support.
