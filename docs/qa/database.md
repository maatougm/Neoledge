# Database Review — NeoLeadge (MariaDB / Prisma 7)

Files opened:
- `web/back-nest/prisma/schema.prisma` (full, 1026 lines)
- `web/back-nest/prisma/migration-sprint0.sql`
- `web/back-nest/prisma/migration-permissions.sql`
- `web/back-nest/prisma/seed.ts`
- `web/back-nest/prisma/seed-openproject.ts`
- `web/back-nest/prisma/seed-notifications.ts`
- `web/back-nest/prisma/seed-permissions.ts`
- `web/back-nest/src/roles/roles.service.ts`
- `web/back-nest/src/ai/ai.service.ts`
- `web/back-nest/src/health/health.controller.ts`
- `web/back-nest/src/system-status/system-status.service.ts`
- `web/back-nest/src/work-packages/work-packages.service.ts`
- `web/back-nest/src/analytics/analytics.service.ts`
- `web/back-nest/src/projects/projects.service.ts`
- `web/back-nest/src/search/search.service.ts`
- `web/back-nest/src/portal/portal.service.ts`
- `web/back-nest/src/gantt/gantt.service.ts`
- `web/back-nest/src/wiki/wiki.service.ts`
- `web/back-nest/src/team-planner/team-planner.service.ts`

---

## Findings

---

### [HIGH] SystemStatusService counts deleted projects in totals

- File: `web/back-nest/src/system-status/system-status.service.ts:29`
- Category: soft-delete
- Evidence:
```ts
this.prisma.project.count(),
this.prisma.project.groupBy({
  by: ['status'],
  _count: { _all: true },
}),
```
- Impact: `projectTotal` and `projectByStatus` include soft-deleted rows. The admin dashboard shows inflated counts and deleted projects appear in the `projectByStatus` breakdown, potentially exposing internal state.
- Fix: Add `where: { isDeleted: false }` to both the `count()` call and the `groupBy()` call, matching the pattern already used in `dashboard.service.ts:23`.

---

### [HIGH] WorkPackage list queries missing composite index for common filter combinations

- File: `web/back-nest/prisma/schema.prisma:680`
- Category: index
- Evidence:
```prisma
@@index([projectId, status])
@@index([assigneeId])
@@index([parentId])
@@index([sprintId])
@@index([versionId])
@@index([boardColumnId])
```
The service builds `where` clauses combining `projectId + isDeleted + status + assigneeId + sprintId + versionId` simultaneously. The `isDeleted` column has no index at all on `WorkPackages`, and no composite index covers `(projectId, isDeleted, status)`.
- Impact: With large WorkPackages tables, every list query performs a partial index scan on `(projectId, status)` and then applies a row-by-row `isDeleted` filter. As rows accumulate the dead-row filter cost becomes significant. The `findForAssignee` path (`assigneeId + isDeleted`) also falls back to the `assigneeId` single-column index plus a full filter pass.
- Fix:
```sql
ALTER TABLE WorkPackages
  ADD INDEX idx_wp_proj_deleted_status (projectId, isDeleted, status),
  ADD INDEX idx_wp_assignee_deleted (assigneeId, isDeleted);
```
Drop the now-redundant `idx_wp_project_status` only after verifying the new composite index is used by EXPLAIN.

---

### [HIGH] WikiPage slug-uniqueness check does not filter deleted pages, causing slug collisions after soft-delete

- File: `web/back-nest/src/wiki/wiki.service.ts:56`
- Category: soft-delete
- Evidence:
```ts
while (await this.prisma.wikiPage.findFirst({ where: { projectId, slug } })) {
  slug = `${slugify(dto.title)}-${i++}`;
}
```
- Impact: A deleted page still holds its slug in this loop, so creating a page with the same title as any previously deleted page always appends a numeric suffix (`-1`, `-2` …) even though the slug is available. This is a UX regression: after deleting `architecture` and recreating it, the URL becomes `/wiki/architecture-1`.
- Fix: Add `isDeleted: false` to the `findFirst` filter. Also apply the same fix to `softDelete` and `movePage` at lines 121 and 132 which look up pages without filtering `isDeleted`, allowing moves/deletes to match already-deleted pages:
```ts
// line 56
{ where: { projectId, slug, isDeleted: false } }
// line 121 (softDelete lookup)
{ where: { projectId, slug, isDeleted: false } }
// line 132 (movePage lookup)
{ where: { projectId, slug, isDeleted: false } }
```

