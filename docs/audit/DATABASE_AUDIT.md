# Database & Data Integrity Audit — NeoLeadge

**Scope:** PostgreSQL 16 + pgvector schema, migrations, Prisma 7 service-layer
read patterns, multi-tenancy, data lifecycle, operational posture.

**Snapshot:** master branch + `nest-back` commit `2bec9c2`. 44 models,
20 tracked migrations, 17 archived pre-Postgres SQL files, 5 raw-SQL writers
on three pgvector(384) columns.

**Method:** read `schema.prisma`, every `migration.sql`, every
`prisma.<model>.findFirst|findUnique|findMany|create|update` call site in
`web/back-nest/src/**`, plus the deployment compose + CI workflows.

---

## Executive summary

The schema is in solid shape — explicit cascade strategy, named indexes
on every hot query, soft-delete on the six right tables, and a documented
JSON-column policy. **No CRITICAL data-corruption risks** were found.

There are however **6 HIGH findings** that are real production
incidents waiting to happen:

1. **Soft-delete bypass** — at least 11 read sites do not filter
   `isDeleted=false` on `Project`. Two of them return `aiOutput` (the
   cahier JSON) and `projectManagerId` for soft-deleted projects, which
   means soft-deleted projects continue producing AI side effects.
2. **wp-comments.update** lets users edit soft-deleted comments.
3. **pgvector indexer UPDATE has no projectId guard** — a bug that
   passes the wrong (id, projectId) combo would silently overwrite a
   vector belonging to another tenant.
4. **`prisma migrate deploy` runs unattended in the prod entrypoint**
   with no documented rollback if a migration mid-fails.
5. **No retention sweep on `AuditLog`, `Notification`, `AiUsage`** — the
   only retention cron is for meeting audio files. Tables grow unbounded.
6. **`passwordResetToken` is not `@unique`** — two users could
   theoretically receive the same token (extremely unlikely; nice to
   harden).

Plus 10 MEDIUM (scalability, future drift) and 6 LOW (hygiene). Full list
below.

---

## Findings table

### CRITICAL

_None._

### HIGH

