# NeoLeadge — Observability + Operational Readiness Audit

**Date:** 2026-05-19
**Scope:** logging, metrics, error tracking, configuration, deploy, CI/CD, runbook
**Verdict:** **NOT YET PRODUCTION-READY.** Significant ops gaps despite the test server having run for weeks. 5 Critical, 9 High, 6 Medium, 4 Low findings.

---

## Executive summary

The application is **well-engineered in-process** — strong env validation, structured pino logging with request IDs and redaction, audit logging, AI-usage tracking, JWT-with-token-version invalidation, helmet, throttling, soft-delete patterns. **The operational surface around it has serious gaps**:

1. **No production error tracking** (no Sentry / Datadog / Bugsnag). Frontend `errorHandler` only logs to console in dev (`main.ts:42-46`) — prod errors are silent.
2. **CI does not run the unit-test suite that gates correctness.** `npm test` in backend has `--passWithNoTests`; **frontend `vitest run` is never invoked in `ci.yml`** at all. ~2,500 tests written this push do not gate PRs.
3. **`deploy.sh` uses `docker compose up -d`** which CLAUDE.md explicitly documents as broken on the prod host (AppArmor blocks `docker stop`). The documented kill-then-rm pattern is tribal knowledge, not scripted.
4. **`.env.prod.example` lists 9 env vars; `docker-compose.prod.yml` references 40.** Anyone re-deploying from scratch silently runs without CORS_ORIGINS, AI keys, TRANSCRIPTION_SECRET, etc.
5. **No backup automation.** Postgres data is on a Docker volume; there is no `pg_dump` cron and no documented restore.
6. **No security headers** on the static SPA (no CSP, X-Frame-Options, HSTS) — helmet only protects API responses, the SPA HTML is served by nginx without security headers, and Caddy passes them through.

The codebase is mature enough that fixing these is small-effort-per-item; the count is the issue.

---

## Findings table

