# Python Transcription Service — Line-by-Line QA

Files opened:
- `web/Transcription/app.py` (134 lines, read in full)
- `web/Transcription/transcriber.py` (249 lines, read in full)
- `web/Transcription/requirements.txt` (10 lines, read in full)
- `web/Transcription/Dockerfile` (22 lines, read in full)
- `web/Transcription/run.bat` (16 lines, read in full)
- `web/Transcription/run.sh` (16 lines, read in full)
- `web/Transcription/README.md` (92 lines, read in full)

Scope: Read-only QA. No files modified.

---

### [CRITICAL] `POST /transcribe` has zero authentication — open to anyone who can reach the port
- File: `web/Transcription/app.py:100-101`
- Category: auth
- Evidence:
```python
@app.post("/transcribe", response_model=TranscriptResponse)
async def transcribe(audio: UploadFile = File(...)):
```
- Impact: The FastAPI app declares no auth dependency, no API-key header check, no JWT verification, no shared-secret, and no IP allow-list. The NestJS backend proxies to this service (`TRANSCRIPTION_URL=http://localhost:8000`) trusting it, but if the service is ever bound to `0.0.0.0` (which `run.bat:15`, `run.sh:15`, and `Dockerfile:21` all do), anyone routable to that port gets free GPU/CPU + Whisper large-v3 inference. Combined with `allow_origins=["*"]` (`app.py:59`) a malicious browser tab on any origin can POST audio from the victim's LAN. This is the root cause of many of the DoS issues below — they would be mitigated by an auth layer that at least rate-limits per identity.
- Fix: Add a FastAPI dependency that validates a shared secret header (e.g. `X-Internal-Token`) against an env var like `TRANSCRIPTION_INTERNAL_TOKEN`, applied via `Depends(...)` to `/transcribe`. Have the NestJS `MeetingsService` forward that header. Also bind only to `127.0.0.1` for the non-Docker launchers.

---

### [CRITICAL] Host binds to `0.0.0.0` in every launcher — exposes the whole LAN/internet
- File: `web/Transcription/run.bat:15`, `web/Transcription/run.sh:15`, `web/Transcription/Dockerfile:21`
- Category: auth
- Evidence:
```bash
uvicorn app:app --host 0.0.0.0 --port 8000
```
```dockerfile
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
```
- Impact: `0.0.0.0` listens on every network interface — including Wi-Fi, VPN, and any routed interface. Combined with the missing auth (CRITICAL above), any host on the same network can submit arbitrary audio for transcription, DoS the service, or exploit ffmpeg/torchaudio parser vulnerabilities. The `CLAUDE.md` `.env` shows the NestJS backend contacts it at `http://localhost:8000` — so binding externally is gratuitous.
- Fix: Change `run.bat` and `run.sh` to `--host 127.0.0.1`. The Docker image can stay `0.0.0.0` inside the container but must be run with `-p 127.0.0.1:8000:8000` (not `-p 8000:8000` as README.md:33 suggests) to avoid exposing publicly.

---

### [CRITICAL] `allow_origins=["*"]` with no credentials restriction and no auth
- File: `web/Transcription/app.py:57-62`
- Category: auth
- Evidence:
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
```
- Impact: Paired with the missing auth above, any webpage the user visits can `fetch('http://localhost:8000/transcribe', {method:'POST', body: formData})` from the victim's browser against their local service, burning CPU/GPU and potentially exfiltrating transcripts of whatever audio the attacker's page feeds in. Even without `allow_credentials=True`, the wildcard on `allow_methods`/`allow_headers` makes cross-origin POSTs trivial. This is a classic drive-by DoS / SSRF-via-browser vector for a local AI service.
- Fix: Restrict `allow_origins` to the exact frontend origins (`http://localhost:5173`, prod frontend URL). Drop `allow_methods=["*"]` to only `["POST","GET"]`. The transcription service should not be reached from browsers at all — only from the NestJS backend — so ideally remove CORS entirely and let NestJS proxy.

---