---

### [HIGH] Notification index order suboptimal for unread badge query

- File: `web/back-nest/prisma/schema.prisma:437`
- Category: index
- Evidence:
```prisma
@@index([userId, isRead])
@@index([userId, createdAt])
```
The `userId, isRead` index exists but the typical unread-badge query is `WHERE userId = ? AND isRead = false ORDER BY createdAt DESC`. With two separate indexes, MySQL must choose one and apply the other as a filter or filesort. An unread-count query (`COUNT(*) WHERE userId = ? AND isRead = false`) is fine with the current index, but the paginated notification list query requires a sort that is not covered.
- Fix: Add a covering index for the full unread list pattern:
```sql
ALTER TABLE Notifications
  ADD INDEX idx_notif_user_read_created (userId, isRead, createdAt DESC);
```
Drop `idx_notif_user_read` (the `userId, isRead` index) after confirming the new one is picked up, since it is a prefix of the new index.

---

### [MEDIUM] `UserRoleAssignment` @@unique with nullable `projectId` — MySQL NULL-distinct caveat documented but unique constraint still unreliable on direct Prisma `upsert`

- File: `web/back-nest/prisma/schema.prisma:131`, `web/back-nest/prisma/seed-permissions.ts:91`
- Category: unique-null
- Evidence:
```prisma
@@unique([userId, roleId, projectId], name: "user_role_project_uq")
```
```ts
// MySQL treats NULL as distinct in unique keys, so we can't rely on the
// compound unique for NULL projectId. findFirst + create keeps it idempotent.
const existing = await prisma.userRoleAssignment.findFirst({
  where: { userId: u.id, roleId, projectId: null },
  select: { id: true },
});
if (!existing) {
  await prisma.userRoleAssignment.create({ ... });
}
```
The seed correctly avoids `upsert` for the `projectId = NULL` case. However, `RolesService.assignRole` at line 160–166 also uses `findFirst` then `create`, which is correct. The risk is that any future developer calling `prisma.userRoleAssignment.upsert({ where: { user_role_project_uq: { userId, roleId, projectId: null } } })` will silently create duplicate global assignments because MySQL treats each NULL as distinct and the unique index will not prevent it.
- Impact: Duplicate global role assignments for the same user+role would grant elevated permissions that can't be revoked by deleting only one row, and `assignmentCount` in role summaries would be wrong.
- Fix: Add a server-level check constraint or a partial unique index for the null case:
```sql
ALTER TABLE UserRoleAssignments
  ADD UNIQUE INDEX uq_global_assignment (userId, roleId, (CASE WHEN projectId IS NULL THEN '' ELSE projectId END));
```
This is a generated column expression index, supported from MariaDB 10.2+. Alternatively, use a sentinel value (`'GLOBAL'`) for the global scope instead of `NULL`. Document the `findFirst + create` pattern as mandatory in a code comment on the schema model.

---

### [MEDIUM] `WorkPackage` FK `onDelete: NoAction` for `assigneeId`/`sprintId`/`versionId`/`boardColumnId` in schema but `ON DELETE SET NULL` in migration SQL — schema vs. migration mismatch

- File: `web/back-nest/prisma/schema.prisma:662`, `web/back-nest/prisma/migration-sprint0.sql:80`
- Category: fk
- Evidence:

Schema:
```prisma
assignee  AppUser?   @relation("WpAssignee", fields: [assigneeId], references: [id], onDelete: NoAction)
sprint    Sprint?    @relation(fields: [sprintId], references: [id], onDelete: NoAction)
version   Version?   @relation(fields: [versionId], references: [id], onDelete: NoAction)
boardColumn BoardColumn? @relation(fields: [boardColumnId], references: [id], onDelete: NoAction)
```