| # | Severity | Area | File / Source | Finding |
|---|---|---|---|---|
| 1 | **CRITICAL** | CI | `.github/workflows/ci.yml:58-60` | Backend `npm test --if-present -- --passWithNoTests` runs jest but `--passWithNoTests` means a misconfigured suite silently passes. Worse: no coverage threshold gate. |
| 2 | **CRITICAL** | CI | `.github/workflows/ci.yml:64-87` | **Frontend `vitest run` is never invoked.** 867 frontend tests written this push do not gate PRs. Only typecheck + build run. |
| 3 | **CRITICAL** | Deploy | `deploy/neoleadge/deploy.sh:43-44` | Script uses `docker compose up -d server web` which CLAUDE.md documents as failing on prod (AppArmor blocks `docker stop` → containers hang). Must use the kill-then-rm pattern. |
| 4 | **CRITICAL** | Config | `deploy/neoleadge/.env.prod.example` | Template lists 9 env vars; `docker-compose.prod.yml` references 40 (CORS_ORIGINS, TRANSCRIPTION_SECRET, AI_FALLBACK_*, ASSEMBLYAI_API_KEY, all PLANNER flags, MEETING_AUDIO_RETENTION_DAYS, THROTTLER_WHITELIST, SMTP_*). A fresh prod deploy from this template is broken. |
| 5 | **CRITICAL** | Backup | (absent) | No automated postgres backup. Data volume `neoleadge_db` has no `pg_dump` cron, no off-host copy, no documented restore. RPO/RTO undefined. |
| 6 | **HIGH** | Error tracking | (absent) | No Sentry / Bugsnag / Datadog integration anywhere. Production runtime errors are visible only in `docker logs`. With Docker log rotation `max-size: 20m, max-file: 5` (= 100 MB ring buffer on server container), incidents older than a few hours are gone. |
| 7 | **HIGH** | Error tracking | `web/Front/customapp/src/main.ts:41-46` | Vue global `errorHandler` logs to console ONLY in `import.meta.env.DEV`. **In production, frontend errors are silently swallowed.** |
| 8 | **HIGH** | Healthchecks | `deploy/neoleadge/docker-compose.prod.yml:97-102, 138-145` | `server` and `transcription` containers have **no compose-level healthcheck**. Only postgres + web (via nginx Dockerfile HEALTHCHECK). A crashed-but-restarted-with-bad-state server is invisible to ops. |
| 9 | **HIGH** | Security headers | `web/Front/customapp/nginx.prod.conf`, `deploy/neoleadge/Caddyfile:22-30` | No CSP, X-Frame-Options, HSTS, Referrer-Policy, Permissions-Policy. Helmet runs on backend but only affects API responses; the SPA HTML served by nginx behind Caddy has none of these. |
| 10 | **HIGH** | Logging | `web/back-nest/src/users/users.service.ts:219-223` | `console.warn` logs the **temporary password in plaintext** when `NODE_ENV !== 'production'`. If anyone forgets to set NODE_ENV on a staging box, temp passwords leak to logs. |
| 11 | **HIGH** | Migrations on deploy | `web/back-nest/Dockerfile:25` | `CMD npx prisma migrate deploy && node dist/src/main.js` — if migration fails, the container exits and `unless-stopped` restarts it infinitely. No alert, just CrashLoopBackOff. |
| 12 | **HIGH** | Lint enforcement | `.github/workflows/ci.yml:55-56, 81-82` | Both `npm run lint` steps have `continue-on-error: true`. CI doesn't actually enforce lint. Combined with finding #1+#2, the only enforced gate is "code compiles". |
| 13 | **HIGH** | Seed script swallowed | `.github/workflows/ci.yml:122` | `npx tsx prisma/seed-openproject.ts \|\| true` — a broken seed silently passes CI but the smoke suite then runs against incomplete data. |
| 14 | **HIGH** | Logs retention | `deploy/neoleadge/docker-compose.prod.yml:34-36, 99-101` | Server `max-size: 20m, max-file: 5` (~100MB ring); postgres 10m×3 (~30MB). On a busy day this gives **<24h of incident history**. With no external log shipping, post-mortem on a Wednesday morning incident is impossible Friday. |
| 15 | **MEDIUM** | Runbook | `docs/AI_MODULE_GUIDE.md §20` | The Phase 1-5 rollback table is excellent. Missing: incident response playbook (who to wake), on-call rotation, common-incident runbook entries (OOM on transcription, Z.AI 429 storm, postgres disk full, AppArmor block on container restart). |
| 16 | **MEDIUM** | Config | `web/back-nest/src/auth/auth.service.ts:305` | `FRONTEND_URL` falls back to `http://localhost:5173`. Not in `.env.example`. Not validated as required at startup. On prod with the var unset, password-reset links would point at localhost. |
| 17 | **MEDIUM** | Secret rotation | (absent) | JWT_SECRET rotation procedure is undocumented. The token-version invalidation mechanism (`appUser.tokenVersion`, `auth.service.ts:489-499`) exists but the operator workflow ("rotate secret, bump everyone's tokenVersion, restart, force re-login") is not in any runbook. |
| 18 | **MEDIUM** | Build reproducibility | `web/Front/customapp/Dockerfile:13-14` | `npm install --legacy-peer-deps` (NOT `npm ci`) used because of the vendored NeoLibrary tarball path rewrite. Builds are not fully reproducible — peer-dep resolution can drift between builds. |
| 19 | **MEDIUM** | Health endpoint | `web/back-nest/src/health/health.controller.ts:14-42` | `/health` checks DB connectivity but NOT: embeddings service (`/embed` reachability), AI provider key sanity, postgres `vector` extension presence (Phase 4 dep). A degraded AI path returns 200 OK. |
| 20 | **MEDIUM** | Cron observability | `web/back-nest/src/deadlines/deadlines.service.ts:53, 59, 71`, `src/retention/retention.service.ts:53, 70` | Cron jobs log start/end but don't write a heartbeat row (e.g., to `AiUsage` or a `SystemHeartbeat` table). If the `@nestjs/schedule` registry hangs, no alert fires — only manual log grep notices. |
| 21 | **MEDIUM** | Branch protection | (cannot verify from code) | No `.github/CODEOWNERS`. No branch-protection ruleset checked in. PR #4 (165 commits) can be merged by anyone with push rights. |
| 22 | **LOW** | Documentation | `README.md:34` | README references `prisma/seed-notifications.ts` which **was deleted in cleanup pass 1** (commit `32f23f6`). Also `seed-demo-project.ts`, `seed-teams.ts` references stale. |
| 23 | **LOW** | Documentation | `README.md:16` | Quick-start says XAMPP MySQL on 3306 — but the project is now Postgres (per the env example and prod). README out of sync with reality. |
| 24 | **LOW** | Coverage trend | (absent) | No Codecov / Coveralls integration. The 68.83% backend / 867 frontend coverage delivered this PR has no trend tracking; a future drop is invisible. |
| 25 | **LOW** | Audit log endpoint | `web/back-nest/src/system-status/log.controller.ts:42` | Hardcoded `[INFO]` level prefix on all audit log lines. If a `auditService.log({severity: 'error', ...})` is ever added, the UI still shows it as INFO. Minor UX-side issue. |

