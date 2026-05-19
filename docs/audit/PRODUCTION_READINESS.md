# Production Readiness — NeoLeadge

> Consolidated punch list across 6 specialist audits (security, performance/reliability,
> observability/ops, database/data integrity, frontend, code quality/architecture).
>
> **Date:** 2026-05-19
> **Branch:** `nest-back` @ `2bec9c2`
> **Auditor count:** 6 parallel specialists
> **Total findings:** **129** across all axes
>
> Individual reports live next to this file in `docs/audit/`.

---

## TL;DR Verdict

**Status: ship-blocked on a small must-fix list.** The code itself is mature: well-tested (~2,500 tests, 68.83% backend stmt coverage), well-documented (`AI_MODULE_GUIDE.md`), with strong patterns (Result, multi-tenancy guard, planner-worker). The blockers are in the **operational surface** (CI not running tests, no Sentry, no backups, container as root) and a **handful of real correctness bugs** (soft-delete leaks, multi-tenancy hole in pgvector indexer, missing concurrency guards).

| Verdict | Count of issues |
|---|---|
| 🔴 **Must fix before next prod deploy** | 14 |
| 🟠 **Must fix in next sprint** | 24 |
| 🟡 **Nice to have / future** | 91 |

---

## 🔴 Block list (must fix before next prod deploy)

These are correctness, security, or ops issues that materially threaten production today. Effort estimates are pessimistic.

### Security (4)

1. **`backfill-embeddings.ts` unparameterised `--project-id` SQL injection** — `web/back-nest/src/commands/backfill-embeddings.ts:92,179,248`. `$queryRawUnsafe` with manual quote-doubling on a CLI arg. Compromised pipeline or typo → SQL injection. **Fix:** switch to `Prisma.sql` template tags. Est: **2h**. Source: SECURITY S-05.

2. **`lodash <= 4.17.23` code-injection CVE** — CVSS 8.1. Transitive via `@nestjs/config`. **Fix:** add `"overrides": { "lodash": ">=4.17.24" }` to `web/back-nest/package.json`. Est: **15m**. Source: SECURITY S-01.

3. **`axios < 1.15.2` prototype-pollution** in frontend. **Fix:** `npm install axios@latest`. Est: **15m + smoke test**. Source: SECURITY S-03.

4. **NestJS server container runs as root** — `web/back-nest/Dockerfile` has no `USER` directive. Any RCE (e.g. via ffmpeg in audio path) = root inside container. The Python transcription container correctly uses `nonroot`. **Fix:** add `adduser/USER app` in runtime stage. Est: **30m**. Source: SECURITY S-04.

### Data integrity (3)

5. **11 `Project.findUnique` read sites missing `isDeleted: false` filter** — soft-deleted projects continue serving AI output, PM data, and validation feedback. `cahier-des-charges.service.ts:529,658,748,800,822,858`, `work-packages.service.ts:55,138,738,772`. **Fix:** swap each `findUnique({where:{id}})` → `findFirst({where:{id, isDeleted: false}})`. Est: **2h**. Source: DATABASE H1.

6. **pgvector indexer has no `projectId` guard at write path** — `embedding-indexer.service.ts:84-89`. A buggy caller could overwrite embeddings across tenants. The read tools filter by projectId; the writer doesn't. **Fix:** add `AND projectId = $X` to the three UPDATE SQL templates. Est: **1h + test**. Source: DATABASE H3.

7. **`wp-comments.update` lets soft-deleted comments be edited** — line 93. Parallel correct impl in `comments.service.update`. **Fix:** add `isDeleted: false` to the where clause. Est: **15m**. Source: DATABASE H2.

### Reliability / correctness (3)

8. **`backlog.accept` has no concurrency guard** — double-click duplicates the entire backlog (epics + tasks) as `WorkPackage` rows. **Fix:** check for `aiGeneratedFrom` rows in the last 30s or wrap in atomic conditional INSERT. Est: **1h**. Source: PERFORMANCE Critical.

9. **`cahier.savePersistedCahier` has no concurrency guard** — same shape. Two near-simultaneous saves can interleave version rows. **Fix:** add an optimistic-lock check on `savedAt`. Est: **1h**. Source: PERFORMANCE Critical.

10. **`transcribeChunk` swallows every failure** — live meeting words vanish on transient errors with no user-visible signal. **Fix:** return a flag the live-meeting UI can surface as "chunk dropped, retrying". Est: **2h**. Source: PERFORMANCE H.

### Ops (4)

11. **CI doesn't run jest** — `.github/workflows/ci.yml:60` uses `--passWithNoTests`. All 1,631 backend tests are run for nothing. **Fix:** remove the flag, fail on test failure. Est: **30m**. Source: OBSERVABILITY Critical-1.

12. **CI doesn't run vitest at all** — `ci.yml:64-87` frontend job has no test step. All 867 frontend tests = silent regressions risk. **Fix:** add `npm run test:unit -- --run`. Est: **30m**. Source: OBSERVABILITY Critical-2.