| # | Finding | Where | Recommended fix |
|---|---|---|---|
| H1 | **`Project.findUnique` reads aiOutput / projectManagerId WITHOUT `isDeleted=false`** at 8 sites. A soft-deleted project is still queryable for its cahier JSON, PM ID, and project name — meaning the cahier endpoints, the `ensureProjectMembership` side-effect, and the cahier-edit endpoint still operate on trashed projects. | `src/cahier-des-charges/cahier-des-charges.service.ts:529,658,748,800,822,858`, `src/ai/agent/tools/project-tools.ts:96`, `src/work-packages/work-packages.service.ts:55,138,738,772`, `src/dashboard/dashboard.service.ts:115`, `src/projects/phase-gate.service.ts:70`, `src/project-members/project-members.service.ts:43`. | Convert every `findUnique({ where: { id } })` on `Project` to `findFirst({ where: { id, isDeleted: false } })`. Long term: add `$extends` query interceptor (see TODO in `prisma.module.ts:31`) when the type-cast refactor is feasible. |
| H2 | **`wp-comments.update` doesn't filter `isDeleted`** — a soft-deleted comment can still be edited (and the edit will mark `updatedAt`). `comments.service.update` correctly filters; `wp-comments` was missed. | `src/work-packages/wp-comments.service.ts:93` | `findUnique` → `findFirst({ where: { id, isDeleted: false } })`. |
| H3 | **pgvector `UPDATE` statements have no projectId scope** — the indexer's row-id-only WHERE means a bug that passes the wrong (id, projectId) combo overwrites a vector for a row in a different project. This is defence-in-depth; today the only callers pass the right pair, but the SQL itself is the safety net. | `src/ai/embeddings/embedding-indexer.service.ts:84-89`, `src/commands/backfill-embeddings.ts:144,217,282` | Add an INNER JOIN to the parent table in the UPDATE: e.g. `UPDATE "TranscriptSegments" s SET embedding = $1::vector FROM "MeetingTranscripts" m WHERE s.id = $2 AND s."transcriptId" = m.id AND m."projectId" = $3`. Pass projectId as $3. Same for ProjectFieldValues + MeetingTranscripts. |
| H4 | **No documented rollback for `prisma migrate deploy` in the prod entrypoint** — `Dockerfile` CMD is `npx prisma migrate deploy && node dist/src/main.js`. If a migration partially fails (e.g. one ALTER TABLE succeeds, the next fails), the entrypoint returns non-zero and the container restarts in a loop. The `_prisma_migrations` row is left marked as `failed=true` and the cluster is wedged. | `web/back-nest/Dockerfile`, `docs/DATABASE_SCHEMA.md` (no rollback section) | Document the recovery procedure in the schema doc: `prisma migrate resolve --rolled-back <name>` then re-apply manually. Consider splitting migration into a separate init container so a partial failure doesn't loop-crash the API. |
| H5 | **No retention sweep on `AuditLog`, `Notification`, `AiUsage`**. Only meeting audio is purged via `retention.service`. The `AiUsage` table gets 1 row per LLM call (including embed calls — hundreds per project); on a busy tenant it could reach hundreds of MB in a few months. `AuditLog` is append-only forever. `Notification` has no max age. | `src/retention/retention.service.ts` (only purges audio) | Add per-table retention windows: AuditLog 2y, Notification (read + > 30 days) 30d, AiUsage 90d. New cron with `@Cron('0 4 * * *')`. Document the cron in `docs/DATABASE_SCHEMA.md §19`. |
| H6 | **`AppUser.passwordResetToken` is not `@unique`** — a UUID collision is astronomically unlikely, but the column accepts any string. If `crypto.randomUUID()` is ever replaced with a weaker generator, two users could share a reset token. | `prisma/schema.prisma:68` | Add `@unique` to `passwordResetToken`. Migration: `CREATE UNIQUE INDEX CONCURRENTLY "AppUsers_passwordResetToken_key" ON "AppUsers"("passwordResetToken") WHERE "passwordResetToken" IS NOT NULL;` (partial index — NULLs aren't unique). |

### MEDIUM

| # | Finding | Where | Recommended fix |
|---|---|---|---|
| M1 | **HNSW indexes will need tuning past ~100k rows.** Current params `m=16, ef_construction=64` are tuned for 10k–100k. Per pgvector docs, at 1M+ rows `m=24, ef_construction=128` is more appropriate. | `prisma/migrations/20260517120100_pgvector_columns_and_indexes/migration.sql:28-38` | Add a one-line note in `docs/AI_MODULE_GUIDE.md §11` documenting the re-tune trigger (~ 100k vectors per table). Drop + `CREATE INDEX CONCURRENTLY` to re-tune without downtime. |
| M2 | **Vector dimension is hard-coded to 384.** Swapping the embedding model to e.g. e5-large (1024-d) means a full re-migration: ALTER COLUMN, re-backfill. There's no compatibility shim. | `prisma/migrations/20260517120100_*/migration.sql:17-19` | Document the swap procedure (`ADD COLUMN embedding_v2 vector(1024)`, run dual backfill, swap in semantic-tools, drop old). Not urgent — single embedding model in scope today. |
| M3 | **17 archived pre-Postgres SQL files at `prisma/archive/`** — CLAUDE.md says they're kept for traceability, but they're large (some 200+ LOC), they include `migration-permissions.sql` and `migration-project-members.mysql-legacy.sql`, and a future automation could accidentally pick them up if `prisma/archive/**/*.sql` is globbed. | `web/back-nest/prisma/archive/*.sql` (17 files) | Move them to a dated tarball outside the prisma directory or a separate branch. At minimum, add a top-level `prisma/archive/README.md` warning "DO NOT APPLY". |
| M4 | **`AuditLog` is append-only but not tamper-evident.** No hash chain, no signing. An admin with DB access can edit rows. For "audit log" semantics that hold up in a compliance review, consider a `previousLogHash` column. | `prisma/schema.prisma:490-505` (AuditLog model) | Not urgent unless compliance is a near-term requirement. If yes: add `previousLogHash`, compute `hash(prev || row)` on insert, periodic external attestation. |
| M5 | **`MeetingTranscript.aiStatus` allows any string.** Schema is `String @default("none") @db.VarChar(20)`. Values are `'none' \| 'processing' \| 'completed' \| 'failed'` but the DB doesn't enforce it. A typo from a service writes silently. | `prisma/schema.prisma:335` | Add a CHECK constraint: `ALTER TABLE "MeetingTranscripts" ADD CONSTRAINT "MeetingTranscripts_aiStatus_check" CHECK ("aiStatus" IN ('none','processing','completed','failed'));`. Same pattern applies to several other enum-as-string columns (status, priority, type). |
| M6 | **`Notification.entityType` has no FK** because it's polymorphic — it points to project/wp/comment/etc. by type. This is fine, but there's no compound index `(entityType, entityId)` paired with `userId`. The current `@@index([entityType, entityId])` is project-wide, not user-scoped. | `prisma/schema.prisma:466` | Low priority. If queries like "show me notifications about this entity for this user" become hot, add `@@index([userId, entityType, entityId])`. |
| M7 | **`AppUser.preferences` stored as `String @db.Text`, not `Jsonb`.** Per `docs/DATABASE_SCHEMA.md §17` this was a deliberate decision to avoid Jsonb GIN-index overhead on a tiny blob, but the trade-off is no server-side filtering on preference keys (every read pulls the full blob, parses it client-side). | `prisma/schema.prisma:62` | Keep as-is unless preference-based queries appear. Migrating to `Jsonb` later is a single ALTER TABLE. |
| M8 | **Prisma's `log:` option is not set anywhere.** No slow-query logging in prod. A 5s query gets the same log line as a 5ms one (none). | `src/prisma/prisma.module.ts:22-25` | Add `log: [{ level: 'warn', emit: 'event' }, { level: 'error', emit: 'event' }]` and a `client.$on('query', e => { if (e.duration > 100) logger.warn(...) })` wrapper. Cheap win. |
| M9 | **Connection pool size is the driver default (10).** `@prisma/adapter-pg` uses the `pg` Pool default. The server container has `mem_limit: 768m` and `NODE_OPTIONS: "--max-old-space-size=512"`. 10 concurrent transactions is fine, but it's not documented anywhere. | `src/prisma/prisma.module.ts:21-22`, `deploy/neoleadge/docker-compose.prod.yml:97` | Document the pool size in the AI_MODULE_GUIDE runbook. Make it configurable via `DATABASE_POOL_SIZE` if/when concurrent traffic warrants. |
| M10 | **`ProjectField` foreign key uses `onDelete: NoAction`** but `ProjectFieldValue.projectFieldId` is also `NoAction` — so deleting a ProjectField is impossible if any value row exists. Was probably meant as `Restrict`. Same semantic but more explicit. | `prisma/schema.prisma:200` | Cosmetic. Change to `Restrict` to communicate intent. |

### LOW

| # | Finding | Where | Recommended fix |
|---|---|---|---|
| L1 | All Prisma migrations are tracked + idempotent (use `IF NOT EXISTS` / `IF EXISTS`). No issues. | All `prisma/migrations/*/migration.sql` | None. ✓ |
| L2 | All `JSON.parse` on `Project.aiOutput`, `AppUser.preferences`, and `AuditLog.changes/metadata` are wrapped in try/catch. ✓ Verified at 11 call sites. | (no fix) | None. |
| L3 | The two pgvector migrations correctly use `-- prisma:no-transaction` + `CREATE INDEX CONCURRENTLY` so they don't block writes. ✓ | `prisma/migrations/20260517120100_*` | None. |
| L4 | All 4 embed-site callers consistently use `'passage'` for indexing and `'query'` for retrieval. ✓ The e5-prefix consistency is preserved. | `src/ai/embeddings/embedding-indexer.service.ts:54`, `src/commands/backfill-embeddings.ts:122,206,267`, `src/ai/agent/tools/semantic-tools.ts:74`, `src/ai/eval-retrieval.controller.ts:114`. | None. |
| L5 | All 17 known soft-delete reads on `ProjectComment`, `WorkPackageComment`, `ProjectAttachment`, `WorkPackageAttachment` are correctly filtered (only one gap — H2). | (no fix beyond H2) | None. |
| L6 | The 8 hot-index documented in `docs/DATABASE_SCHEMA.md §18` all exist in the schema with the documented columns. ✓ Confirmed presence of `(userId, isRead, createdAt DESC)`, `(projectId, isDeleted, status)`, etc. | `prisma/schema.prisma:463-715` | None. |

---

## Multi-tenancy spot-check

The semantic-tools agent SQL filters by `m."projectId" = $2` and `pfv."projectId" = $2` correctly (`semantic-tools.ts:139,211`). The new `eval-retrieval.controller.ts` also filters (lines 140, 176). The only gap is the indexer UPDATE statements (H3 above).

`ProjectAccessGuard` is the auth-layer enforcement (`common/guards/project-access.guard.ts`). Service queries that don't also filter would only matter if the guard is bypassed — but defence-in-depth is the point.

---

## GDPR / right-to-be-forgotten check

The cascade strategy is correct for the "user deleted, content survives" model:
- `CahierFeedback.user`, `Notification.actor`, `WorkPackage.assignee/parent/sprint/version/boardColumn`, `AppUser.team` → `SetNull` ✓
- `ProjectActivity.user` was fixed in `20260510120000_audit_fixes_indexes_fk_decimal` (NoAction → SetNull) ✓
- `AuditLog.user` → `NoAction` (compliance) ✓
- `Notification.user` → `Cascade` (personal, removed with user) ✓

**Potential PII leak:** `MeetingAttendee.externalName` and `externalEmail` (schema lines 870-871) are free-text. If GDPR right-to-erasure is invoked, those rows are not automatically scrubbed when the underlying `AppUser` is deleted — they were external attendees by definition. Document a manual SQL recipe in the GDPR runbook.

---

## Recommended improvements — ranked by ROI

1. **H1 (soft-delete on Project reads)** — highest impact, lowest effort. ~11 one-line fixes across 6 files. Closes a real "PM trashes project, AI still operates on it" gap.
2. **H3 (pgvector UPDATE projectId scope)** — 4 raw-SQL statements get an extra JOIN. Defence-in-depth for the most data-sensitive write path in the system.
3. **H5 (retention sweep for AuditLog / Notification / AiUsage)** — ~80 LOC new service + `@Cron`. Prevents linear unbounded growth on three tables.
4. **M8 (Prisma slow-query log at >100ms)** — single-config-line. Wins observability for ~0 cost.
5. **H2 (wp-comments.update isDeleted filter)** — single line.
6. **H4 (document migration rollback procedure)** — pure docs work; matters the moment a real prod migration fails.
7. **M5 (CHECK constraints on enum-as-string columns)** — one migration. Catches typos at write time.
8. **M3 (move `prisma/archive/`)** — pure hygiene, eliminates a future foot-gun.

**Estimated total work:** 6-8 hours for items 1–6 (the HIGH set) + tests. Items 7–8 + the rest of MEDIUM are 1-2 day follow-ups.

---

## What's NOT a finding

The following were checked and look correct:

- **Cascade rules** in `schema.prisma` match `docs/DATABASE_SCHEMA.md §16`. No surprises.
- **The `mysql-legacy` SQL files** at `prisma/archive/` are not referenced by any CI workflow (`.github/workflows/*.yml`) or deploy script. Safe.
- **The pgvector extension migration** correctly precedes the columns migration in timestamp order.
- **All `@@unique` constraints** match the business-logic expectations (one field value per `(projectId, projectFieldId)`, one validation per `(projectId, validator, phase)`, one member per `(projectId, userId)`, etc.).
- **The `_prisma_migrations` table** is correctly excluded from `pg_dump` backups via the standard `--exclude-table-data=_prisma_migrations` pattern (not verified — recommend confirming in your backup script).

---

*Report generated 2026-05-19. Codebase snapshot: branch `nest-back` at commit `2bec9c2`. Database schema: 44 models, 20 tracked migrations, 17 archived legacy SQL files, PostgreSQL 16 + pgvector 0.8.2.*