---

## What's working well (counter-balance)

Worth saying explicitly so the punch list isn't read as "everything is broken":

- **Env validation is robust.** `app.module.ts:57-83` rejects boot when `JWT_SECRET / DATABASE_URL / TRANSCRIPTION_URL / TRANSCRIPTION_SECRET` are missing, plus CORS_ORIGINS required in prod. Strict failures fast.
- **Pino structured logging with request IDs.** `app.module.ts:84-135` configures pino with per-request `reqId` (header propagation), JSON in prod, pretty in dev, /health spam silenced, and a robust `redact` block covering Authorization, Cookie, X-Transcription-Secret, password fields, JWT, etc.
- **Helmet + global rate limiting + global exception filter** all in place (`main.ts:99, app.module.ts:50-54, main.ts:22-95`).
- **AI error sanitization.** `ai.service.ts:13-20` strips `sk-`, `AIza`, `Bearer`, and `key=...` from error messages before persisting to `meetingTranscript.aiError`. PII redaction (`src/common/pii-redact.ts`) wraps every AI prompt.
- **Audit log table + admin viewer.** `auditService` writes for every mutation; `log.controller.ts` exposes a paginated admin view with email masking for non-Admin callers.
- **Socket.IO has explicit reconnect.** `useCollaborationSocket.ts:reconnection: true, reconnectionAttempts: Infinity, reconnectionDelayMax: 30000` plus a re-join-rooms-on-reconnect handler.
- **Graceful shutdown.** `enableShutdownHooks()` in main, `PrismaModule.onApplicationShutdown` disconnects cleanly.
- **Swagger gated to non-prod** (`main.ts:138-145`).

---

## Recommended additions

### Must-have before "production-ready"

1. **Sentry on both backend + frontend.** Backend init in `main.ts` before `bootstrap()`; frontend init in `main.ts` before `app.config.errorHandler`. Free tier (5k events/mo) is fine for the user base. Cost: ~1 hour to wire.
2. **Fix CI.** Add a `Unit tests` job to `ci.yml` that runs `cd web/back-nest && npx jest --ci --coverage` (drop `--passWithNoTests`) and `cd web/Front/customapp && npx vitest run --coverage`. Remove the `continue-on-error: true` on lint. Cost: ~30 min.
3. **Backup automation.** Add a cron container to `docker-compose.prod.yml` that runs `pg_dump | gzip > /backups/$(date +%F).sql.gz` daily, retains 7 days locally, and syncs to S3 / Hetzner Storage Box. Document restore. Cost: ~2 hours.
4. **Fix `deploy.sh`.** Replace lines 43-44 with the kill-then-rm pattern from `CLAUDE.md`. Cost: ~10 min.
5. **Sync `.env.prod.example` with `docker-compose.prod.yml`.** Every `${VAR}` referenced by compose must appear in the example with a placeholder or comment explaining when to leave empty. Cost: ~15 min.
6. **Add security headers.** In nginx.prod.conf or the Caddyfile, add: CSP (start with report-only mode), X-Frame-Options: DENY, X-Content-Type-Options: nosniff, Referrer-Policy: strict-origin-when-cross-origin, Strict-Transport-Security with at least 1y max-age. Cost: ~1 hour incl. CSP tuning.