13. **`deploy.sh:43-44` uses `docker compose up -d`** — CLAUDE.md says this is broken on prod (AppArmor blocks `docker stop`, must use kill-then-rm). Script will silently fail to redeploy. **Fix:** rewrite per the documented pattern. Est: **30m**. Source: OBSERVABILITY Critical-3.

14. **`.env.prod.example` has 9 vars; `docker-compose.prod.yml` references 40** — fresh setup is undocumented. New ops person won't know what to set. **Fix:** sync the example file to include every var used. Est: **1h**. Source: OBSERVABILITY Critical-4.

---

## 🟠 Sprint list (must fix in the next sprint)

### Security (5)

| # | Finding | Effort | File |
|---|---|---|---|
| S15 | JWT in `localStorage` — vulnerable to any same-origin XSS. Migrate to `httpOnly` cookie. | 1d | `authStore.ts:54` |
| S16 | `disableTotp()` doesn't check `lockedUntil` — TOTP brute-force during lockout. | 30m | `auth.service.ts:179` |
| S17 | TOTP secret stored as plain VARCHAR — DB dump = total 2FA bypass. AES-256-GCM at rest. | 4h | `schema.prisma:63` |
| S18 | Auth endpoints lack per-route throttle (only global 120/min applies). | 30m | `auth.controller.ts` |
| S19 | No explicit CSP header on nginx or in Helmet config. | 2h | nginx conf + `main.ts` |

### Database (3)

| # | Finding | Effort |
|---|---|---|
| D4 | `prisma migrate deploy` failure in entrypoint = CrashLoopBackOff with no rollback path documented. | 4h |
| D5 | Only audio purged in retention; AuditLog, Notification, AiUsage grow unbounded. | 1d |
| D6 | `passwordResetToken` not `@unique` — race condition on token collision. | 15m |

### Performance / reliability (7)

| # | Finding | Effort |
|---|---|---|
| P1 | Server container has no docker healthcheck — Caddy can proxy mid-cold-boot. | 30m |
| P2 | `meetings.getByProject` unbounded `findMany` — at scale dumps every segment. Add pagination. | 2h |
| P3 | `dashboard.getWorkloads` + `dashboard.getOverdueProjects` unbounded. | 2h |
| P4 | `saveFieldValues` upsert loop runs sequentially inside tx (`projects.service.ts:709`). Promise.all + chunk. | 1h |
| P5 | `bulkAssign` notification fan-out is sequential post-tx. Promise.all. | 1h |
| P6 | 3 `bulk*` project methods use sequential loops. | 1h |
| P7 | 8 per-project Vue views skip required `store.reset()` in `onMounted` (CLAUDE.md violation). | 1h |

### Observability (5)

| # | Finding | Effort |
|---|---|---|
| O1 | No Sentry on backend OR frontend — production errors are invisible. | 1d setup + ongoing |
| O2 | Frontend errors silently swallowed in `main.ts:42-46`. | 30m (also fixed by O1) |
| O3 | Server + transcription containers have no compose healthcheck. | 30m |
| O4 | Docker log retention ~100MB ring (<24h on a busy day). Bump to 100MB × 5 files. | 15m |
| O5 | No postgres backup automation, no documented restore. | 1d |

### Code quality (4)

| # | Finding | Effort |
|---|---|---|
| C1 | Three planner flags default `off` in code but documented `on`. Align one side. | 15m |
| C2 | `CreateNotificationDto` is interface not class — silent validation strip if ever wired to `@Body()`. | 15m |
| C3 | 21 inline `formatDate` copies in Vue components. Mechanical replace with `lib/formatDate.ts`. | 2h |
| C4 | `auth.service.ts` throws HTTP exceptions instead of Result.fail (30+ throws). Inconsistent error contract. | 1d |

---

## 🟡 Backlog (nice to have / future)

Grouped by axis. Detailed findings in the per-axis reports.

### Architecture (5 big-rock items)

- **A1.** OpenAPI-generated shared types between back-nest and customapp (kills the 5-copy `CahierAiResult` drift class).
- **A2.** Split `cahier-des-charges.service.ts` (2,017 LOC) into 5 focused services. `projects.service.ts` (1,008) and `work-packages.service.ts` (890) also over CLAUDE.md limit.
- **A3.** `AiDispatchService` unifying provider dispatch — currently `callOpenAi`/`callGemini` duplicated between cahier-des-charges and ai/providers.
- **A4.** Move in-process cooldowns + session maps to Redis (`backlog.service.lastPreviewAt`, `LiveCopilotService.sessions`, `CollaborationService.pendingEmbeds`) — blockers for horizontal scaling.
- **A5.** Split 3 large Vue components (`CahierDesChargesSection.vue` 989, `MeetingAiPanel.vue` 897, `LiveMeetingPanel.vue` 879).

### Frontend (top 5 quick wins from the audit)

