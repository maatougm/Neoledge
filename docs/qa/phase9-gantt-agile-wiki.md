# Phase 9 fix pass — Gantt / Agile / Wiki

**Date:** 2026-04-20
**Branch:** nest-back
**Source report:** `docs/qa/backend/gantt-agile-wiki.md`

---

## Already closed before this pass (Sprint 2 / Sprint 6)

| # | Finding | Closed by |
|---|---------|-----------|
| CRITICAL | Gantt + Agile + Wiki controllers — no project-scope auth | `ProjectAccessGuard` applied in Sprint 2 |
| CRITICAL | WikiView XSS — raw markdown rendered without sanitisation | DOMPurify added in WikiView.vue Sprint 6 |

---

## Fixes applied in this pass

### 1. GanttBaseline uniqueness (HIGH)

**Files changed:** `prisma/schema.prisma`, `src/gantt/gantt.service.ts`
**Migration:** `prisma/migration-gantt-baseline-unique.sql`

- `@@unique([projectId, snapshotName, workPackageId])` already present in `schema.prisma` (line 788).
- Migration SQL adds `uq_gantt_baseline_project_snapshot_wp` on `GanttBaselines`.
- `captureBaseline()` now trims/validates `snapshotName`, runs a fast `count()` pre-check, and catches `P2002` with a clear user-facing message: _"Nom de snapshot déjà utilisé"_.

**Apply migration:**
```bash
C:/xampp/mysql/bin/mysql.exe -u root -h 127.0.0.1 -P 3306 NeoLeadgeDeployment < web/back-nest/prisma/migration-gantt-baseline-unique.sql
cd web/back-nest && npx prisma generate
```

### 2. Gantt payload bloat (HIGH)

**File changed:** `src/gantt/gantt.service.ts`

Explicit `select` on `WorkPackage` in `getGanttPayload()` — only returns Gantt-relevant fields (`id`, `title`, `status`, `priority`, `type`, `startDate`, `dueDate`, `percentDone`, `parentId`, `assigneeId`, `estimatedHours`, `position`, plus nested `assignee` and `dependenciesOut`). The `description: LongText` field is excluded.

### 3. `markMilestoneReached` race (HIGH)

**File changed:** `src/gantt/gantt.service.ts`

Replaced the read-modify-write with `updateMany({ where: { id, isReached: false }, data: { isReached: true } })`. Checks the `count` return value: if `count === 0` a concurrent call already won, and automation is not re-fired. The `existing.isReached` early-exit guard also short-circuits duplicated calls without touching the DB.

### 4. `listBoards` auto-create race (HIGH)

**File changed:** `src/agile/agile.service.ts`
**Migration:** `prisma/migration-gantt-baseline-unique.sql` (adds `uq_board_project_name` on `Boards`)

The cold-start auto-create is wrapped in `prisma.$transaction`. A `P2002` on the inner `board.create` (concurrent race) is caught and silently falls through to re-read the board that was created by the winner. Migration adds `@@unique([projectId, name])` to `Boards`.

### 5. `deleteColumn` — WP check before delete (HIGH)

**File changed:** `src/agile/agile.service.ts`

Pre-delete `workPackage.count({ where: { boardColumnId: columnId, isDeleted: false } })`. If `> 0`, returns a clear bilingual error: _"Colonne non vide (N carte(s)). Déplacez les cartes avant de supprimer."_ The DB FK `NoAction` is no longer silently swallowed.

### 6. `reorderColumns` atomic + ownership (HIGH)

**File changed:** `src/agile/agile.service.ts`

- Validates `order` is a non-empty array with no duplicates.
- Loads all columns for `boardId` and asserts `order` is an exact permutation (same count, every ID belongs to the board).
- Runs all `update` calls inside `prisma.$transaction([...])`.

### 7. Sprint state machine (HIGH)

**File changed:** `src/agile/agile.service.ts`

- `SPRINT_TRANSITIONS` const defines the allowed transitions: `Planning → Active/Cancelled`, `Active → Closed`, `Closed → []`, `Cancelled → []`.
- `startSprint` and `closeSprint` both call `assertTransition()` before the DB write.
- `updateSprint` deliberately omits `status` from the updatable fields — all status changes must go through `startSprint`/`closeSprint`.
- `getBurndown` now validates `startDate`/`endDate` are valid `Date` objects and throws `BadRequestException` when `totalDays <= 0`.
- Burndown date arithmetic rewritten using `start.getTime() + i * DAY_MS` (no month-overflow issue).

### 8. `addWpToSprint` cross-project check (HIGH)

**File changed:** `src/agile/agile.service.ts`