### Should-have

7. **Server + transcription healthchecks** in docker-compose.prod.yml. `wget -qO- http://localhost:3000/health \|\| exit 1` for server; `wget -qO- http://localhost:8000/healthz \|\| exit 1` for transcription (verify the FastAPI route).
8. **Codecov or similar.** Trend tracking so future PRs surface coverage regressions.
9. **Branch protection on `master`.** Require PR review + CI green + signed commits. (Configure in GitHub settings, not in code, but document the policy in `docs/audit/`.)
10. **Incident-response runbook.** Add `docs/audit/INCIDENT_RUNBOOK.md` with at minimum: "site is down", "AI features 500ing", "Z.AI rate-limited", "postgres full disk", "AppArmor container stuck" entries.
11. **Log shipping.** Either filebeat → ELK, or a hosted aggregator (Logtail, Datadog Logs). Default Docker JSON-file at 100MB is not enough for incident forensics.
12. **Remove the `console.warn` plaintext temp password leak** at `users.service.ts:219-223`. If the operator needs to recover a temp password, expose it via an admin-only audit log entry, not stdout.

### Nice-to-have

13. **Health endpoint depth.** Have `/health` optionally check the embeddings service + report the `vector` extension presence when accessed by an admin token.
14. **README quick-start update.** Drop the XAMPP MySQL reference; pin to Postgres-via-docker.
15. **Per-container metrics** (process_cpu_seconds, prisma_query_duration). Prometheus exposition format + a basic Grafana dashboard.

---

## Operational gaps — prod-incident-readiness scorecard

| Capability | Status | Notes |
|---|---|---|
| Detect: app errors (frontend + backend) | **❌** | No Sentry. Console-only in dev. |
| Detect: app errors trigger an alert | **❌** | No alert pipeline. |
| Detect: container crash-loop | ⚠️ Manual | `docker ps` only. No `restart_count` alert. |
| Detect: postgres disk / connection storm | ⚠️ Manual | `pg_isready` on healthcheck, but no disk-pct, no slow-query log. |
| Detect: AI provider 4xx/5xx storm | ⚠️ Partial | AiUsage logs failures; no aggregated rate dashboard. |
| Detect: cron job didn't run | **❌** | Logs only. No heartbeat → alert. |
| Investigate: log history > 24h | **❌** | Docker JSON-file ring is too small; no external shipping. |
| Investigate: request tracing | ✅ | Request-IDs propagated through pino logs. |
| Investigate: audit trail of admin actions | ✅ | AuditLog table + admin viewer. |
| Recover: rollback a bad deploy | ⚠️ Partial | Phase 1-5 flag flips exist; full app-version rollback requires manual git reset + image rebuild (no tagged releases). |
| Recover: restore from backup | **❌** | No backups exist to restore from. |
| Recover: rotate JWT_SECRET | ⚠️ Undocumented | Mechanism exists (`tokenVersion`) but operator procedure is tribal. |
| Onboard: new dev can run locally | ⚠️ | `.env.example` is reasonably complete, but README quick-start is stale (XAMPP/MySQL references). |
| Onboard: new dev can deploy | ⚠️ | `deploy.sh` exists but is broken; `deploy/neoleadge/README.md` is good for first-time setup; no day-2 deploy doc. |

**Score: 5 / 14 fully covered, 6 partial, 3 fully missing.**

---

## Adjacent observations (out of strict scope, noting for the parent)

- **`AGENTS.md`** at repo root — unread; suggests there's another AI-instructions file separate from `CLAUDE.md` worth reviewing for drift.
- **`testsprite_tests/`, `ux-audit/`, `charge`, `neloadge`, `deign`** — odd top-level directories worth a cleanup pass.
- **`rapport_final.md`** at repo root — appears to be a deliverable doc that probably shouldn't be at the repo root.
- The 8 in-CI smoke scripts (`smoke-*.mjs`) live in `web/Front/customapp/`, not `scripts/` — minor but the file org makes them easy to miss.
