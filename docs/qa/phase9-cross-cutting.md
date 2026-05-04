# Phase 9 — Cross-Cutting Security & Quality Fixes

Sprint: phase9-cross-cutting  
Date: 2026-04-20  
Files changed: 8

---

## Items closed

### Python — `web/Transcription/`

| # | Item | Status | File |
|---|------|--------|------|
| 1 | Tempfile leak on SIGKILL — `try/finally` with unconditional `os.unlink` | **ALREADY CLOSED** (Sprint 7) | `app.py` |
| 2 | `models_loaded` lying when diarization silently fell back | **FIXED** | `app.py` |
| 3 | `snapshot_download` — `local_files_only` fallback when network unavailable | **FIXED** | `transcriber.py` |
| 4 | Pin `torch`, `torchaudio`, `speechbrain`, `scikit-learn`, `numpy`, `pydantic` to exact `==` | **FIXED** | `requirements.txt` |
| 5 | Dockerfile — add `USER nonroot` | **FIXED** | `Dockerfile` |
| 6 | `np.exp(seg.avg_logprob) if seg.avg_logprob else 0.0` — falsy 0.0 treated as absent | **FIXED** | `transcriber.py:87` |

### Security — `web/back-nest/`

| # | Item | Status | File |
|---|------|--------|------|
| 7 | `.env` tracked by git | **NOT AN ISSUE** — `git ls-files web/back-nest/.env` returns nothing; root `.gitignore` already excludes `.env` + `.env.*` | n/a |
| 8 | `decodeJwt` — missing "UI display only" comment | **FIXED** | `src/lib/jwt.ts` |
| 9 | `ValidationPipe` — `forbidUnknownValues: true` missing | **ALREADY CLOSED** — both `forbidNonWhitelisted` and `forbidUnknownValues` were already set in `main.ts` | `src/main.ts` |
| 10 | `@Throttle` on `/auth/login/totp`, `/auth/2fa/enable`, `/auth/2fa/disable` | **FIXED** | `src/auth/auth.controller.ts` |
| 11 | `resetPassword` returns `tempPassword` in response | **ALREADY CLOSED** — `users.service.ts` already returns `Result.ok({ success: true })` | `src/users/users.service.ts` |

### Abuse scenarios — `web/Front/customapp/`

| # | Item | Status | File |
|---|------|--------|------|
| 12 | Force-change guard fires on every protected route | **VERIFIED CORRECT** — guard is in global `beforeEach` gated on `!isPublic && to.meta.requiresAuth`; covers all `/app/*` children (meta inherited from parent) and `/custom-action` | `src/router/index.ts` |
| 13 | `userRole === 'Admin'` → replace with `can()` where applicable | **PARTIAL FIX** — replaced the feature-visibility gate in `AppSearchModal.vue` (line 158) with `can('team_planner.view')`; remaining occurrences are routing-destination logic (deeply coupled, skipped per constraint) | `src/components/common/AppSearchModal.vue` |

---

## Detail notes

### Fix 2 — Health endpoint split

`HealthResponse` now exposes three booleans:
- `whisper_loaded` — True when `TranscriptionService` was instantiated (Whisper model loaded)
- `diarization_loaded` — True when `_embedding_model is not None` (SpeechBrain ECAPA loaded)
- `models_loaded` — `whisper_loaded AND diarization_loaded` (kept for backwards-compatibility)

NestJS callers can now detect partial-ready state (Whisper up, diarization down) and log/alert accordingly.

### Fix 3 — `snapshot_download` local_files_only

Checks for presence of `hyperparams.yaml` in the local cache dir before deciding whether to pass `local_files_only=True`. On first boot, performs a full network download; on subsequent boots (or in air-gapped environments), skips the network entirely and uses cached files. If the network download fails on first boot, the outer `except` in `_init_diarization` still catches it and sets `_embedding_model = None` with a warning log.

### Fix 5 — Dockerfile non-root user

Added `addgroup/adduser nonroot`, `chown -R nonroot:nonroot /app`, `USER nonroot` before `COPY . .`. The `COPY` now uses `--chown=nonroot:nonroot` so the app files are owned by the service user from the start. Limits blast radius of any RCE via ffmpeg/libsndfile/torchaudio to a low-privilege container user.

### Fix 6 — avg_logprob truthiness

`seg.avg_logprob = 0.0` is a valid value (probability = 1.0) that was being treated as absent. Changed guard from `if seg.avg_logprob` to `if seg.avg_logprob is not None`.

### Fix 10 — TOTP throttle

`@Throttle({ default: { ttl: 60_000, limit: 10 } })` applied to:
- `POST /auth/login/totp` — step-2 TOTP code verification
- `POST /auth/2fa/enable` — enable 2FA with code confirmation
- `POST /auth/2fa/disable` — disable 2FA with code confirmation

The global `ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }])` and `ThrottlerGuard` (APP_GUARD) were already in `app.module.ts`. The per-endpoint decorator overrides with a tighter 10 req/min budget to prevent TOTP brute-force.

### Fix 13 — can() for team-planner visibility

`AppSearchModal.vue`: replaced `authStore.userRole === 'Admin' || authStore.userRole === 'ProjectManager'` with `authStore.can('team_planner.view')`. The route destination ternary (`Admin ? admin-path : pm-path`) was left as-is since it's routing logic, not an access gate.

Skipped occurrences:
- `AppShell.vue:149` — selects which nav array to show; purely structural routing decision
- `AppSearchModal.vue:152, 159` — selects the URL to navigate to; skipped per "deeply coupled" constraint
- `HomeView.vue:316, 338` — selects API endpoint to call based on role; skipped

---

## Build results

- `web/back-nest`: `npm run build` — **PASS** (clean, no errors)
- `web/Front/customapp`: `npm run build` — TypeScript type-check fails on pre-existing errors in `PMProjectList.vue`, `PMProjectsPage.vue`, `TeamMemberView.vue`, `ProjectManagerView.vue` (all in the working tree before this sprint, none in the changed files). Our changed files (`lib/jwt.ts`, `components/common/AppSearchModal.vue`, `router/index.ts`) produce **0 TypeScript errors**.