Migration SQL:
```sql
CONSTRAINT fk_wp_assignee FOREIGN KEY (assigneeId) REFERENCES AppUsers(id) ON DELETE SET NULL,
CONSTRAINT fk_wp_sprint   FOREIGN KEY (sprintId)   REFERENCES Sprints(id) ON DELETE SET NULL,
CONSTRAINT fk_wp_version  FOREIGN KEY (versionId)  REFERENCES Versions(id) ON DELETE SET NULL,
CONSTRAINT fk_wp_column   FOREIGN KEY (boardColumnId) REFERENCES BoardColumns(id) ON DELETE SET NULL
```
- Impact: The actual DB constraints are `SET NULL` (from the SQL that was applied) but the Prisma schema says `NoAction`. This means:
  1. Deleting a Sprint/Version/User in MariaDB will silently NULL-out the FK in `WorkPackages` at the DB layer without Prisma knowing.
  2. Any future `prisma db push` or migration generation will try to recreate these FKs with `NO ACTION`, causing an FK drift error.
  3. Prisma's cascade-delete behavior at the application layer will not match the DB.
- Fix: Align the schema to match the live DB behavior by updating `schema.prisma`:
```prisma
assignee    AppUser?    @relation(..., onDelete: SetNull)
sprint      Sprint?     @relation(..., onDelete: SetNull)
version     Version?    @relation(..., onDelete: SetNull)
boardColumn BoardColumn? @relation(..., onDelete: SetNull)
```
Then `npx prisma generate`. The migration SQL is already correct; the schema needs to match it.

---

### [MEDIUM] `migration-sprint0.sql` ALTER statements for Notifications columns are not idempotent — re-running will crash

- File: `web/back-nest/prisma/migration-sprint0.sql:338`
- Category: migration
- Evidence:
```sql
ALTER TABLE Notifications ADD COLUMN reason VARCHAR(40) NOT NULL DEFAULT 'system';
ALTER TABLE Notifications ADD COLUMN entityType VARCHAR(40) NULL;
ALTER TABLE Notifications ADD COLUMN entityId VARCHAR(191) ...;
ALTER TABLE Notifications ADD COLUMN actorId VARCHAR(191) ...;
ALTER TABLE Notifications ADD COLUMN link VARCHAR(500) NULL;
ALTER TABLE Notifications ADD CONSTRAINT fk_notif_actor FOREIGN KEY ...;
```
The comment says "IF NOT EXISTS not supported for ADD COLUMN on MariaDB 10.x" but this is only accurate for MariaDB versions before 10.2.0. MariaDB 10.2+ (including the XAMPP-bundled 10.4) fully supports `ADD COLUMN IF NOT EXISTS`. Without the guard, any re-run of this migration aborts with "Duplicate column name" for all five columns and "Duplicate key name" for the FK constraint.
- Impact: Anyone applying this migration to an already-migrated database (e.g., a CI reset, a new dev environment where partial migration was applied) will get a fatal MySQL error mid-script. The `SET FOREIGN_KEY_CHECKS=1` at the top also means prior table DDL errors in the same session leave FK checks permanently on, which can leave partially-applied tables.
- Fix:
```sql
ALTER TABLE Notifications ADD COLUMN IF NOT EXISTS reason VARCHAR(40) NOT NULL DEFAULT 'system';
ALTER TABLE Notifications ADD COLUMN IF NOT EXISTS entityType VARCHAR(40) NULL;
ALTER TABLE Notifications ADD COLUMN IF NOT EXISTS entityId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL;
ALTER TABLE Notifications ADD COLUMN IF NOT EXISTS actorId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL;
ALTER TABLE Notifications ADD COLUMN IF NOT EXISTS link VARCHAR(500) NULL;

-- Idempotent FK: drop if exists, re-add
ALTER TABLE Notifications DROP FOREIGN KEY IF EXISTS fk_notif_actor;
ALTER TABLE Notifications ADD CONSTRAINT fk_notif_actor FOREIGN KEY (actorId) REFERENCES AppUsers(id) ON DELETE SET NULL;
```

---

### [MEDIUM] `PortalToken` has a redundant secondary index on `token` in addition to the UNIQUE constraint

- File: `web/back-nest/prisma/schema.prisma:479`
- Category: index
- Evidence:
```prisma
token     String  @unique @db.VarChar(64)
...
@@index([token])
```
- Impact: `@unique` already creates a B-tree index on `token` in MySQL. The `@@index([token])` generates a second, identical index. This wastes ~2x the storage for this index and doubles write amplification on every portal token insert/update. The query planner will arbitrarily pick one; the other is dead weight.
- Fix: Remove the `@@index([token])` line — the `@unique` annotation is sufficient.

---

### [MEDIUM] `ProjectValidation @@unique([projectId, validatedByUserId, phase])` design allows only one vote per user per phase across all approval outcomes