Loads the sprint with `include: { board: { select: { projectId: true } } }`. Verifies every supplied WP ID exists and has `projectId === sprint.board.projectId`. Returns `Result.fail` with a clear message if any WP mismatches. The `updateMany` also scopes `where: { ..., projectId: expectedProjectId }` as a defence-in-depth filter.

### 9. Wiki slug uniqueness (HIGH)

**Schema:** `@@unique([projectId, slug])` already present (line 891).
**Migration:** In `prisma/migration-sprint0.sql` — `UNIQUE KEY uq_wiki_slug (projectId, slug)` already added on table creation.

**File changed:** `src/wiki/wiki.service.ts`

- Slug dedup loop now filters `isDeleted: false` so deleted pages do not block re-creation of the same title.
- `create()` catch block handles `P2002` with: _"Ce titre de page existe déjà dans ce projet."_

### 10. Wiki `movePage` cycle detection (HIGH)

**File changed:** `src/wiki/wiki.service.ts`

`movePage()` now:
1. Uses `isDeleted: false` on the page lookup.
2. Rejects `parentId === page.id` (self-parent).
3. Validates the target parent exists, is not deleted, and belongs to the same `projectId`.
4. Walks the ancestor chain from `parentId` to root; if `page.id` is encountered, returns _"Déplacement impossible: cycle détecté dans la hiérarchie."_

### 11. Wiki revision restore — `@RequirePermission` (HIGH)

**Files changed:** `src/wiki/wiki.controller.ts`, `src/wiki/wiki.module.ts`

- `PermissionsGuard` added to `@UseGuards` on the controller class.
- `PermissionsModule` imported in `WikiModule`.
- `@RequirePermission('wiki.edit', { projectParam: 'projectId' })` added on the `POST pages/:slug/restore/:version` handler.

### 12. Wiki search — cap `q` at 200 chars (HIGH + easy MEDIUM)

**File changed:** `src/wiki/wiki.service.ts`

- `q` is trimmed before use.
- Empty string returns `[]` immediately (unchanged).
- Length > 200 returns `Result.fail('Requête trop longue (max 200 caractères).')`.
- Error catch now logs via `this.logger.error`.

### 13. Wiki markdown stored raw — comment added (easy MEDIUM)

**File changed:** `src/wiki/wiki.service.ts`

Added comment in `create()`: _"Content is stored as raw markdown. XSS sanitisation is performed on render by DOMPurify in the frontend (WikiView.vue, Sprint 6)."_

### 14. Wiki slug-dedup + softDelete + movePage + revision lookups — `isDeleted: false` (easy MEDIUM)

**File changed:** `src/wiki/wiki.service.ts`

All page lookups that were missing `isDeleted: false` have been fixed:

| Method | Fix |
|--------|-----|
| `create()` slug dedup `while` loop | Added `isDeleted: false` |
| `softDelete()` page lookup | Added `isDeleted: false` |
| `movePage()` page lookup | Added `isDeleted: false` |
| `listRevisions()` page lookup | Added `isDeleted: false` |
| `getRevision()` page lookup | Added `isDeleted: false` |
| `restoreRevision()` page lookup | Added `isDeleted: false` |

---

## Migration files to apply

| File | What it adds | Tables affected |
|------|-------------|-----------------|
| `prisma/migration-gantt-baseline-unique.sql` | `uq_gantt_baseline_project_snapshot_wp` unique constraint, `uq_board_project_name` unique constraint, `ix_wiki_page_project_title` index | `GanttBaselines`, `Boards`, `WikiPages` |

The `WikiPages` slug unique constraint (`uq_wiki_slug`) was already created by `prisma/migration-sprint0.sql`.

```bash
# Apply Phase 9 hardening constraints (skip if already applied)
C:/xampp/mysql/bin/mysql.exe -u root -h 127.0.0.1 -P 3306 NeoLeadgeDeployment \
  < web/back-nest/prisma/migration-gantt-baseline-unique.sql

# Regenerate Prisma client
cd web/back-nest && npx prisma generate
```

---

## Build status

`npm run build` passes with zero errors after all changes.

---

## Remaining open findings (not in scope of this pass)

The following findings from the QA report were not addressed here (either already closed by earlier sprints or explicitly out of scope):

- **CRITICAL** `moveCard` cross-board IDOR — needs further work to assert target-column's `board.projectId === urlProjectId`.
- **MEDIUM** class-validator DTOs — inline `@Body()` types not yet converted to classes.
- **MEDIUM** `compareBaseline` returns `delta: 0` for deleted WPs (now returns `null` — this was already fixed in `compareBaseline`, see `gantt.service.ts:257`).
- **LOW** empty `catch {}` blocks swallow errors without logging — incremental improvement needed.
- **LOW** `parseInt(version, 10)` NaN guard — wire `ParseIntPipe` on controller params.
