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

## API

### POST /transcribe
Upload audio file, get transcript with speaker labels.

```bash
curl -X POST http://localhost:8000/transcribe \
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