### [HIGH] Entire upload buffered into RAM before size check — 100 MB * N concurrent = easy OOM
- File: `web/Transcription/app.py:114-119`
- Category: dos
- Evidence:
```python
    # Read content with size check
    content = await audio.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            413,
            f"Fichier trop volumineux. Taille maximale : {MAX_UPLOAD_BYTES // (1024 * 1024)} Mo.",
        )
```
- Impact: `audio.read()` pulls the whole multipart body into memory first, *then* the size is validated. An attacker can send a `Content-Length: 10000000000` request and Starlette/FastAPI will buffer it (spilling to `/tmp` but still counting against memory during Starlette's `SpooledTemporaryFile` rolloff). Worse, there is no pre-read `Content-Length` guard, no `MAX_UPLOAD_BYTES` enforcement via Starlette/uvicorn `--limit-request-body`, and no concurrency cap — `N` parallel 100 MB uploads consume `N * 100 MB` RAM, trivially taking the service down on a CPU-only box that also needs ~4 GB for Whisper large-v3.
- Fix: Stream to a `NamedTemporaryFile` in a `while chunk := await audio.read(1024*1024):` loop, summing bytes and aborting + `os.unlink` as soon as the cumulative total exceeds `MAX_UPLOAD_BYTES`. Also set uvicorn `--limit-concurrency 2` or put a semaphore around `/transcribe` to cap parallel inference.

---

### [HIGH] No bound on in-memory decoded audio — a 100 MB compressed FLAC/OGG can decode to gigabytes
- File: `web/Transcription/transcriber.py:147-157`
- Category: dos
- Evidence:
```python
            waveform, sample_rate = torchaudio.load(audio_path)

            # Convert to mono if stereo
            if waveform.shape[0] > 1:
                waveform = waveform.mean(dim=0, keepdim=True)

            # Resample to 16kHz if needed
            if sample_rate != 16000:
                resampler = torchaudio.transforms.Resample(sample_rate, 16000)
                waveform = resampler(waveform)
                sample_rate = 16000
```
- Impact: Upload is capped at 100 MB on the wire, but `torchaudio.load` decodes to uncompressed PCM in RAM. A 100 MB Opus/OGG stream at high compression can decode to **multi-GB float tensors**, and the mono/resample operations each duplicate. The text says "memory blowup on 10GB audio" — that's achievable from a sub-100 MB upload because of the compression ratio. Whisper's own internal decode (`self._model.transcribe(audio_path, ...)` in `transcriber.py:67`) happens separately, doubling memory pressure.
- Fix: Before `torchaudio.load`, use `torchaudio.info(audio_path)` to read `num_frames / sample_rate` and reject anything over a duration cap (e.g. 2 hours). Additionally, probe via `ffprobe` to get declared duration + bitrate and reject mismatches between declared duration and file size (compression bomb detection).

---

### [HIGH] No audio-format / magic-byte validation — extension check is trivially spoofable
- File: `web/Transcription/app.py:88,106-111`
- Category: validation
- Evidence:
```python
ALLOWED_EXTENSIONS = {".mp3", ".wav", ".webm", ".ogg", ".m4a", ".mp4", ".flac"}
...
    ext = Path(audio.filename or "audio.webm").suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            400,
            f"Format non supporte. Formats acceptes : {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )
```
- Impact: The check relies on the client-supplied filename suffix. Any attacker can name an arbitrary binary `payload.mp3`. `torchaudio.load` then pipes the bytes into ffmpeg/libsndfile, which have had parser CVEs historically. Since the service runs as root inside the Docker image (no `USER` directive in `Dockerfile`), a successful ffmpeg RCE gets root in the container.
- Fix: Validate magic bytes (e.g. with `python-magic` or a manual header check) and reject files whose detected MIME type doesn't match the extension. Also add `USER nobody` (or create a non-root user) in the Dockerfile.

---

### [HIGH] Tempfile leaks on process kill / uncaught signal — disk fill over time
- File: `web/Transcription/app.py:122-133`
- Category: dos
- Evidence:
```python
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
```
- Impact: The `finally` covers normal and exception paths — good. But if the process is SIGKILL'd, the worker crashes, or `os.unlink` itself fails (e.g. transient AV lock on Windows), the file stays forever. Because `delete=False` is used and the suffix is attacker-controlled (`ext` derives from `audio.filename`), an attacker who can crash the worker mid-request fills `%TEMP%` with 100 MB files until the disk is full. There is no periodic reaper and no per-tempdir quota.
- Fix: Write to a dedicated directory like `./tmp_uploads/` and run a startup sweep that deletes entries older than 1 hour. Wrap `os.unlink` in `try/except` and log failures loudly. Consider using a `with tempfile.NamedTemporaryFile(delete=True)` and passing `tmp.name` into Whisper before closing — requires some restructuring.

---

### [HIGH] Whisper inference runs on the asyncio event loop thread — one long request blocks all others
- File: `web/Transcription/app.py:100-128`, `web/Transcription/transcriber.py:59-134`
- Category: dos
- Evidence:
```python
@app.post("/transcribe", response_model=TranscriptResponse)
async def transcribe(audio: UploadFile = File(...)):
...
    try:
        result = transcription_service.transcribe(tmp_path)
        return result
```
- Impact: The handler is `async def`, but `transcription_service.transcribe` is a CPU-bound synchronous call that may run for minutes on a 100 MB audio. Because it's called directly (not via `run_in_threadpool`/`asyncio.to_thread`), it pins the single uvicorn worker's event loop. `/health` and every other request queue behind it. In practice this causes "Service not ready — models still loading" UX glitches and trivial DoS — one crafted large file stalls everyone. Combined with no model-access lock, two concurrent heavy requests on a single WhisperModel instance are also unsafe (see next item).
- Fix: Wrap in `result = await asyncio.to_thread(transcription_service.transcribe, tmp_path)` and add a module-level `asyncio.Semaphore(1)` to serialize Whisper calls.

---

### [HIGH] `WhisperModel` instance shared across requests with no lock — concurrent calls are undefined behavior
- File: `web/Transcription/transcriber.py:28,67`
- Category: dos
- Evidence:
```python
        self._model = WhisperModel(model_size, device=device, compute_type=compute_type)
...
        segments_iter, info = self._model.transcribe(
            audio_path,
            language=None,
            ...
        )
```
- Impact: `faster-whisper`'s `WhisperModel.transcribe` is not documented as thread-safe. With a single `TranscriptionService` loaded in `lifespan` (singleton — good) but no mutex, two overlapping requests share CTranslate2 decoder state — risking garbled output, GPU memory corruption on CUDA, or crashes. On CPU with `int8` it tends to degrade silently; on CUDA/`float16` it's a crash waiting to happen.
- Fix: Add a `threading.Lock` (or the async semaphore above) around the `self._model.transcribe(...)` call. One inference at a time is the documented safe mode.

---

### [HIGH] Internal exception string leaked verbatim in HTTP 500 response
- File: `web/Transcription/app.py:129-131`
- Category: secret
- Evidence:
```python
    except Exception as e:
        logger.error(f"Transcription failed: {e}", exc_info=True)
        raise HTTPException(500, f"Erreur de transcription : {str(e)}")
```
- Impact: Any internal error — model loading path, filesystem path, ffmpeg command line, CUDA device info, HuggingFace cache directory, sometimes even stack-frame locals when `__str__` is overridden — is serialized back to the HTTP client. For example `torchaudio` errors often include the absolute path `C:/Users/BigPoppa/Desktop/neoleadge/web/Transcription/...` or the HF token if one is set. This leaks server filesystem layout and potentially secrets.
- Fix: Return a generic message (`"Internal transcription error"`) to clients. Keep the detailed error only in `logger.error(..., exc_info=True)` on the server side.

---

### [MEDIUM] Tempfile suffix is attacker-controlled — mild filename-injection vector
- File: `web/Transcription/app.py:106,122`
- Category: injection
- Evidence:
```python
    ext = Path(audio.filename or "audio.webm").suffix.lower()
...
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
```
- Impact: `ext` comes from the client. It is whitelisted against `ALLOWED_EXTENSIONS`, which eliminates most shell-meta attacks. However, `Path(...).suffix` of a filename like `"audio.tar.gz"` returns `".gz"` (so that's rejected), but `"audio.webm\x00.exe"` can have non-ASCII content that survives `.lower()`. Since the suffix is interpolated into a filename later passed to `torchaudio.load`, and `torchaudio` shells out to ffmpeg internally, any odd char that survives the whitelist is theoretically problematic. In practice the whitelist is tight enough that this is low-likelihood — but defense in depth should sanitize anyway.
- Fix: Use a fixed suffix per detected MIME type after magic-byte detection instead of trusting the client filename.

---

### [MEDIUM] Path-traversal vector via `audio.filename` is blocked only implicitly
- File: `web/Transcription/app.py:106`
- Category: injection
- Evidence:
```python
    ext = Path(audio.filename or "audio.webm").suffix.lower()
```
- Impact: Only the suffix is used, so path traversal via `../../etc/passwd` is not actually exploited here — the actual tempfile name is generated by `NamedTemporaryFile`, not by concatenating the client filename. So this is a NON-issue for path traversal specifically, but I flag it so the reader knows it was considered. `[UNCERTAIN]` — this looks safe.
- Fix: No change required, but document the assumption with a comment.

---

### [MEDIUM] `print()`-style logger contains no redaction — could log secret-ish env vars indirectly
- File: `web/Transcription/app.py:39-45`
- Category: secret
- Evidence:
```python
    logger.info(f"Loading models: whisper={model_size}, device={device}, compute={compute_type}")
    transcription_service = TranscriptionService(
        model_size=model_size,
        device=device,
        compute_type=compute_type,
    )
    logger.info("Models loaded successfully")
```
- Impact: Benign for now — only model/device/compute strings are logged. But if `HF_TOKEN` or similar secrets are ever added for private HuggingFace models, the pattern of "log env var values at startup" could easily leak them. `[UNCERTAIN]` — no secrets leaked today, but the pattern is fragile. `transcriber.py:27` `logger.info(f"Loading Whisper model: {model_size} on {device} ...")` has the same benign shape.
- Fix: When adding any env var that could carry a token, either redact in logs or use explicit logging only for non-sensitive fields.

---

### [MEDIUM] `snapshot_download(repo_id=...)` at request time can hit the network unexpectedly
- File: `web/Transcription/transcriber.py:32-54`
- Category: dos
- Evidence:
```python
    def _init_diarization(self) -> None:
        """Initialize speaker diarization using speechbrain's speaker embedding model."""
        try:
            import os
            from huggingface_hub import snapshot_download
            from speechbrain.inference.speaker import EncoderClassifier
...
            snapshot_download(
                repo_id="speechbrain/spkrec-ecapa-voxceleb",
                local_dir=savedir,
                local_dir_use_symlinks=False,
            )
```
- Impact: This runs inside `__init__` on startup (good — only once). But `snapshot_download` with no `local_files_only=True` fallback means startup silently hangs / fails when HuggingFace is unreachable (rate-limited, network-partitioned, or air-gapped deploys). The outer `try/except` (`transcriber.py:55-57`) swallows the failure as a warning, leaving diarization silently disabled in production — which is a quality regression nobody will notice without looking at logs.
- Fix: Check `savedir` for required files first; if present, set `local_files_only=True`. Also surface a health-check field so ops can see diarization is off (`health.models_loaded` currently only reflects the Whisper model).

---

### [MEDIUM] `/health` lies about readiness — reports `models_loaded=True` even if diarization silently failed
- File: `web/Transcription/app.py:91-97`
- Category: logic
- Evidence:
```python
@app.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(
        status="ok",
        models_loaded=transcription_service is not None,
        supported_languages=["ar", "fr", "en"],
    )
```
- Impact: `models_loaded` is true as long as `TranscriptionService` was instantiated — even if `_init_diarization` swallowed its exception and left `self._embedding_model = None`. Callers (NestJS `MeetingsService`) cannot tell the difference between "ready with diarization" and "ready but will only label everyone as Speaker 1". This causes silent regressions after HuggingFace hiccups.
- Fix: Return `diarization_loaded: self._embedding_model is not None` separately and include Whisper model size.

---

### [MEDIUM] `allow_origins=["*"]` is *also* a logic bug — `allow_credentials` defaults to False but the wildcard still bypasses preflight restrictions
- File: `web/Transcription/app.py:57-62`
- Category: validation
- Evidence:
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
```
- Impact: Already covered as CRITICAL for auth above; re-listing here as a defense-in-depth hole: the wildcard is combined with `allow_methods=["*"]` which lets any origin send arbitrary methods. If at any point an `Authorization` dependency is added, and someone flips `allow_credentials=True`, this becomes a CSRF-with-credentials bug. Mark as structurally fragile.
- Fix: Hard-code `allow_origins=["http://localhost:5173"]` and `allow_methods=["POST"]`.

---

### [MEDIUM] `requirements.txt` uses unpinned `>=` ranges — supply-chain risk + reproducibility loss
- File: `web/Transcription/requirements.txt:5-10`
- Category: secret
- Evidence:
```
numpy>=1.24.0
scikit-learn>=1.3.0
torch>=2.0.0
torchaudio>=2.0.0
speechbrain>=1.0.0
pydantic>=2.0.0
```
- Impact: `faster-whisper==1.1.0`, `fastapi==0.115.0`, `uvicorn==0.32.0` and `python-multipart==0.0.12` are pinned (good) but ML dependencies are loose-bounded. A malicious or compromised release of `speechbrain`, `scikit-learn`, `torch`, or `torchaudio` (all large maintainer surfaces) will be installed on next `pip install`. `speechbrain` imports/executes model code via `from_hparams` — an attacker controlling the repo_id cache or a compromised release could run arbitrary Python on load.
- Fix: Pin all dependencies with `==` and add `pip install --require-hashes` backed by a `requirements.lock` generated via `pip-compile`.

---

### [MEDIUM] `pip install --no-cache-dir -r requirements.txt` runs without hash verification in Dockerfile
- File: `web/Transcription/Dockerfile:12`
- Category: secret
- Evidence:
```dockerfile
RUN pip install --no-cache-dir -r requirements.txt
```
- Impact: No hash pinning (`--require-hashes`) means a transient PyPI mirror compromise or typosquatted dep can slip in on any rebuild. Same root cause as previous finding but worth explicitly flagging at the build layer.
- Fix: Generate `requirements.lock` via `pip-compile --generate-hashes` and use `pip install --require-hashes -r requirements.lock`.

---

### [MEDIUM] Container runs as root (no `USER` in Dockerfile)
- File: `web/Transcription/Dockerfile` (lines 1-22 — no `USER` directive)
- Category: auth
- Evidence:
```dockerfile
FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
```
- Impact: A successful RCE in ffmpeg/libsndfile/torchaudio (see format-validation finding) gets root inside the container, which simplifies container escape on older Docker/runc.
- Fix: Add `RUN useradd --create-home --shell /bin/bash app` and `USER app` before `CMD`. Ensure `/app` and the models dir are writable by `app`.

---

### [LOW] No subprocess calls with `shell=True` — no arg-injection from user data in Python code
- File: (negative finding — entire repo)
- Category: injection
- Evidence: `transcriber.py` and `app.py` contain no `subprocess`, `os.system`, `os.popen`, or `shell=True` calls. ffmpeg is invoked *transitively* by `torchaudio.load` / faster-whisper using argv lists, not shells.
- Impact: None — this risk is not present in the Python code as written. `[UNCERTAIN]` only in the sense that faster-whisper 1.1.0 internally invokes ctranslate2 and decodes via the same libraries — review their release notes on each bump.
- Fix: None needed. Flag here so the reader knows it was specifically checked.

---

### [LOW] `.avg_logprob` could be `None`; `np.exp(None)` raises TypeError, but the `if seg.avg_logprob` truthiness guard isn't strictly equivalent
- File: `web/Transcription/transcriber.py:87`
- Category: logic
- Evidence:
```python
                "confidence": np.exp(seg.avg_logprob) if seg.avg_logprob else 0.0,
```
- Impact: `avg_logprob=0.0` is *valid* (probability = 1.0) but would be treated as "no confidence" because `0.0` is falsy. This yields `0.0` confidence for perfect segments — a minor display bug, not a security issue.
- Fix: `... if seg.avg_logprob is not None else 0.0`.

---

### [LOW] `HF_HUB_DISABLE_SYMLINKS=1` typo — actual env var is `HF_HUB_DISABLE_SYMLINKS_WARNING` or `HF_HUB_ENABLE_HF_TRANSFER` family
- File: `web/Transcription/app.py:10`
- Category: logic
- Evidence:
```python
os.environ["HF_HUB_DISABLE_SYMLINKS"] = "1"
```
- Impact: `[UNCERTAIN]` — `huggingface_hub` uses `HF_HUB_DISABLE_SYMLINKS_WARNING` to suppress the Windows warning, not `HF_HUB_DISABLE_SYMLINKS`. The comment "Must be set before any HuggingFace imports to avoid symlink errors on Windows" suggests the dev intended the warning-suppression variable. The actual symlink-avoidance is achieved separately via `local_dir_use_symlinks=False` on `transcriber.py:46`. So this line is likely a no-op.
- Fix: Replace with `HF_HUB_DISABLE_SYMLINKS_WARNING=1` or remove entirely since `local_dir_use_symlinks=False` already avoids symlinks.

---

### [LOW] Unbounded response size — full transcript returned in one JSON blob
- File: `web/Transcription/app.py:100-128`, `web/Transcription/transcriber.py:128-134`
- Category: dos
- Evidence:
```python
        return {
            "duration_seconds": round(duration, 2),
            "detected_languages": detected_languages,
            "speaker_count": len(unique_speakers),
            "segments": merged,
            "full_text": full_text,
        }
```
- Impact: A 100 MB audio file at ~150 words/min produces roughly 100k-word transcripts, plus timestamps per segment. The response can easily exceed 10 MB of JSON which is held in memory by both NestJS (the caller) and FastAPI (the sender). Not catastrophic but worth noting.
- Fix: Consider streaming via NDJSON or chunked responses, or persist to a file and return a reference.

---

### [LOW] No rate limiting / concurrency cap
- File: `web/Transcription/app.py` (entire file — no limiter registered)
- Category: dos
- Evidence: No `slowapi`, `fastapi-limiter`, or uvicorn `--limit-concurrency` flag set in `run.bat`, `run.sh`, or `Dockerfile`.
- Impact: Even with the auth fix, lack of per-client rate limiting means a single authenticated client can queue up inference requests faster than the model serves them. Memory grows unbounded as Starlette buffers the uploads.
- Fix: Add `slowapi` with a limit like `5/minute per IP` on `/transcribe`, and set `uvicorn --limit-concurrency 2 --limit-max-requests 1000` in launchers.

---

## Summary Table

| Severity | Count |
|----------|-------|
| CRITICAL | 3 (auth missing, host 0.0.0.0, CORS wildcard) |
| HIGH     | 6 (RAM blowup, decode bomb, format spoofing, tempfile leak, blocking event loop, model-not-thread-safe, error leakage) |
| MEDIUM   | 8 (suffix trust, snapshot_download hang, health-lie, requirements unpinned, Dockerfile pip unhashed, Dockerfile runs as root, CORS defense-in-depth, attacker-controlled ext) |
| LOW      | 4 (no shell=True — negative, avg_logprob edge, HF env-var typo, response-size, rate-limit) |

## Quick-win fixes in priority order

1. Bind `--host 127.0.0.1` in `run.bat`/`run.sh`. (2-line fix, removes most external attack surface.)
2. Add `X-Internal-Token` header dependency on `/transcribe` validated against env var; forward from NestJS `MeetingsService`.
3. Replace `allow_origins=["*"]` with explicit localhost frontend origin(s).
4. Replace full `await audio.read()` with chunked streaming-to-tempfile with running-sum cap.
5. Wrap `transcription_service.transcribe(...)` in `await asyncio.to_thread(...)` and guard with `asyncio.Semaphore(1)`.
6. Return generic error string; keep details in `logger.error(..., exc_info=True)` only.
7. Pin all deps with `==` in `requirements.txt`.
8. Add non-root `USER` to Dockerfile.