- File: `web/back-nest/prisma/schema.prisma:244`
- Category: unique-null
- Evidence:
```prisma
@@unique([projectId, validatedByUserId, phase])
```
- Impact: This is intentional per CLAUDE.md ("one-per-user-per-phase-per-project correct"), so the design itself is accepted. However, once a user submits a validation (approved or rejected), there is no way to resubmit. If the business requires re-validation after rejection (e.g., Realization rejected, developer fixes, same user re-approves), the only workaround is a DELETE + re-INSERT. The seed data at `seed.ts:360` already shows a rejected validation for `real1` on `p4/Realization` — if business logic later allows overriding a rejection, the unique constraint will block it without an explicit delete.
- Impact level: Low operationally today; MEDIUM risk as the product evolves.
- Fix: If re-validation is ever needed, either remove the unique constraint and enforce one-active-validation-per-phase in application code, or keep the constraint and add a `DELETE` path in `ProjectsService` before resubmission.

---

### [MEDIUM] `WorkPackage.parentId` FK is `onDelete: NoAction` in schema but `ON DELETE SET NULL` in migration — same drift as assigneeId

- File: `web/back-nest/prisma/schema.prisma:664`, `web/back-nest/prisma/migration-sprint0.sql:88`
- Category: fk
- Evidence:

Schema:
```prisma
parent WorkPackage? @relation("WpHierarchy", fields: [parentId], references: [id], onDelete: NoAction)
```
Migration:
```sql
ALTER TABLE WorkPackages ADD CONSTRAINT fk_wp_parent FOREIGN KEY (parentId) REFERENCES WorkPackages(id) ON DELETE SET NULL;
```
- Impact: Same drift issue as the assigneeId/sprintId group above. Deleting a parent WP in the DB will SET NULL on children (correct behavior), but Prisma client will not know about this and will apply NoAction semantics at the application layer. Included separately because the self-referencing FK is higher-risk — child WPs can become orphaned in ways Prisma's in-memory graph cannot detect.
- Fix: Update `schema.prisma` to `onDelete: SetNull` on the `parent` relation. This is a single-line change matching the SQL that is already live.

---

### [LOW] `seed.ts` AuditLog creation is not idempotent — duplicates on re-run

- File: `web/back-nest/prisma/seed.ts:474`
- Category: seed
- Evidence:
```ts
for (const log of auditLogs) {
  await prisma.auditLog.create({
    data: { ...log, createdAt: new Date(Date.now() - Math.random() * 10 * 86400000) },
  });
}
```
No existence check. Every re-run of `seed.ts` appends new AuditLog rows.
- Impact: Running the seed twice (e.g., during a dev environment rebuild) creates duplicate audit entries. AuditLogs are an append-only table by design, but seed data should not contribute duplicate "CREATE/STATUS_CHANGE" entries that skew analytics queries. For the 7 hardcoded entries this is cosmetic, but it breaks the "idempotent" claim in the seed comment.
- Fix: Mirror the pattern used for activities: check for existence before creating:
```ts
const logExists = await prisma.auditLog.findFirst({
  where: { entityType: log.entityType, entityId: log.entityId, action: log.action, userId: log.userId },
});
if (!logExists) {
  await prisma.auditLog.create({ data: { ...log, ... } });
}
```

---

### [LOW] `seed-openproject.ts` WorkPackageWatcher and CustomValue errors silently swallowed with empty `.catch(() => {})`

- File: `web/back-nest/prisma/seed-openproject.ts:263`
- Category: seed
- Evidence:
```ts
await prisma.workPackageWatcher.create({ ... }).catch(() => {});
await prisma.workPackageCustomValue.create({ ... }).catch(() => {});
await prisma.workPackageDependency.create({ ... }).catch(() => {});
```
- Impact: On a fresh seed, these will succeed. On a re-run they suppress duplicate-key errors (expected). However, they also suppress genuine errors (e.g., FK violation because a WP ID was not created, DB connection loss, missing column). A failed seed run reports success with no indication that watchers or custom values are missing. The Gantt and Sprint views will silently render with no watcher counts and no environment custom field.
- Fix: Only suppress unique constraint violations (error code `P2002` in Prisma). Re-throw all other errors:
```ts
await prisma.workPackageWatcher.create({ ... })
  .catch((e) => { if (e?.code !== 'P2002') throw e; });
```

---

