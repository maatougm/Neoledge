# Phase 9 — Database Fixes Applied

All HIGH and MEDIUM items from `docs/qa/database.md` are resolved.
Pre-verified items (PortalSignoff `@@unique`, GanttBaseline unique) are confirmed in place and untouched.

---

## Changes Made

### 1. SystemStatusService — soft-delete filter (HIGH)

**File:** `web/back-nest/src/system-status/system-status.service.ts:29`

Added `where: { isDeleted: false }` to `project.count()` and `project.groupBy()`.
The admin dashboard `projectTotal` and `projectByStatus` now exclude soft-deleted rows.

---

### 2. WorkPackage composite indexes (HIGH)

**Schema:** `web/back-nest/prisma/schema.prisma` — added to `WorkPackage` model:
```prisma
@@index([projectId, isDeleted, status])
@@index([assigneeId, isDeleted])
```

**Migration:** `prisma/migration-wp-indexes.sql`

Apply command:
```
C:/xampp/mysql/bin/mysql.exe -u root -h 127.0.0.1 -P 3306 NeoLeadgeDeployment < prisma/migration-wp-indexes.sql
```

---

### 3. Notification covering index (HIGH)

**Schema:** added to `Notification` model:
```prisma
@@index([userId, isRead, createdAt(sort: Desc)])
```

**Migration:** `prisma/migration-db-hardening.sql` (item 1)

Apply command:
```
C:/xampp/mysql/bin/mysql.exe -u root -h 127.0.0.1 -P 3306 NeoLeadgeDeployment < prisma/migration-db-hardening.sql
```

---

### 4. WorkPackage FK drift — schema aligned to live DB (MEDIUM)

**Schema:** `web/back-nest/prisma/schema.prisma`

Changed `onDelete: NoAction` to `onDelete: SetNull` on the five nullable FK relations that already have `ON DELETE SET NULL` in the live DB (applied via `migration-sprint0.sql`):

- `assignee` (assigneeId → AppUsers)
- `parent` (parentId → WorkPackages, self-referencing)
- `sprint` (sprintId → Sprints)
- `version` (versionId → Versions)
- `boardColumn` (boardColumnId → BoardColumns)

No new SQL needed — the live DB constraints are already correct. This is a schema-only sync.

---

### 5. PortalToken redundant index removed (MEDIUM)

**Schema:** removed `@@index([token])` from `PortalToken`.

The `@unique` on `token` already creates a B-tree index. The extra `@@index` was duplicating index storage and write amplification.

**Migration:** `prisma/migration-db-hardening.sql` (item 4) drops `PortalTokens_token_idx`.

---

### 6. migration-sprint0.sql Notifications ALTER idempotency (MEDIUM)

**File:** `web/back-nest/prisma/migration-sprint0.sql`

Changed all five `ADD COLUMN` statements to `ADD COLUMN IF NOT EXISTS` and wrapped the FK with a `DROP FOREIGN KEY IF EXISTS` before re-adding. MariaDB 10.2+ (XAMPP ships 10.4) supports `IF NOT EXISTS` for `ADD COLUMN`. The migration is now safe to re-run against an already-migrated database.

---

### 7. TranscriptSegment index on transcriptId (LOW promoted to fix)

**Schema:** added to `TranscriptSegment` model:
```prisma
@@index([transcriptId])
```

**Migration:** `prisma/migration-db-hardening.sql` (item 2)

---

### 8. HourlyRate unique constraint (LOW promoted to fix)

**Schema:** added to `HourlyRate` model:
```prisma
@@unique([userId, projectId, validFrom])
```

**Migration:** `prisma/migration-db-hardening.sql` (item 3)

**MySQL NULL caveat documented in schema:** MariaDB treats NULL as distinct in UNIQUE indexes, so two rows with `(userId, NULL, validFrom)` do not conflict at the DB level. Application code must use `findFirst + create` (never `prisma.upsert`) for global rates (`projectId = NULL`). This caveat is now documented in a comment on the `HourlyRate` model in `schema.prisma`.

---

### 9. seed.ts activity action casing (LOW)

**File:** `web/back-nest/prisma/seed.ts`

Normalised all `action` values in the activities block to lowercase to match the convention used by `analytics.service.ts` and the `analyticsActivities` block:

| Before | After |
|--------|-------|
| `STATUS_CHANGE` | `status_change` |
| `CREATE` | `create` |
| `ASSIGN` | `assign` |
| `VALIDATE` | `validate` |

---

### 10. MeetingTranscript.aiStartedAt field added (pre-existing build error)

**File:** `web/back-nest/prisma/schema.prisma` — `MeetingTranscript` model

`ai.service.ts` referenced `aiStartedAt` in both `updateMany` calls but the field was absent from the schema, causing a build error. Added `aiStartedAt DateTime?` to the model. A corresponding `ADD COLUMN IF NOT EXISTS` should be applied to the live DB.

Add to `prisma/migration-db-hardening.sql` before running on a live DB that already has the other columns:
```sql
ALTER TABLE MeetingTranscripts ADD COLUMN IF NOT EXISTS aiStartedAt DATETIME(3) NULL;
```

---

## Pre-verified (no action taken)

- `PortalSignoff @@unique([portalTokenId])` — confirmed present in schema (Sprint 9, `migration-portal-signoff-unique.sql`).
- `GanttBaseline @@unique([projectId, snapshotName, workPackageId])` — confirmed present in schema (Phase 9 Wave 1, `migration-gantt-baseline-unique.sql`).

---

## Migration Apply Order

Run on target database in this order:

```
C:/xampp/mysql/bin/mysql.exe -u root -h 127.0.0.1 -P 3306 NeoLeadgeDeployment < prisma/migration-wp-indexes.sql
C:/xampp/mysql/bin/mysql.exe -u root -h 127.0.0.1 -P 3306 NeoLeadgeDeployment < prisma/migration-db-hardening.sql
```

Then regenerate the Prisma client:

```
cd web/back-nest && npx prisma generate
```

Build verified green after all schema changes.
