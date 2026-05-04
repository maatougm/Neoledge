@echo off
echo === NeoLeadge Transcription Service ===
echo.
echo Installing dependencies...
pip install -r requirements.txt
echo.
echo Starting service on http://127.0.0.1:8000 (loopback only)
echo.
echo Supported languages: Tunisian Arabic, French, English
echo Model: whisper-large-v3 (auto-downloads on first run)
echo.
REM Bind to the loopback interface only — the service must never be exposed
REM on a public / LAN interface. The NestJS backend proxies every call.
set WHISPER_MODEL=large-v3
set DEVICE=cpu
set COMPUTE_TYPE=int8
REM TRANSCRIPTION_SECRET is REQUIRED. Generate a strong random value, e.g.:
REM   powershell -c "[Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))"
REM and set it in your environment (or copy it into the matching NestJS .env).
if "%TRANSCRIPTION_SECRET%"=="" (
    echo.
    echo [ERROR] TRANSCRIPTION_SECRET is not set. Refusing to start.
    echo         Set it in the environment before running this script.
    exit /b 1
)
REM Optional: override the allowed CORS origin (defaults to http://localhost:5122)
REM set ALLOWED_ORIGIN=http://localhost:5122
uvicorn app:app --host 127.0.0.1 --port 8000