- Catch-all 404 route — unknown URLs currently render empty `<RouterView/>`.
- Consume `?redirect=` query param in `LoginView.redirectAfterLogin()` (line 252-255) — currently parsed but ignored.
- Chart.js tree-shake (`registerables` defeats it — ~150KB recoverable).
- Async chart chunk import.
- Bundle: 1.43 MB NeoLibrary chunk on every cold load — split or lazy.

### Database (10 medium / low items)

- Vector dimension drift hardening (if e5 ever swapped from 384-d).
- HNSW index parameter tuning policy at 100k+ rows.
- Connection pool sizing review against docker mem cap.
- Audit log append-only enforcement.
- 6 minor schema hardening items (unique constraints, default-value review, etc.).

### Code quality (8 medium items + 5 low)

- Remove 4 unused mail templates (already partly done in cleanup pass).
- 97 `catch (e)` clauses to widen to `catch (e: unknown)`.
- Magic numbers → named constants in AI module.
- `CAHIER_SECTION_MODE` flag removal (superseded by streaming).
- Service method naming convention.

### Observability (low)

- Trace IDs / correlation through logs.
- Slow-query log threshold tuning.
- Metric export to Prometheus or similar.
- Runbook expansion (incident playbook, on-call references).

### Repo hygiene

- Root-level junk to clean up: `AGENTS.md`, `testsprite_tests/`, `ux-audit/`, `charge`, `neloadge`, `deign`, `rapport_final.md` (flagged by observability audit).

---

## Per-axis scorecard

| Axis | Critical | High | Medium | Low | Report |
|---|---|---|---|---|---|
| Security | 0 | 4 (overrides: 1 sql injection) | 6 | 5 | `SECURITY_AUDIT.md` |
| Performance / Reliability | 2 | 7 | 8 | 5 | `PERFORMANCE_AUDIT.md` |
| Observability / Ops | 5 | 9 | 6 | 4 | `OBSERVABILITY_AUDIT.md` |
| Database / Data integrity | 0 | 6 | 10 | 6 | `DATABASE_AUDIT.md` |
| Frontend | 0 | 5 | 14 | 6 | `FRONTEND_AUDIT.md` |
| Code quality / Architecture | 1 | 6 | 8 | 5 | `CODE_QUALITY_AUDIT.md` |
| **Total** | **8** | **37** | **52** | **31** | **128** |

(Observability "Critical" includes 4 ops-process items the other auditors flagged as High in their own axis. The block list above dedupes them.)

---

## Recommended sequencing

### Week 1 — must-fix sprint
- Day 1: Security CVE updates (S-01, S-03) + container hardening (S-04) + backfill SQL injection (S-05). All quick.
- Day 2: Soft-delete fixes (DATABASE H1, H2) + pgvector tenancy (H3). Pure search-replace + test.
- Day 3: Concurrency guards on backlog.accept + cahier.savePersistedCahier + transcribeChunk error surfacing.
- Day 4: CI fixes — actually run jest + vitest. Sync `.env.prod.example`. Fix `deploy.sh`.
- Day 5: Smoke-test the test server, verify nothing regressed, merge.

### Week 2-3 — sprint list
- Sentry on both sides (highest ROI for incident response).
- Postgres backup automation.
- httpOnly cookie migration for JWT.
- Retention policy expansion (AuditLog, Notification, AiUsage).
- Healthchecks on server + transcription compose services.
- Per-route auth throttle.
- TOTP secret encryption at rest.
- Frontend store.reset() audit fixes.

### Sprint 4+ — bigger refactors
- OpenAPI-generated shared types (A1).
- Service splits (A2).
- Redis migration of in-process state (A4).

---

## What's already strong (don't re-audit)

- **Auth**: HS256 pinned both sides, JwtAuthGuard + ProjectAccessGuard + PermissionsGuard layered correctly, tokenVersion invalidation.
- **AI**: provider fallback chain, daily token budget enforced, 6-layer anti-hallucination on cahier, semantic SQL is multi-tenant correct.
- **Migrations**: tracked Prisma migrations, pgvector indexes built CONCURRENTLY, cascade table in DATABASE_SCHEMA.md matches schema.
- **Logging**: pino structured, PII redact in place, AI error key-sanitization (sk-, AIza, Bearer).
- **Tests**: 1,631 backend + 867 frontend + 10 gated integration + 6 Playwright scaffolded.
- **Docs**: AI_MODULE_GUIDE 21 sections, agent-orchestra phase docs, DATABASE_SCHEMA.md with ER + cascade tables.
- **Audit log**, **rate limiting**, **graceful shutdown**, **socket reconnect**, **Swagger gated to non-prod**.

---

## Pointers

- Per-axis reports: `docs/audit/{SECURITY,PERFORMANCE,OBSERVABILITY,DATABASE,FRONTEND,CODE_QUALITY}_AUDIT.md`
- AI module reference: `docs/AI_MODULE_GUIDE.md`
- Database reference: `docs/DATABASE_SCHEMA.md`
- Agent orchestra history: `docs/agent-orchestra/`
