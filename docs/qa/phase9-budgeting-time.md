# Phase 9 Fix Pass — Budgeting & Time Tracking

Applied on: 2026-04-20  
Branch: nest-back  
Files modified:
- `web/back-nest/src/time-tracking/time-tracking.service.ts`
- `web/back-nest/src/time-tracking/time-tracking.controller.ts`

No new migrations needed for this pass (schema fields `ProjectBudget.version` and
`BudgetLineItem.kind` were already applied by a prior Phase 9 agent).

---

## Verified as already in place (no changes needed)

| Fix | Location | Evidence |
|-----|----------|----------|
| Money arithmetic (`Prisma.Decimal`) | `budgeting.service.ts` | `toDec()` helper + `.add()/.mul()/.sub()` throughout; Decimals serialised with `.toFixed(2)` at boundary |
| Burn report `kind='actual'` filter | `budgeting.service.ts:221-228` | `where: { budgetId, type: 'material', kind: 'actual' }` |
| Burn report excludes soft-deleted WPs | `budgeting.service.ts:206-212` | `OR: [{ workPackageId: null }, { workPackage: { isDeleted: false } }]` |
| `schema.prisma` — `ProjectBudget.version` | `prisma/schema.prisma:842` | `version Int @default(0)` present |
| `schema.prisma` — `BudgetLineItem.kind` | `prisma/schema.prisma:857` | `kind String @default("actual") @db.VarChar(16)` present |
| Line-item IDOR scoping (`projectId`) | `budgeting.service.ts:152-153, 184-186` | `findFirst({ where: { id, budget: { projectId } } })` in both update and delete |
| `ProjectAccessGuard` on `BudgetingController` | `budgeting.controller.ts` | Sprint 2 guard verified |
| `ProjectAccessGuard` on `ProjectTimeEntriesController` | `time-tracking.controller.ts:80-81` | `@UseGuards(JwtAuthGuard, ProjectAccessGuard) @ProjectAccess('projectId')` |
| `AdminBudgetsController` guard | `budgeting.controller.ts:66-78` | `@UseGuards(JwtAuthGuard, RolesGuard) @Roles('Admin')` |
| `HourlyRatesController` guard | `time-tracking.controller.ts:105-107` | `@UseGuards(JwtAuthGuard, RolesGuard) @Roles('Admin')` |

---

## Changes applied in this pass

### Fix 3 — Timezone-aware week grid

**File:** `time-tracking.service.ts`  
**Method:** `getWeeklyGrid(userId, weekStart, timezone = 'Europe/Paris')`

Before: `new Date(weekStart)` parses as UTC midnight — off-by-one on DST days for
European users.

After:
- Added `weekStart` format validation (rejects non-`YYYY-MM-DD` with 400).
- New private method `localMidnightUtc(year, month, day, timezone)` uses
  `Intl.DateTimeFormat` with `formatToParts` to compute the UTC timestamp that
  corresponds to midnight in the target IANA timezone, without any third-party
  library.
- End boundary computed as `startUtc + 6 * 86 400 000 ms` (pure arithmetic, no
  `setDate` drift).
- Response now echoes back the parsed `weekStart` string and `timezone` so clients
  can detect any mismatch.

**File:** `time-tracking.controller.ts`  
- Added `@Query('timezone') timezone?: string` parameter forwarded to service.

### Fix 5 — Cross-project reassignment via `workPackageId` in `update()`

**File:** `time-tracking.service.ts`  
**Method:** `update()`

Before: `dto.workPackageId` was accepted without any validation. A user could
reassign their entry to a WP from a different project, corrupting burn reports and
`spentHours`.

After: Before building the `data` object, if `dto.workPackageId` is provided the
service now:
1. Fetches the WP from DB.
2. Rejects with `Result.fail` if the WP does not exist.
3. Rejects if `wp.projectId !== existing.projectId` (cross-project move).
4. Rejects if `wp.isDeleted === true`.

### Fix 6 — Atomic lock check in `update()` and `delete()`

**File:** `time-tracking.service.ts`  
**Methods:** `update()`, `delete()`

Before: Service read `existing.lockedAt`, then issued a separate `UPDATE`/`DELETE`.
A concurrent `lockPeriod` call could lock the row between those two statements.

After:
- `update()` now uses `prisma.timeEntry.updateMany({ where: { id, userId, lockedAt: null }, data })`.
  If `count === 0` (row was locked or not found) it returns `Result.fail('Saisie verrouillée ou introuvable.')`.
  Then re-fetches the updated row to return it.
- `delete()` now uses `prisma.timeEntry.deleteMany({ where: { id, userId, lockedAt: null } })`.
  Same `count === 0` guard.

**File:** `time-tracking.controller.ts`  
**`POST /api/time-entries/lock`**

Before: Manual `if (user.role !== 'Admin') throw new BadRequestException(...)` —
wrong HTTP status (400 not 403), bypassed by internal callers.

After: Added `@UseGuards(RolesGuard)` + `@Roles('Admin')` decorators on the handler.
Removed the manual check and the `@CurrentUser()` parameter. Non-Admin calls now
receive 403 from the guard stack, consistent with other Admin endpoints.

### Fix 7 — Overlapping hourly-rate windows

**File:** `time-tracking.service.ts`  
**Method:** `createRate()`

Before: No validation. Two rates for the same `(userId, projectId)` could have
overlapping `[validFrom, validTo]` windows, causing `getEffectiveRate` to return
non-deterministic results.

After:
1. Rejects if `validTo <= validFrom` (invalid range).
2. Queries for any existing `HourlyRate` row for the same `(userId, projectId)`
   whose interval overlaps the new one:
   `validFrom <= new.validTo (or open-end) AND (validTo IS NULL OR validTo >= new.validFrom)`.
   Returns 400 with a user-friendly French message if an overlap is found.

---

## Migration files to apply

None required for this pass. The `BudgetLineItem.kind` column and
`ProjectBudget.version` column were added by the prior Phase 9 agent. If you have
not applied those yet, run:

```bash
C:/xampp/mysql/bin/mysql.exe -u root -h 127.0.0.1 -P 3306 NeoLeadgeDeployment \
  -e "ALTER TABLE BudgetLineItems ADD COLUMN IF NOT EXISTS kind VARCHAR(16) NOT NULL DEFAULT 'actual';
      ALTER TABLE BudgetLineItems ADD INDEX IF NOT EXISTS idx_budget_kind (budgetId, kind);
      ALTER TABLE ProjectBudgets ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 0;"
cd web/back-nest && npx prisma generate
```

---

## Remaining open items (not in scope for this pass)

- [HIGH] N+1 query in `getBurnReport` (`getEffectiveRate` called per entry) — preload rates by `userId` batch.
- [MEDIUM] DTOs are anonymous inline types — convert to `class` with `class-validator`.
- [MEDIUM] `findMyEntries` / `findProjectEntries` unbounded date range + no pagination.
- [MEDIUM] `create` WP `spentHours` update not wrapped in a transaction.
- [LOW] `delete` does not decrement `WorkPackage.spentHours`.
- [LOW] `lockPeriod` has no `lockedBy` audit field.
- [LOW] `currency` accepts any string — no ISO-4217 whitelist validation.