### [LOW] `GanttBaseline` has no unique constraint on `(projectId, workPackageId, snapshotName)` — multiple baseline captures with the same name allowed

- File: `web/back-nest/prisma/schema.prisma:785`
- Category: unique-null
- Evidence:
```prisma
@@index([projectId, snapshotName])
@@index([workPackageId])
```
No `@@unique` on `(projectId, snapshotName)` or `(projectId, workPackageId, snapshotName)`.
- Impact: The `compare` endpoint uses `snapshotName` as a lookup key (`GET /pm/projects/:id/baselines/:snapshotName/compare`). If a user captures two baselines with the same name, the compare query returns multiple rows for the same WP and the drift calculation is incorrect (double-counting or wrong baseline dates). The `gantt.service.ts` baseline capture does not check for existing names.
- Fix: Either add a `@@unique([projectId, snapshotName])` constraint and handle the conflict in the service, or add a service-layer check before capture:
```prisma
@@unique([projectId, snapshotName])
```
Then in the service:
```ts
const existing = await this.prisma.ganttBaseline.findFirst({ where: { projectId, snapshotName } });
if (existing) return Result.fail('Un snapshot avec ce nom existe déjà.');
```

---

### [LOW] `TranscriptSegment` has no index on `transcriptId` — potential full table scan for large meetings

- File: `web/back-nest/prisma/schema.prisma:401`
- Category: index
- Evidence:
```prisma
model TranscriptSegment {
  id           String @id @default(uuid())
  transcriptId String
  ...
  transcript MeetingTranscript @relation(...)
  @@map("TranscriptSegments")
}
```
No `@@index([transcriptId])` defined.
- Impact: `ai.service.ts` line 24 fetches a transcript with `include: { segments: { orderBy: { startTime: 'asc' } } }`, which joins `TranscriptSegments` on `transcriptId`. Without an index, this is a full table scan on `TranscriptSegments` for each AI analysis job. A large-v3 Whisper output for a 1-hour meeting can produce 500–2000 segments; at tens of thousands of total segments the scan degrades noticeably.
- Fix:
```prisma
@@index([transcriptId])
```
Corresponding SQL:
```sql
ALTER TABLE TranscriptSegments ADD INDEX idx_ts_transcript (transcriptId);
```

---

### [LOW] `seed.ts` activity `action` values use uppercase (`STATUS_CHANGE`, `CREATE`) but `analytics.service.ts` queries for lowercase `status_change`

- File: `web/back-nest/prisma/seed.ts:291`, `web/back-nest/src/analytics/analytics.service.ts:64`
- Category: enum-drift
- Evidence:

seed.ts line 291:
```ts
{ projectId: ID.p1, userId: R.pm1, action: 'STATUS_CHANGE', detail: 'Statut → InProgress' },
```

analytics.service.ts line 64:
```ts
where: { action: 'status_change', detail: { not: null } },
```
- Impact: The analytics activities seeded at lines 319–343 correctly use lowercase `'status_change'` and are parsed by the analytics service. The earlier seed activities at lines 288–300 use `'STATUS_CHANGE'` (uppercase), which the analytics regex never matches. This is low impact because the analytics seed block at line 319 already provides correctly-formatted phase-transition data. However, it creates inconsistent `action` values in `ProjectActivities`, and any query that looks for status changes without `{ mode: 'insensitive' }` will miss the uppercase records.
- Fix: Normalise all `action` values in `seed.ts` to lowercase. Update the block at lines 288–300 to match the convention established at lines 319–343. No schema change needed.

---

### [LOW] `HourlyRate` has no unique constraint on `(userId, projectId, validFrom)` — duplicate rate rows possible

- File: `web/back-nest/prisma/schema.prisma:828`
- Category: unique-null
- Evidence:
```prisma
@@index([userId, projectId, validFrom])
```
An index exists but no `@@unique`. The `seed-openproject.ts` uses `findFirst` + conditional `create` to guard against duplicates, but the budget service's rate lookup is a `findFirst` with no duplicate protection at the DB level.
- Impact: A concurrent double-submit of an hourly rate form (or a bug in the hourly-rate service) can insert two identical `(userId, projectId, validFrom)` rows. The `findFirst` in the budget burn query picks one arbitrarily, causing non-deterministic billing calculations.
- Fix:
```prisma
@@unique([userId, projectId, validFrom])
```
Handle the MariaDB NULL-in-unique-key caveat for `projectId = NULL` (global rates) using the same `findFirst + create` pattern already present in the seed.

