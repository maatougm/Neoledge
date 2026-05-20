# Performance + Reliability Audit — NeoLeadge

Scope: NestJS 11 backend, Vue 3 frontend, FastAPI transcription. Findings are based on direct source reads with `file:line` citations.

---

## Executive summary

The codebase is in solid shape on the high-leverage fronts: every external HTTP call has an `AbortSignal.timeout`, every JSON column is parsed in `try/catch`, Prisma indexes generally line up with hot query patterns, lazy route imports + manual Vite chunks are wired, and `enableShutdownHooks()` is on. The agent-orchestra refactor (Phase 1-5) already addressed the biggest cahier/backlog/assignment latency wins.

The remaining issues split into three buckets:

1. **Concurrency gaps on write paths** — `backlog.accept`, `cahier.savePersistedCahier`, `projects.create`, and the transcription chunk endpoint have no double-submit guard. Backlog accept will literally duplicate work-packages on a double-click.
2. **Unbounded `findMany` reads** — `meetings.getByProject`, `dashboard.getWorkloads`, `dashboard.getOverdueProjects`, `analytics.getProjectActivity` have no `take` cap. Will become slow once any project accumulates a few hundred transcripts or once the org has >500 PMs.
3. **Sequential loops in hot paths** — `projects.saveFieldValues` upserts inside a transaction with sequential awaits (holds locks); `bulkAssign` post-tx loop awaits `ensureProjectMembership` + `notifyEnhanced` per assignee; bulk operations on projects (`bulkArchive`/`bulkUpdateStatus`/`bulkAssignManager`) loop with sequential `await` instead of batched updates.