---

### [INFO] `PortalToken` lookup is correctly indexed; no action needed

- File: `web/back-nest/prisma/schema.prisma:463`
- Category: index
- Evidence:
```prisma
token String @unique @db.VarChar(64)
```
The public portal lookup path (`GET /portal/:token`) resolves the token via the `@unique` constraint index. This is a point-lookup — O(log n) B-tree traversal. No additional index is needed. The secondary `@@index([token])` flagged above as redundant should be removed.

---

### [INFO] `@@unique([projectId, validatedByUserId, phase])` on `ProjectValidation` — correctly prevents duplicate validation submissions

- File: `web/back-nest/prisma/schema.prisma:244`
- Category: unique-null
- Evidence:
```prisma
@@unique([projectId, validatedByUserId, phase])
```
All three columns are non-nullable (projectId, validatedByUserId, phase are all `String`, not `String?`), so the MySQL NULL-distinctness caveat does not apply here. The constraint correctly enforces one vote per user per phase per project. No action needed on the constraint itself.

---

### [INFO] `roles.service.ts` permission update uses `$transaction` correctly

- File: `web/back-nest/src/roles/roles.service.ts:99`
- Category: perf
- Evidence:
```ts
await this.prisma.$transaction([
  this.prisma.rolePermission.deleteMany({ where: { roleId } }),
  this.prisma.rolePermission.createMany({ data: ..., skipDuplicates: true }),
]);
```
This is the correct pattern: delete-then-recreate in a single transaction prevents a window where a role has no permissions. No action needed.

---

### [INFO] `ai.service.ts` transaction correctly clears and repopulates AI results atomically

- File: `web/back-nest/src/ai/ai.service.ts:43`
- Category: perf
- The `$transaction(async tx => {...})` wrapping the delete+update+createMany for AI results is correct. The `aiStatus = 'processing'` flag is set outside the transaction (intentional — allows the polling endpoint to see progress). No issues.

---

## Summary Table

| # | Severity | Category | File | One-line |
|---|----------|----------|------|----------|
| 1 | HIGH | soft-delete | system-status.service.ts:29 | projectTotal/projectByStatus counts deleted rows |
| 2 | HIGH | index | schema.prisma:680 | No (projectId, isDeleted) composite index on WorkPackages |
| 3 | HIGH | soft-delete | wiki.service.ts:56 | Slug dedup loop hits deleted pages; movePage/softDelete lookups also missing isDeleted filter |
| 4 | HIGH | index | schema.prisma:437 | Notification index order doesn't cover paginated unread list sort |
| 5 | MEDIUM | unique-null | schema.prisma:131 | @@unique with nullable projectId = NULL — upsert unsafe; findFirst+create pattern correct but undocumented |
| 6 | MEDIUM | fk | schema.prisma:662 vs migration-sprint0.sql:80 | assigneeId/sprintId/versionId/boardColumnId OnDelete: NoAction in schema but SET NULL in live DB |
| 7 | MEDIUM | migration | migration-sprint0.sql:338 | ADD COLUMN without IF NOT EXISTS — migration not idempotent |
| 8 | MEDIUM | index | schema.prisma:479 | Duplicate index on PortalToken.token (unique + extra @@index) |
| 9 | MEDIUM | unique-null | schema.prisma:244 | ProjectValidation unique prevents re-validation after rejection |
| 10 | MEDIUM | fk | schema.prisma:664 vs migration-sprint0.sql:88 | parentId OnDelete drift (same class as #6) |
| 11 | LOW | seed | seed.ts:474 | AuditLog not idempotent — duplicates on re-run |
| 12 | LOW | seed | seed-openproject.ts:263 | .catch(()=>{}) swallows non-duplicate errors silently |
| 13 | LOW | unique-null | schema.prisma:785 | GanttBaseline has no unique on (projectId, snapshotName) — corrupt drift comparison |
| 14 | LOW | index | schema.prisma:401 | TranscriptSegment missing index on transcriptId |
| 15 | LOW | enum-drift | seed.ts:291 vs analytics.service.ts:64 | activity.action case mismatch (STATUS_CHANGE vs status_change) |
| 16 | LOW | unique-null | schema.prisma:828 | HourlyRate no unique on (userId, projectId, validFrom) |