Plus 12 medium/low findings (in-process Maps that won't multi-instance scale, missing slow-query logging, missing server-container healthcheck, missing pinia `reset()` on 8+ per-project views, etc.).

**Total: 22 findings.** None block the prod cutover but most should be on the Q3 hardening list.

---

## Findings

| # | Severity | Area | File:line | Issue |
|---|---|---|---|---|
| 1 | **Critical** | reliability | `ai/backlog.service.ts:114-147` | `accept()` has no concurrency guard. A double-clicked "Accept backlog" or a CSRF retry duplicates every Epic + Task. Other write paths use `updateMany({where: {status: {not: 'processing'}}})` or sprint status re-read for the same protection (`agile.service.ts:530`); this one needs the same. |
| 2 | **Critical** | reliability | `cahier-des-charges/cahier-des-charges.service.ts:649-695` | `savePersistedCahier()` no concurrency guard. Two simultaneous saves (PM double-tap, frontend retry on slow network) → last-write-wins on `Project.aiOutput` AND both fire SpecificationTeam notifications + activity rows. Wrap in a transaction that re-reads `aiOutput.savedAt` and rejects if it changed underneath. |
| 3 | **High** | perf | `projects/projects.service.ts:710-730` | `saveFieldValues` transaction loops `findUnique` + `upsert` per field sequentially. For a PM saving 30 questionnaire fields this is 60 round-trips holding the tx open. Batch the existing-row check with one `findMany({where: {projectId, projectFieldId: {in:[...]}}})` outside the tx and use `createMany({skipDuplicates: true})` + a single `updateMany`. |
| 4 | **High** | perf | `meetings/meetings.service.ts:341-359` | `getByProject` returns ALL transcripts for a project with no `take`. For a 6-month project with weekly meetings this is fine; for a long-running engagement (50+) the response payload grows linearly. Add `take: 50` + cursor pagination. |
| 5 | **High** | perf | `dashboard/dashboard.service.ts:46-65` | `getWorkloads()` calls `appUser.findMany({where: {role: 'ProjectManager', isActive: true}})` with no `take` and includes `managedProjects` per row. Add cache (sibling `analytics.service` does this) + `take: 200`. |
| 6 | **High** | perf | `dashboard/dashboard.service.ts:127-133` | `getOverdueProjects()` returns every overdue project unbounded. Add `take: 100` + sort by `endDate` ASC so worst-offenders surface first. |
| 7 | **High** | reliability | `meetings/live-meeting.service.ts:22-74` | `transcribeChunk` swallows EVERY failure and returns `{text: '', language: null}` — the live-meeting UI sees the user's words silently disappear on 4xx/5xx/timeout. Should at least return a typed error the gateway can surface ("transcription temporarily unavailable, retrying..."), or retry once on 5xx before swallowing. |
| 8 | **High** | perf | `projects/projects.service.ts:586-635` | `bulkArchive`/`bulkUpdateStatus`/`bulkAssignManager` loop with `await this.archive(id, ...)` sequentially. For BULK_MAX=500 each batch is 500 sequential service calls. `bulkAssignManager` could replace the loop with a single `updateMany({where: {id: {in: candidates}}, data: {projectManagerId: managerId}})` + a per-id audit + notify fan-out via `Promise.allSettled`. |
| 9 | **High** | perf | `work-packages/work-packages.service.ts:833-856` | `bulkAssign` post-transaction loop awaits `ensureProjectMembership` + `notifyEnhanced` sequentially per assignee. For a batch of 30 distinct assignees that's 60 sequential awaits. Use `Promise.allSettled(...)`. |
| 10 | **Medium** | perf | `views/PMDashboardView.vue:334-359` | `loadMilestones()` is N+1: one `/pm/projects/:id/milestones` call per project (capped at 10). PM dashboards routinely have >10 projects. Add a `GET /pm/milestones?projectIds=...` aggregator. |
| 11 | **Medium** | reliability | `collaboration/collaboration.service.ts:53-67` | `pendingEmbeds` Map of `setTimeout` handles is never cleared on shutdown. Add `OnModuleDestroy` to `for (const h of this.pendingEmbeds.values()) clearTimeout(h)`. Currently only an issue in long-running dev sessions / multi-instance scaling. |
| 12 | **Medium** | scale | `meetings/live-copilot.service.ts:48,54`, `collaboration/collaboration.service.ts:31`, `ai/backlog.service.ts:27` | In-process state (sessions Map, pendingEmbeds Map, lastPreviewAt Map) blocks horizontal scaling. Documented in `AI_MODULE_GUIDE.md §21` but worth a single tracked ticket. Move to Redis when ready to scale out. |
| 13 | **Medium** | observability | `prisma/prisma.service.ts`, `prisma/prisma.module.ts` | Prisma client is created with no `log` config and no `$on('query')` handler. Slow queries are invisible in prod. Add `log: ['warn', 'error']` (or `['query']` gated on `NODE_ENV !== 'production'`) and emit a pino warn when `params.event.duration > 500ms`. |
| 14 | **Medium** | infra | `deploy/neoleadge/docker-compose.prod.yml:39-107` | Server, transcription, and web containers have no `healthcheck:` block. `depends_on` only conditions on postgres `service_healthy`; web/server start order is purely "started", so a cold boot can serve traffic before NestJS has registered routes. Add `healthcheck: { test: ["CMD-SHELL", "curl -fsS http://localhost:3000/health || exit 1"], interval: 10s, ...}` to server. |
| 15 | **Medium** | observability | `analytics/analytics-cache.service.ts:8-25` | Cache is DB-backed — every `cache.get()` is a round-trip even on a hit. For analytics this is fine (the alternative — a 200-row aggregation — is far worse) but flag because every hot read goes through `AnalyticsCache.findUnique`. If it ever becomes hot, swap to an in-process LRU with TTL. |
| 16 | **Medium** | scale | `web/Transcription/app.py:51-55` | `_model_lock` and `_embed_lock` serialise ALL transcription + embedding calls. By design (single CPU model in memory) but explains long queue times under concurrent meeting load. Document a clear "max one in-flight transcribe per container" guarantee + size the container count accordingly. |
| 17 | **Medium** | scale | `prisma/schema.prisma` (`WorkPackage` model L707-714, several other models) | Several composite indexes look reasonable but `ProjectFieldValue` has no `@@index([projectId])` — only the `@@unique([projectId, projectFieldId])` covers it. Most queries DO use both fields so the unique-index serves; flag for verification with `EXPLAIN` on the hot `saveFieldValues` upsert path. |
| 18 | **Low** | reliability | `prisma/prisma.module.ts:42-46` | `onApplicationShutdown` is empty with a "clients disconnect on their own" comment. NestJS guarantees Prisma disconnect via shutdown hooks but explicitly calling `client.$disconnect()` here closes the gap when running outside the standard lifecycle (e.g., CLI scripts importing the module). |
| 19 | **Low** | frontend | 8 per-project views (`PMProjectDetailView.vue`, `PMProjectFullView.vue`, `WorkPackagesView.vue`, `GanttView.vue`, `AssignTasksView.vue`, `SprintBoardView.vue`, `TimeTrackingView.vue`, `ProjectActivityView.vue`) | `CLAUDE.md` requires per-project stores call `store.reset()` as the first line of `onMounted`. Only `BacklogGeneratorView`, `BacklogView`, `KanbanBoardView`, `MembersView` + 3 member views do. The other 8 risk briefly rendering the previous project's data on cross-project navigation. |
| 20 | **Low** | perf | `collaboration/collaboration.gateway.ts:82-88` | `userNameCache` and `sessionCache` are never expired except on disconnect / session-cache TTL miss. Realistically bounded by number of distinct users, so not a leak — but a small LRU would be safer than an unbounded Map. |
| 21 | **Low** | observability | `auth/auth.service.ts:309`, `users/users.service.ts:211` | Bare `void this.mail.send(...).catch(...)` is fine, but the mail sender has no metric / counter — failed delivery is invisible unless someone reads the warn-level log. A simple `Counter` injected via a `MetricsService` would let alerts trigger on >5% mail failure rate. |
| 22 | **Low** | perf | `agile/agile.service.ts:575-594` | `closeSprint` post-transaction notification loop is sequential (`for (const [userId, agg] of movedAssignees)` with `await`). For a sprint close with 20 unique assignees that's 20 sequential `notifyEnhanced` calls. `Promise.allSettled` cuts it to one Socket.IO emit batch. |

---

## Quick wins (top 5 highest-ROI, < 1 day each)

1. **#1 + #2: Concurrency guards on `backlog.accept` and `cahier.savePersistedCahier`** — both follow the same pattern. Wrap each in `prisma.$transaction` that re-reads a `lastModifiedAt` field and bails on mismatch. The `meetings.aiStatus = 'processing'` guard in `ai.service.ts:60-80` is the reference implementation.

2. **#3: Batch `saveFieldValues`** — replace the per-field loop with one batched `findMany` for the optimistic-lock check, then `createMany`/`updateMany`. Cuts a 30-field save from ~60 round-trips to 3.

3. **#13: Slow-query logging** — single change in `prisma.module.ts` to pass `{ log: [{ emit: 'event', level: 'query' }] }` and a `client.$on('query', e => { if (e.duration > 500) logger.warn(...) })`. Surface the top offenders in the next perf pass.

4. **#14: Server healthcheck** — 4-line YAML change adds proper readiness gating. Without it, Caddy proxies to a half-booted container during deploy windows.

5. **#9: `bulkAssign` parallel notify** — change `for (...) await notify(...)` to `await Promise.allSettled(byAssignee.map(notify))`. Cuts wall-time on a 30-WP assign from ~3s to ~300ms.

---

## Architectural (bigger lifts)

- **Move in-process state to Redis** (#12): the cahier preview cooldown, live-copilot sessions, collab presence/rate-buckets, and embedding debouncer all assume single-instance. Document the constraint or invest in Redis-backed Maps now while the surface is small. The Phase 4 rollout already brought infra changes (pgvector image, FastAPI restart); piggy-backing a Redis container is cheap.

- **N+1 milestone aggregator** (#10): the `/pm/projects/:id/milestones` per-project fanout is a symptom — the dashboard wants "everything overdue/upcoming across this PM's projects". Adding `GET /pm/milestones?upcoming=14&projectIds=...` is one new endpoint that closes the gap for ~3 dashboard widgets.

- **Bulk operations refactor** (#8): the bulkArchive/bulkUpdateStatus/bulkAssignManager trio all loop calling the per-row method. A shared `bulkApply(ids, mutation, audit, notify)` helper that batches the DB write and fans the audit+notify in parallel would eliminate the duplication and the perf cost.

- **Transcription concurrency** (#16): the FastAPI single-lock model caps throughput at one chunk at a time. For live-meeting copilots running in parallel this is the wall. Path forward is either (a) horizontal scale of transcription containers behind a queue, or (b) batched chunking (already 25 MB cap but no queue management upstream). Don't fix until you actually see queue depth >5 in prod metrics — current load is comfortably below.

- **Connection pool sizing** (#17 adjacent): `DATABASE_URL` has no `?connection_limit=...`. Prisma default is `num_physical_cpus * 2 + 1`; on a 4-vCPU container that's 9 connections. Postgres `mem_limit: 1g` can comfortably support 50+ connections. Make the limit explicit in `.env.example` + `docker-compose.prod.yml` so it doesn't silently drift on a CPU upgrade.

---

## Out of scope (other forks)

Security findings, frontend bundle deep-dive, and database integrity audit are handled by sibling forks (`SECURITY_AUDIT.md`, `FRONTEND_AUDIT.md`). Anything noted here that overlaps is annotated.
