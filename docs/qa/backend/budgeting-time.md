# Backend QA — Budgeting & Time Tracking

Line-by-line audit of every `.ts` file under:

- `web/back-nest/src/budgeting/`
- `web/back-nest/src/time-tracking/`

Files opened:

- `web/back-nest/src/budgeting/budgeting.service.ts` (162 lines)
- `web/back-nest/src/budgeting/budgeting.module.ts` (13 lines)
- `web/back-nest/src/budgeting/budgeting.controller.ts` (79 lines)
- `web/back-nest/src/budgeting/budgeting.service.spec.ts` (82 lines)
- `web/back-nest/src/time-tracking/time-tracking.service.ts` (257 lines)
- `web/back-nest/src/time-tracking/time-tracking.module.ts` (11 lines)
- `web/back-nest/src/time-tracking/time-tracking.controller.ts` (137 lines)

Corroborating files (read to confirm types/schema shape only — not modified):

- `web/back-nest/prisma/schema.prisma` (lines 637–863: `WorkPackage`, `TimeEntry`, `HourlyRate`, `ProjectBudget`, `BudgetLineItem`)
- `web/back-nest/src/common/guards/roles.guard.ts` (confirms `@Roles('Admin')` is honoured)
- `web/back-nest/src/common/decorators/current-user.decorator.ts` (returns `request.user` verbatim)
- `web/back-nest/src/automation/automation.controller.ts:29` and `automation.service.ts:119` (demonstrates the `isProjectManager` project-membership check pattern that budgeting/time-tracking do **not** adopt)

No files were modified.

---

## CRITICAL findings

### [CRITICAL] Any authenticated user can read every project's budget, line items, and burn report
- File: `web/back-nest/src/budgeting/budgeting.controller.ts:7-64`
- Category: auth / idor
- Evidence:
```ts
@Controller('pm/projects/:projectId/budget')
@UseGuards(JwtAuthGuard)
export class BudgetingController {
  constructor(private readonly service: BudgetingService) {}

  @Get()
  async get(@Param('projectId') projectId: string) {
    const r = await this.service.getBudget(projectId);
    ...
  }

  @Put()
  async upsert(
    @Param('projectId') projectId: string,
    @Body() dto: { laborBudget?: number; materialBudget?: number; currency?: string; notes?: string },
  ) { ... }
  ...
  @Get('burn')
  async burn(@Param('projectId') projectId: string) {
    const r = await this.service.getBurnReport(projectId);
    ...
  }
}
```
- Impact: `JwtAuthGuard` alone accepts any valid token (Viewer, RealizationTeam, anyone). There is **no** `@Roles(...)` decorator, no project-membership check, and no call to `isProjectManager(projectId, userId)` (contrast `automation.controller.ts:29` where that check *is* enforced). A viewer on Project A can `GET /pm/projects/<Project-B-id>/budget`, `PUT` overwrite Project B's `laborBudget`/`materialBudget`, create/patch/delete line items, and pull the burn report (which exposes labor cost = hours × hourly rate across the company). This is a horizontal privilege escalation and sensitive-data leak.
- Fix: Add a project-membership/PM guard on every route here (mirror `AutomationController`). At minimum `@Roles('Admin','ProjectManager')` plus a `service.assertProjectAccess(projectId, userId)` call, or better a dedicated `ProjectMemberGuard`. Also forbid write operations (`PUT`, `POST /line-items`, `PATCH /line-items/:id`, `DELETE /line-items/:id`) for non-Admin/PM.

### [CRITICAL] Budget line-item PATCH / DELETE has no project scoping — cross-project IDOR
- File: `web/back-nest/src/budgeting/budgeting.controller.ts:41-56`, `budgeting.service.ts:82-112`
- Category: idor
- Evidence (controller):
```ts
@Patch('line-items/:id')
async updateLine(
  @Param('id') id: string,
  @Body() dto: { description?: string; type?: string; unitCost?: number; units?: number; position?: number },
) {
  const r = await this.service.updateLineItem(id, dto);
  ...
}

@Delete('line-items/:id')
@HttpCode(HttpStatus.NO_CONTENT)
async deleteLine(@Param('id') id: string) {
  const r = await this.service.deleteLineItem(id);
  ...
}
```
- Evidence (service):
```ts
async updateLineItem(id: string, dto: ...) {
  try {
    const existing = await this.prisma.budgetLineItem.findUnique({ where: { id } });
    if (!existing) return Result.fail('Ligne introuvable.');
    ...
    const item = await this.prisma.budgetLineItem.update({ where: { id }, data: { ... } });
```
- Impact: The route template carries `:projectId`, but the service never cross-validates that `BudgetLineItem.budget.projectId === :projectId`. A PM of Project A can `PATCH /pm/projects/<Project-A-id>/budget/line-items/<Project-B-line-item-id>` and mutate or delete line items from any other project. Combined with the bug above this is fully exploitable by any authenticated user.
- Fix: Change the service signatures to `updateLineItem(projectId, id, dto)` / `deleteLineItem(projectId, id)` and query with `findFirst({ where: { id, budget: { projectId } } })` before mutating. Pass `projectId` from the controller param.

### [CRITICAL] `Admin lock-period` check in controller, not in service → race & internal-caller bypass
- File: `web/back-nest/src/time-tracking/time-tracking.controller.ts:65-74`
- Category: auth
- Evidence:
```ts
@Post('lock')
async lock(
  @CurrentUser() user: AuthUser,
  @Body() body: { from: string; to: string; userId?: string },
) {
  if (user.role !== 'Admin') throw new BadRequestException('Admin requis.');
  const r = await this.service.lockPeriod(body.from, body.to, body.userId);
  ...
}
```
- Impact:
  1. The check is a manual string compare in the controller instead of `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('Admin')`. This is inconsistent with `HourlyRatesController` (`time-tracking.controller.ts:102-105`) which uses the proper guard+decorator stack described in CLAUDE.md ("Admin routes on new modules use `@Roles('Admin')`").
  2. Any future internal caller that injects `TimeTrackingService` and calls `lockPeriod(...)` directly bypasses the check entirely.
  3. A non-Admin error is raised as `BadRequestException` (400) rather than `ForbiddenException` (403), which is semantically wrong and leaks less info to legit operators.
- Fix: Replace controller-side check with `@UseGuards(JwtAuthGuard, RolesGuard) @Roles('Admin')` on the `lock` handler (or split into a dedicated `AdminTimeEntriesController`). Use `ForbiddenException` on rejection. Keep a defence-in-depth authorization check inside `lockPeriod` (e.g. require an `actorUserId` with admin role).

### [CRITICAL] `GET /pm/projects/:projectId/time-entries` and `/summary` leak cross-project time data
- File: `web/back-nest/src/time-tracking/time-tracking.controller.ts:77-100`
- Category: auth / idor
- Evidence:
```ts
@Controller('pm/projects/:projectId/time-entries')
@UseGuards(JwtAuthGuard)
export class ProjectTimeEntriesController {
  constructor(private readonly service: TimeTrackingService) {}

  @Get()
  async list(
    @Param('projectId') projectId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('userId') userId?: string,
  ) {
    const r = await this.service.findProjectEntries(projectId, { from, to, userId });
    ...
  }

  @Get('summary')
  async getSummary(@Param('projectId') projectId: string) {
    const r = await this.service.getSummary(projectId);
    ...
  }
}
```
- Impact: Same pattern as the budget controller — no role check, no membership check. Any authenticated user (Viewer, a realization team member on a different project, a client-side token holder, etc.) can list every `TimeEntry` on any project, including user PII (`firstName`, `lastName`, per `service.findProjectEntries` at `time-tracking.service.ts:49-51`) and the activity/hour totals by user (`getSummary` at `time-tracking.service.ts:147-174` returns `byUser: [{ userId, name, hours }]`). This is a direct HR / labour-cost leak.
- Fix: Add `@Roles('Admin','ProjectManager')` and a project-membership check (or pass `@CurrentUser()` down and gate the query inside the service).

---

## HIGH findings

### [HIGH] Money arithmetic done in JS `number` on Prisma `Decimal` columns — precision loss
- File: `web/back-nest/src/budgeting/budgeting.service.ts:59-103, 117-138`; `time-tracking.service.ts:156-158, 147-174`
- Category: data-integrity / logic
- Evidence (createLineItem):
```ts
const total = dto.unitCost * dto.units;
const item = await this.prisma.budgetLineItem.create({
  data: {
    ...
    unitCost: dto.unitCost,
    units: dto.units,
    total,
    ...
  },
});
```
- Evidence (updateLineItem):
```ts
const unitCost = dto.unitCost ?? Number(existing.unitCost);
const units = dto.units ?? Number(existing.units);
...
data: {
  ...
  total: unitCost * units,
  ...
}
```
- Evidence (getBurnReport):
```ts
const labor = Number(budget?.laborBudget ?? 0);
const material = Number(budget?.materialBudget ?? 0);
const totalBudget = labor + material;
...
for (const e of entries) {
  const rate = await this.timeTracking.getEffectiveRate(e.userId, projectId, new Date(e.spentOn));
  laborSpent += Number(e.hours) * (rate ? Number(rate.rate) : 0);
}
...
const materialSpent = budget
  ? (await this.prisma.budgetLineItem.aggregate({
      where: { budgetId: budget.id, type: 'material' },
      _sum: { total: true },
    }))._sum.total ?? 0
  : 0;

const spent = laborSpent + Number(materialSpent);
const remaining = totalBudget - spent;
const percentUsed = totalBudget > 0 ? Math.round((spent / totalBudget) * 100) : 0;
```
- Evidence (schema.prisma:814-863) — the underlying columns are `Decimal(14,2)`, `Decimal(10,2)`, `Decimal(8,2)`, `Decimal(6,2)`:
```ts
model ProjectBudget {
  laborBudget    Decimal  @default(0) @db.Decimal(14, 2)
  materialBudget Decimal  @default(0) @db.Decimal(14, 2)
  ...
}
model BudgetLineItem {
  unitCost  Decimal @db.Decimal(14, 2)
  units     Decimal @db.Decimal(10, 2)
  total     Decimal @db.Decimal(14, 2)
  ...
}
model TimeEntry {
  hours     Decimal @db.Decimal(6, 2)
  ...
}
model HourlyRate {
  rate      Decimal @db.Decimal(10, 2)
  ...
}
```
- Impact: All arithmetic casts the `Prisma.Decimal` back to IEEE-754 `number`, then multiplies/sums. Classic floating-point drift applies: e.g. `0.1 + 0.2 = 0.30000000000000004`, `12.34 * 0.7 = 8.637999999999998`, and large running sums over many `TimeEntry` rows compound rounding error. Persisted `total` is truncated by MySQL to `Decimal(14,2)` which hides per-row drift but the *aggregate* `laborSpent`/`percentUsed` is still wrong and can disagree with a SQL `SUM(hours*rate)` run by accounting. This is unsafe for money.
- Fix: Use `Prisma.Decimal` end-to-end. Either `new Prisma.Decimal(dto.unitCost).mul(dto.units)` with `@prisma/client/runtime/library` or a dedicated `decimal.js`/`big.js` wrapper. Keep Decimals until the final serialization step and format with fixed precision. Add a unit test with representative 0.1/0.2 style inputs.

### [HIGH] Burn report also counts *planned* line items as *spent*
- File: `web/back-nest/src/budgeting/budgeting.service.ts:128-136`
- Category: logic
- Evidence:
```ts
// Material spent = sum(budgetLineItem.total where type='material' and position=0 — i.e. actuals)
const materialSpent = budget
  ? (await this.prisma.budgetLineItem.aggregate({
      where: { budgetId: budget.id, type: 'material' },
      _sum: { total: true },
    }))._sum.total ?? 0
  : 0;
```
- Impact: The code comment says "position=0 — i.e. actuals" but the `where` clause does **not** filter on `position`. Every `BudgetLineItem` of `type='material'` (including planned line items) is counted as materialSpent. The schema has no `isActual` flag distinguishing planned vs actual spend, so on any project with material line items you get `spent ≈ material + labor_time_cost`, and `percentUsed` immediately reports ≥100 %. The comment itself is ambiguous (planned line items usually do not sit at `position=0`). Either the feature is unfinished or the mental model is wrong.
- Fix: Introduce a boolean `isActual` (or a discriminator like `kind: 'planned' | 'actual'`) on `BudgetLineItem`, or move actual material spend into its own table. Then filter `{ budgetId, type: 'material', isActual: true }`. Delete the misleading comment. Add a regression test with a budget that has both planned and actual material line items.

### [HIGH] `upsertBudget` last-write-wins race on concurrent PUT
- File: `web/back-nest/src/budgeting/budgeting.service.ts:27-51`
- Category: race
- Evidence:
```ts
async upsertBudget(projectId: string, dto: { laborBudget?: number; materialBudget?: number; currency?: string; notes?: string }) {
  try {
    const b = await this.prisma.projectBudget.upsert({
      where: { projectId },
      create: {
        projectId,
        laborBudget: dto.laborBudget ?? 0,
        materialBudget: dto.materialBudget ?? 0,
        currency: dto.currency ?? 'EUR',
        notes: dto.notes ?? null,
      },
      update: {
        laborBudget: dto.laborBudget ?? undefined,
        materialBudget: dto.materialBudget ?? undefined,
        currency: dto.currency ?? undefined,
        notes: dto.notes ?? undefined,
      },
      include: { lineItems: { orderBy: { position: 'asc' } } },
    });
    return Result.ok(b);
  } ...
}
```
- Impact: Two PMs editing the budget at the same time: PM1 loads v1 (labor=100k, material=50k), PM2 loads v1, PM1 submits `{ laborBudget: 120k }`, PM2 submits `{ materialBudget: 60k }`. Both are partial payloads and both land on a mutable row with no optimistic-concurrency token. That's fine for independent fields, but the moment one of them sends both fields (say PM2 submits `{ laborBudget: 100k, materialBudget: 60k }` based on stale data), PM1's +20k labor raise is silently overwritten. `ProjectBudget` has no `version` column and no `updatedAt` check is performed.
- Fix: Add an `If-Match` header / `updatedAt` check pattern, or accept a `version: number` in the DTO and bump it atomically with a `{ where: { projectId, updatedAt: dto.lastSeenUpdatedAt } }` conditional update (fall back to `409 Conflict`). Alternatively, wrap the read/modify/write cycle in a transaction with `SELECT ... FOR UPDATE` via `prisma.$transaction`.

### [HIGH] `time-tracking.service.create`, `update`, `delete` do not verify the caller is a project member
- File: `web/back-nest/src/time-tracking/time-tracking.service.ts:61-129`, controller at `time-tracking.controller.ts:10-75`
- Category: auth
- Evidence (service, create):
```ts
async create(userId: string, dto: { projectId: string; workPackageId?: string; hours: number; ... }) {
  try {
    if (dto.hours <= 0 || dto.hours > 24) return Result.fail('Heures invalides (0-24).');
    const e = await this.prisma.timeEntry.create({
      data: {
        userId,
        projectId: dto.projectId,
        workPackageId: dto.workPackageId ?? null,
        ...
      },
    });
```
- Impact: Self-scoping is enforced for read/update/delete of one's *own* entry (`existing.userId !== userId` check at `L100`/`L122`), but `create` accepts **any** `projectId` and `workPackageId` in the body and happily inserts a row. A user who isn't on Project X can log 24h/day against Project X, inflating its burn report and Sprint burndown (because `spentHours` on the WP is also updated at `L83-86`). There's also no validation that `workPackageId` belongs to `projectId`. The task request explicitly asks whether entries are self-scoped "in service (not just by guard)" — answer: partially (read/update/delete yes, create no).
- Fix: In `create`, verify `workPackageId`'s `projectId` matches `dto.projectId`, and verify `userId` is a member of `dto.projectId` (e.g. via `AutomationService.isProjectManager` or a dedicated membership helper). Reject otherwise.

### [HIGH] Week endpoint is timezone-naïve — off-by-one day in any non-UTC region
- File: `web/back-nest/src/time-tracking/time-tracking.service.ts:131-145`; controller at `time-tracking.controller.ts:57-63`
- Category: logic / data-integrity
- Evidence:
```ts
async getWeeklyGrid(userId: string, weekStart: string) {
  try {
    const start = new Date(weekStart);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const entries = await this.prisma.timeEntry.findMany({
      where: { userId, spentOn: { gte: start, lte: end } },
      include: { project: { select: { id: true, name: true } }, workPackage: { select: { id: true, title: true } } },
      orderBy: { spentOn: 'asc' },
    });
    return Result.ok({ start: start.toISOString().slice(0, 10), entries });
```
- Impact: `new Date('2026-04-13')` returns midnight **UTC**. In Europe/Paris (project's locale) the user's intent is midnight Paris, which is 22:00 UTC the previous day during summer (CEST = UTC+2). `TimeEntry.spentOn` is stored as `@db.Date` (no time) so MySQL returns `2026-04-13T00:00:00Z`. The `gte: start` bound matches, but `end = start + 6 days` becomes `2026-04-19T00:00:00Z`, which `lte`-excludes any entry truly on Sunday 19 Apr in Paris TZ (server-side). More subtly, users submitting `spentOn: "2026-04-13"` via `create()` (L70) go through `new Date("2026-04-13")` too and land on the right Date in UTC, but the *week* boundary can still misalign on Daylight-Saving-Time transition days. Returning `start.toISOString().slice(0, 10)` means the client can't detect the mismatch. There's also no validation that `weekStart` is a Monday (or whatever the product definition is).
- Fix: Parse `weekStart` as `YYYY-MM-DD` explicitly (e.g. `new Date(weekStart + 'T00:00:00.000Z')` or use `date-fns-tz` `zonedTimeToUtc`). Reject non-`YYYY-MM-DD` input with 400. Compute `end` using `addDays` from a date library rather than `setDate`. Document the week-start convention (Mon/Sun) and enforce it.

### [HIGH] Burn report and WP `spentHours` include time entries pointing at soft-deleted WorkPackages
- File: `web/back-nest/src/budgeting/budgeting.service.ts:114-149`, `web/back-nest/src/time-tracking/time-tracking.service.ts:78-87`
- Category: data-integrity / logic
- Evidence (burn):
```ts
const entries = await this.prisma.timeEntry.findMany({ where: { projectId, isBillable: true } });
let laborSpent = 0;
for (const e of entries) {
  const rate = await this.timeTracking.getEffectiveRate(e.userId, projectId, new Date(e.spentOn));
  laborSpent += Number(e.hours) * (rate ? Number(rate.rate) : 0);
}
```
- Evidence (recompute WP.spentHours on time entry create):
```ts
if (dto.workPackageId) {
  const agg = await this.prisma.timeEntry.aggregate({
    where: { workPackageId: dto.workPackageId },
    _sum: { hours: true },
  });
  await this.prisma.workPackage.update({
    where: { id: dto.workPackageId },
    data: { spentHours: agg._sum.hours ?? 0 },
  });
}
```
- Evidence (schema): `WorkPackage.isDeleted Boolean @default(false)` at `schema.prisma:657`. `TimeEntry` has **no** `isDeleted` column (`schema.prisma:790-812`). WorkPackages use soft-delete (`work-packages.service.ts:303`: `await this.prisma.workPackage.update({ where: { id }, data: { isDeleted: true } });`), cascading nothing.
- Impact:
  - Burn report counts every `TimeEntry` for the project regardless of whether its WP was soft-deleted — this could be intentional (labour was still paid), but the system gives no way to exclude or report it. There is no "deleted WP" tag in the output so the user can't reconcile.
  - More critically, `TimeEntry.workPackageId` can point at an `isDeleted=true` WP. When a new entry is logged against a still-live *sibling* WP, `spentHours` for the live WP is recomputed correctly. But when an entry is logged against the deleted WP (API allows it — there is no `isDeleted:false` filter anywhere in `time-tracking.service.ts`), `spentHours` is written back onto the deleted WP, which is invisible to users and produces drifting totals.
  - Also applies to project `summary` (`time-tracking.service.ts:147-174`) — totals silently include deleted WPs.
- Fix: Decide the policy: exclude soft-deleted WP contributions from burn/summary (then add `workPackage: { isDeleted: false }` to the `where`) *or* surface them as "archived hours" in the response. In `create()` reject `workPackageId` that is soft-deleted or belongs to another project. Add DB-level check.

### [HIGH] `update` silently allows moving a time entry to another project via `workPackageId`
- File: `web/back-nest/src/time-tracking/time-tracking.service.ts:96-116`
- Category: data-integrity / idor
- Evidence:
```ts
async update(id: string, userId: string, dto: { hours?: number; spentOn?: string; activity?: string; comment?: string; isBillable?: boolean; workPackageId?: string | null }) {
  try {
    const existing = await this.prisma.timeEntry.findUnique({ where: { id } });
    if (!existing) return Result.fail('Saisie introuvable.');
    if (existing.userId !== userId) return Result.fail('Accès refusé.');
    if (existing.lockedAt) return Result.fail('Saisie verrouillée.');

    const data: Record<string, unknown> = {};
    ...
    if (dto.workPackageId !== undefined) data.workPackageId = dto.workPackageId;

    const updated = await this.prisma.timeEntry.update({ where: { id }, data });
```
- Impact: `workPackageId` can be patched to any UUID — including a WP from a *different* project than the time entry's `projectId`. The DB stores the inconsistent row and future aggregates (burn, summary, `spentHours`) go haywire because `WorkPackage.projectId !== TimeEntry.projectId`. Also, `update` never recomputes `WorkPackage.spentHours` on either the old or new WP — the create() path does (L78-87), but not update. Hours moved between WPs become phantom.
- Fix: Reject cross-project reassignment (look up the target WP and ensure its `projectId` matches the entry's `projectId`). After a successful update that changed `workPackageId` or `hours`, recompute `spentHours` on both the old and new WPs. Same story in `delete()` (L118-129) — it doesn't decrement `spentHours` either.

### [HIGH] Lock period is not enforced atomically — race allows editing during the lock window
- File: `web/back-nest/src/time-tracking/time-tracking.service.ts:96-129, 176-185`
- Category: race
- Evidence (lockPeriod):
```ts
async lockPeriod(from: string, to: string, userId?: string) {
  try {
    const where: Record<string, unknown> = { spentOn: { gte: new Date(from), lte: new Date(to) }, lockedAt: null };
    if (userId) where.userId = userId;
    const r = await this.prisma.timeEntry.updateMany({ where, data: { lockedAt: new Date() } });
    return Result.ok({ count: r.count });
```
- Evidence (update guard):
```ts
if (existing.lockedAt) return Result.fail('Saisie verrouillée.');
```
- Impact: The `update` path reads `existing.lockedAt` and then issues a separate `UPDATE`. Between those two queries an admin can run `lockPeriod`, but the `update` has already read `existing.lockedAt = null`; the subsequent `prisma.timeEntry.update({ where: { id }, data })` has **no** `lockedAt: null` predicate, so it clobbers the locked row. Same hole in `delete()` at L123-124. A PATCH also allows the user to modify `spentOn` to a pre-lock date or post-lock date without re-checking the lock predicate (i.e. the lock check is against *current* entry date, not the desired new date).
- Fix: Turn the read+update into a conditional update: `prisma.timeEntry.updateMany({ where: { id, userId, lockedAt: null }, data })`. If `count === 0`, return `Result.fail('Saisie verrouillée ou introuvable')`. On `PATCH` that changes `spentOn`, also validate that the new date is not inside a locked window.

### [HIGH] HourlyRates controller is Admin-only but does not prevent overlapping rate windows — burn report picks ambiguous rates
- File: `web/back-nest/src/time-tracking/time-tracking.service.ts:243-255, 203-232`
- Category: logic / data-integrity
- Evidence (getEffectiveRate):
```ts
async getEffectiveRate(userId: string, projectId: string | null, date: Date) {
  // Project-specific rate wins; fall back to global (projectId=null). Latest validFrom <= date, with validTo null or >= date.
  const candidates = await this.prisma.hourlyRate.findMany({
    where: {
      userId,
      validFrom: { lte: date },
      OR: [{ validTo: null }, { validTo: { gte: date } }],
    },
    orderBy: { validFrom: 'desc' },
  });
  const projectMatch = candidates.find((r) => r.projectId === projectId);
  return projectMatch ?? candidates.find((r) => r.projectId === null) ?? null;
}
```
- Evidence (createRate/updateRate — no validation):
```ts
async createRate(dto: { userId: string; projectId?: string; rate: number; currency?: string; validFrom: string; validTo?: string }) {
  try {
    const r = await this.prisma.hourlyRate.create({
      data: { userId: dto.userId, projectId: dto.projectId ?? null, rate: dto.rate, currency: dto.currency ?? 'EUR',
        validFrom: new Date(dto.validFrom), validTo: dto.validTo ? new Date(dto.validTo) : null },
    });
```
- Impact:
  1. No check that `validFrom <= validTo`. Admin can create a rate with `validFrom=2026-04-18, validTo=2026-04-01` — `getEffectiveRate` then silently filters it out or picks it depending on query date.
  2. Two overlapping rates per (userId, projectId) are allowed. `getEffectiveRate` returns the one with the latest `validFrom` among *all* candidates, then `find` picks the first matching project — but since both rows match `projectId`, the choice is deterministic only by insertion order when `validFrom` is equal, which is non-deterministic across multi-instance.
  3. No currency validation — two overlapping rates with different currencies would produce mixed-currency burn reports.
  4. Bonus: `updateRate` lets you change `validTo` but not `validFrom` — if Admin needs to retroactively fix a typo in `validFrom` they must delete+recreate, losing the FK history.
- Fix: Add DB or service-level validation: `validFrom < validTo` when both set; unique constraint or service-check on `(userId, projectId, overlapping date range)`. Consider a `@@unique([userId, projectId, validFrom])` in the schema plus a `SELECT … for overlap` guard.

---

## MEDIUM findings

### [MEDIUM] `currency` argument on `upsertBudget` / `createRate` accepts any string — allows currency drift
- File: `web/back-nest/src/budgeting/budgeting.service.ts:27-51`, `web/back-nest/src/time-tracking/time-tracking.service.ts:203-232`
- Category: validation
- Evidence:
```ts
currency: dto.currency ?? 'EUR',
```
- Impact: No enumeration (`'EUR' | 'USD' | 'GBP' …`), no ISO-4217 validation. A PM who types `eur` or `€` will fragment the `ProjectBudget.currency` column. The burn report reads `budget?.currency ?? 'EUR'` and returns whatever garbage sits there; the frontend will render it verbatim.
- Fix: Validate against a whitelist (class-validator `@IsIn([...])`). Normalize to uppercase. Add a unique-currency-per-project invariant if the product semantic requires it.

### [MEDIUM] DTOs are anonymous `{ ... }` object literals — class-validator/ValidationPipe is bypassed
- File: `web/back-nest/src/budgeting/budgeting.controller.ts` (all `@Body()` sites), `web/back-nest/src/time-tracking/time-tracking.controller.ts` (all `@Body()` sites)
- Category: validation
- Evidence:
```ts
@Put()
async upsert(
  @Param('projectId') projectId: string,
  @Body() dto: { laborBudget?: number; materialBudget?: number; currency?: string; notes?: string },
) { ... }
```
```ts
@Post()
async create(
  @CurrentUser() user: AuthUser,
  @Body() dto: { projectId: string; workPackageId?: string; hours: number; spentOn: string; ... },
) { ... }
```
- Impact: CLAUDE.md explicitly says: *"DTOs must be classes, not interfaces, when used with `@Body()` — `import type` erases the class at runtime, and NestJS's `ValidationPipe` with `whitelist: true` will strip all fields because the metatype resolves to `Object`."* The anonymous inline types here are worse than interfaces — they offer no runtime schema and the pipe can't validate types, ranges, or reject extra fields. A client sending `{ laborBudget: "haha", rate: "$$$" }` sails straight to Prisma, which then throws a generic DB error. `dto.hours` is compared to 0 and 24 (`time-tracking.service.ts:63`) but `typeof dto.hours === 'string'` satisfies `dto.hours <= 24` in JS (via coercion) only for some inputs — shape validation is missing. Also no `@IsUUID()` check on `projectId`/`workPackageId`.
- Fix: Define `class` DTOs with `class-validator` decorators (`@IsNumber()`, `@Min(0)`, `@Max(24)`, `@IsUUID()`, `@IsDateString()`, `@IsOptional()`, `@IsIn(['EUR','USD',...])`) and bind them via `@Body() dto: CreateTimeEntryDto`. Enable `ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })` in `main.ts` if not already.

### [MEDIUM] `findMyEntries`/`findProjectEntries` date filter accepts an unbounded open range
- File: `web/back-nest/src/time-tracking/time-tracking.service.ts:11-58`
- Category: validation / logic
- Evidence:
```ts
if (filters.from || filters.to) {
  const dateRange: Record<string, Date> = {};
  if (filters.from) dateRange.gte = new Date(filters.from);
  if (filters.to) dateRange.lte = new Date(filters.to);
  where.spentOn = dateRange;
}
```
- Impact: A client can `GET /api/time-entries?from=invalid` and `new Date('invalid')` returns `Invalid Date`. Prisma will throw or coerce silently depending on driver; output is unpredictable. Also no ceiling — `GET /api/time-entries` with no filters loads the user's entire history and joins `project` + `workPackage` for every row; there's no pagination. Same for `findProjectEntries` which joins `user` per row — on a long-running project that's O(entries × users) worth of JSON payload.
- Fix: Validate ISO-date strings at the controller (`@IsDateString()`). Add default `from` (e.g. last 90 days) or require at least one bound. Paginate (`take`/`skip`) with a server-side cap (e.g. 500 rows).

### [MEDIUM] `create` timeEntry updates `WorkPackage.spentHours` outside a transaction
- File: `web/back-nest/src/time-tracking/time-tracking.service.ts:61-94`
- Category: race / data-integrity
- Evidence:
```ts
const e = await this.prisma.timeEntry.create({ data: { ... } });

// Update workPackage.spentHours
if (dto.workPackageId) {
  const agg = await this.prisma.timeEntry.aggregate({
    where: { workPackageId: dto.workPackageId },
    _sum: { hours: true },
  });
  await this.prisma.workPackage.update({
    where: { id: dto.workPackageId },
    data: { spentHours: agg._sum.hours ?? 0 },
  });
}
```
- Impact: Not wrapped in `prisma.$transaction`. Two concurrent `create` calls on the same WP both aggregate before either update; each writes the *old* sum + their own hours, losing one increment. Also, if the `update` fails the `TimeEntry` row is already committed → `spentHours` drifts permanently from truth.
- Fix: Wrap both steps in `prisma.$transaction([ ... ])` or use an atomic increment `data: { spentHours: { increment: dto.hours } }` without the aggregate round-trip (with a nightly reconciliation job if needed).

### [MEDIUM] `createLineItem` position race / duplicate position
- File: `web/back-nest/src/budgeting/budgeting.service.ts:59-80`
- Category: race
- Evidence:
```ts
const max = await this.prisma.budgetLineItem.aggregate({ where: { budgetId: budget.id }, _max: { position: true } });
const total = dto.unitCost * dto.units;
const item = await this.prisma.budgetLineItem.create({
  data: {
    ...
    position: dto.position ?? (max._max.position ?? -1) + 1,
  },
});
```
- Impact: Aggregate+create is not atomic → two concurrent creates pick the same `position`. Also when the caller supplies `dto.position` explicitly there is no check that the slot is free, leading to ambiguous ordering. Schema has `@@index([budgetId, position])` but no uniqueness, so duplicates are silently accepted.
- Fix: Use a sequential numbering strategy (`max + 1` inside a transaction), or use the caller-supplied position and shift subsequent rows (`updateMany({ where: { budgetId, position: { gte: newPos } }, data: { position: { increment: 1 } } })`), all inside `$transaction`.

### [MEDIUM] `updateLineItem` does not recompute `total` if only `dto.unitCost` OR `dto.units` is provided, but fine — and no bounds checks
- File: `web/back-nest/src/budgeting/budgeting.service.ts:82-103`
- Category: validation
- Evidence:
```ts
const unitCost = dto.unitCost ?? Number(existing.unitCost);
const units = dto.units ?? Number(existing.units);
const item = await this.prisma.budgetLineItem.update({
  where: { id },
  data: {
    ...
    total: unitCost * units,
    ...
  },
});
```
- Impact: No rejection of negative `unitCost`, `units`, or non-finite numbers. Client can send `units: -10` and produce a negative `total`, which then subtracts from `materialSpent` in the burn report. Also `total` overflows `Decimal(14,2)` are silently rejected by MySQL (strict mode) or truncated (loose mode) depending on server settings.
- Fix: `@Min(0)` via class-validator on both fields. Optional upper bound or business-rule range check.

### [MEDIUM] `getOverview` (`Admin cross-project budget overview`) includes soft-deleted projects
- File: `web/back-nest/src/budgeting/budgeting.service.ts:151-160`; controller guard at `budgeting.controller.ts:66-77`
- Category: logic
- Evidence:
```ts
async getOverview() {
  try {
    const budgets = await this.prisma.projectBudget.findMany({
      include: { project: { select: { id: true, name: true, status: true } }, lineItems: true },
    });
    return Result.ok(budgets);
  } ...
}
```
- Evidence (Project has `isDeleted` per schema.prisma:151):
```
isDeleted                Boolean  @default(false)
deletedAt                DateTime?
```
- Impact: The admin overview shows every project, including soft-deleted ones. That's consistent with the rest of the codebase in some places, but inconsistent with user expectations in an overview dashboard. Also `select: { id, name, status }` omits `isDeleted` so the client has no way to filter them out.
- Fix: Filter `where: { project: { isDeleted: false } }` or include `isDeleted` in the select so the UI can badge them. Clarify product intent.

### [MEDIUM] `AdminBudgetsController` guard is correct but the unit-test file never covers it
- File: `web/back-nest/src/budgeting/budgeting.controller.ts:66-78`, spec at `budgeting.service.spec.ts` (full file)
- Category: testing
- Evidence (the controller has the correct guard stack):
```ts
@Controller('admin/budgets')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Admin')
export class AdminBudgetsController { ... }
```
- Evidence (the spec file at `budgeting.service.spec.ts` has no e2e/controller tests — only service tests):
```ts
describe('BudgetingService', () => {
  ...
  it('upsertBudget creates with defaults', async () => { ... });
  it('createLineItem computes total = unitCost * units', async () => { ... });
  it('updateLineItem recomputes total when unitCost changes', async () => { ... });
  it('getBurnReport computes spent from time entries at effective rate', async () => { ... });
  it('returns 0% used when budget is 0', async () => { ... });
});
```
- Impact: There is no regression test proving that non-Admin users can't call `/admin/budgets/overview`. If someone deletes `@Roles('Admin')` in a future refactor, nothing catches it.
- Fix: Add a Nest e2e test (or a guard-unit test) that issues a non-Admin JWT and asserts 403 on `GET /admin/budgets/overview`. Same coverage gap for `POST /api/time-entries/lock`.

### [MEDIUM] `HourlyRate.getEffectiveRate` is called from `getBurnReport` in an N+1 loop
- File: `web/back-nest/src/budgeting/budgeting.service.ts:122-127`
- Category: performance
- Evidence:
```ts
const entries = await this.prisma.timeEntry.findMany({ where: { projectId, isBillable: true } });
let laborSpent = 0;
for (const e of entries) {
  const rate = await this.timeTracking.getEffectiveRate(e.userId, projectId, new Date(e.spentOn));
  laborSpent += Number(e.hours) * (rate ? Number(rate.rate) : 0);
}
```
- Impact: One `HourlyRate` query per time entry. On a project with thousands of entries this causes thousands of serial round-trips to MySQL. `getEffectiveRate` itself does two queries-worth of work (fetches all candidates for that user/date). Large projects will see GET `/budget/burn` latency in the multi-second range.
- Fix: Preload `HourlyRate` rows for all `distinct userId` in the project, in a single query, then do the `validFrom <= spentOn && (validTo IS NULL || validTo >= spentOn)` match in memory. Or push the whole calculation to SQL via `$queryRaw` with a CASE expression.

### [MEDIUM] `AuthUser.role` is a plain string — fragile vs. the enum in the rest of the codebase
- File: `web/back-nest/src/time-tracking/time-tracking.controller.ts:8`
- Category: validation
- Evidence:
```ts
interface AuthUser { userId: string; role: string }
...
if (user.role !== 'Admin') throw new BadRequestException('Admin requis.');
```
- Impact: `role` in the codebase is the enum `Admin | ProjectManager | SpecificationTeam | RealizationTeam | DeploymentTeam | Viewer` (per CLAUDE.md's `AppUser` description). Using a raw string comparison to `'Admin'` is fragile against typos and silently drifts if the canonical name changes.
- Fix: Import the shared `Role` enum/union type. Or delete the manual check entirely and use `@Roles('Admin') + RolesGuard` as discussed above.

---

## LOW findings

### [LOW] `getBudget` swallows all errors into a single generic message
- File: `web/back-nest/src/budgeting/budgeting.service.ts:15-25`
- Category: logic
- Evidence:
```ts
async getBudget(projectId: string) {
  try {
    const budget = await this.prisma.projectBudget.findUnique({
      where: { projectId },
      include: { lineItems: { orderBy: { position: 'asc' } } },
    });
    return Result.ok(budget);
  } catch {
    return Result.fail('Échec du chargement du budget.');
  }
}
```
- Impact: `catch {}` (no binding) discards the Error object, so the `Logger` is never called and incidents are unobservable. The rest of the service *does* log (`createLineItem`, `upsertBudget`, `getBurnReport`), so this is inconsistent.
- Fix: `catch (e) { this.logger.error('getBudget failed', e); return Result.fail(...); }`. Apply same treatment to every other `catch {}` in both services (`updateLineItem` L100, `deleteLineItem` L109, `findProjectEntries` L56, `update` L113, `delete` L126, `getWeeklyGrid` L142, `getSummary` L171, `lockPeriod` L182, `listRates` L198, `createRate` L216, `updateRate` L229, `deleteRate` L238).

### [LOW] `upsert` with `update: { ... ?? undefined }` on `notes` means you cannot clear notes
- File: `web/back-nest/src/budgeting/budgeting.service.ts:38-42`
- Category: logic
- Evidence:
```ts
update: {
  laborBudget: dto.laborBudget ?? undefined,
  materialBudget: dto.materialBudget ?? undefined,
  currency: dto.currency ?? undefined,
  notes: dto.notes ?? undefined,
},
```
- Impact: Sending `{ notes: null }` becomes `notes: undefined` which Prisma treats as "no change". Users cannot ever delete budget notes once set. Same pattern for currency.
- Fix: Distinguish "key missing" from "key = null". Use `'notes' in dto ? dto.notes : undefined`. Or use a class DTO + `@IsOptional()` + ValidationPipe so `null` flows through.

### [LOW] `HourlyRate` uses `@db.Date` on `validFrom/validTo` — same timezone pitfalls as TimeEntry
- File: `schema.prisma:820-821`, consumed by `time-tracking.service.ts:243-255`
- Category: logic
- Evidence:
```ts
validFrom DateTime  @db.Date
validTo   DateTime? @db.Date
```
- Impact: Midnight-UTC dates compared via `lte`/`gte` against `new Date()` (current server time, midnight-local). On the validFrom day itself the comparison works in most zones but is off on DST switchovers. Rate changes scheduled at "2026-03-30 00:00 Europe/Paris" don't kick in until 02:00 Paris on DST days.
- Fix: Store timestamps in UTC (`DateTime` without `@db.Date`), or explicitly document and normalize the boundary to 00:00 in a single canonical zone.

### [LOW] `createRate` allows `projectId` referring to a project the `userId` does not belong to
- File: `web/back-nest/src/time-tracking/time-tracking.service.ts:203-219`
- Category: validation
- Evidence: Method takes both `userId` and optional `projectId`, does no cross-validation.
- Impact: Admin can set a per-project rate for a user who never works on that project. Harmless but clutters rate tables and skews audit reports.
- Fix: Best-effort check: if `projectId` supplied, warn (not reject) when user has no membership record. Could be enforced by schema FK if there were a `ProjectMember` join table.

### [LOW] Round trip: `createLineItem` uses `total` from JS computation, then returned to client — mismatch vs DB on truncation
- File: `web/back-nest/src/budgeting/budgeting.service.ts:63-74`
- Category: data-integrity
- Evidence:
```ts
const total = dto.unitCost * dto.units;
const item = await this.prisma.budgetLineItem.create({
  data: { ..., total, ... },
});
return Result.ok(item);
```
- Impact: MySQL truncates/rounds `total` to 2 decimals on insert but Prisma then *returns the DB value* in `item`. So the returned `item.total` may differ from the JS `total` the caller sent. Not a bug per se, but the mixed representation (JS number vs. Prisma.Decimal object) means the frontend has to handle both a `number` and a stringified Decimal. That's inconsistent with the rest of the module.
- Fix: Return values normalized with `.toFixed(2)` or wrap with a DTO transformer. Pick one: Decimal-string everywhere or number-truncated-to-2dp everywhere.

### [LOW] `delete` time entry never decrements `WorkPackage.spentHours`
- File: `web/back-nest/src/time-tracking/time-tracking.service.ts:118-129`
- Category: logic
- Evidence:
```ts
async delete(id: string, userId: string) {
  try {
    const existing = await this.prisma.timeEntry.findUnique({ where: { id } });
    if (!existing) return Result.fail<void>('Saisie introuvable.');
    if (existing.userId !== userId) return Result.fail<void>('Accès refusé.');
    if (existing.lockedAt) return Result.fail<void>('Saisie verrouillée.');
    await this.prisma.timeEntry.delete({ where: { id } });
    return Result.ok<void>();
```
- Impact: After delete, `WorkPackage.spentHours` still includes the deleted entry's hours. Burndown + burn report drift.
- Fix: After delete, re-aggregate + update `spentHours` (same as the create path does). Better: do it in a `$transaction`.

### [LOW] `isBillable: false` time entries still increment `WorkPackage.spentHours`
- File: `web/back-nest/src/time-tracking/time-tracking.service.ts:78-87`, burn report filter at `budgeting.service.ts:122`
- Category: logic / `[UNCERTAIN]` (could be intentional)
- Evidence: `create` sums all entries (`where: { workPackageId }`) while burn-report sums only billable ones (`where: { projectId, isBillable: true }`).
- Impact: `WorkPackage.spentHours` includes non-billable hours (admin, training, internal). That's fine for burndown semantics (effort actually spent) but means the burn report's labour cost (billable-only) will be lower than what burndown suggests — which could confuse product managers. `[UNCERTAIN]` whether product intent is to include non-billable in burndown.
- Fix: Document the invariant explicitly. If non-billable should be excluded from burndown, add `isBillable: true` to the aggregate on L80.

### [LOW] Log-and-swallow pattern drops Prisma error codes
- File: `web/back-nest/src/budgeting/budgeting.service.ts:47-49, 76-79, 100-102, 109-111, 145-148`; `time-tracking.service.ts:32-34, 56-58, 90-93, 113-115, 126-128, 142-144, 171-173, 181-184, 197-200, 215-218, 228-231, 237-240`
- Category: logic
- Evidence:
```ts
} catch (e) {
  this.logger.error('upsertBudget failed', e);
  return Result.fail('Échec de la sauvegarde.');
}
```
- Impact: Unique-constraint violations, foreign-key failures, and "record not found" are all folded into the same generic 400. The client cannot distinguish "budget does not exist" from "DB down". Debugging lives off log-grep.
- Fix: Map known Prisma error codes (`P2002`, `P2025`, …) to domain-specific `Result.fail()` messages and distinct HTTP statuses (`404` / `409`). Keep the generic fallback for unknown errors.

### [LOW] `lockPeriod` returns only `{ count }` but doesn't record who locked
- File: `web/back-nest/src/time-tracking/time-tracking.service.ts:176-185`, schema at `schema.prisma:800`
- Category: logic
- Evidence: `TimeEntry.lockedAt` is a timestamp but there is no `lockedBy` / `lockedByUserId` column.
- Impact: No audit trail for who locked the entries. In a regulated environment (labour law / payroll audit) this is likely a compliance gap.
- Fix: Add `lockedByUserId String?` to `TimeEntry` and record the admin's userId at lock time. Consider promoting the lock concept to a separate `TimeEntryLockPeriod` row.

### [LOW] `AuthUser` interface duplicated inline instead of imported from a shared module
- File: `web/back-nest/src/time-tracking/time-tracking.controller.ts:8`
- Category: logic
- Evidence:
```ts
interface AuthUser { userId: string; role: string }
```
- Impact: Shape drift risk across controllers; other controllers may add `email`, `permissions`, etc.
- Fix: Move to `src/common/types/auth-user.ts` and import uniformly.

---

## Summary

| Area | Verdict |
|---|---|
| Money arithmetic (Decimal vs Number) | **Broken** — all arithmetic demoted to JS `number`, loses precision on Decimal columns. See [HIGH] Money arithmetic. |
| Concurrent budget PUT race | **Broken** — partial-payload upsert with no version/ETag, last-write-wins. See [HIGH] upsertBudget race. |
| Line-item authz | **Broken** — anyone with any JWT can read and, given the missing scoping check in `updateLineItem`/`deleteLineItem`, mutate or delete line items from any project. See [CRITICAL] both findings. |
| Burn report uses soft-deleted entries | TimeEntry has no soft-delete of its own, but the report does **not** exclude entries tied to soft-deleted WPs. See [HIGH] soft-deleted WP contribution. |
| Time entries self-scoped in service | Only partially — update/delete self-scope correctly, but `create` accepts any `projectId`/`workPackageId` from the body with no membership check. See [HIGH] create-side self-scoping. |
| Lock-period honoured by PATCH | **Race** — update reads `lockedAt` then updates without a predicate; `lockPeriod` can fire in between. Also `spentOn` changes aren't re-validated against the lock window. See [HIGH] lock-period race. |
| Hourly-rates `@Roles('Admin')` | **Correctly** guarded with `JwtAuthGuard + RolesGuard + @Roles('Admin')` at `time-tracking.controller.ts:102-105`. The legacy `@Roles` shim at `common/guards/roles.guard.ts` correctly resolves it. |
| Timezone on week endpoint | **Broken in non-UTC** — naïve `new Date(weekStart)` parses as UTC midnight, misaligned with user's local week boundary. See [HIGH] week endpoint TZ. |
| Cross-project time summary leak | **Broken** — `ProjectTimeEntriesController` has no role/membership guard. See [CRITICAL] cross-project summary. |
| Admin cross-project budget overview guard | **Correctly** guarded (`AdminBudgetsController` has `JwtAuthGuard + RolesGuard + @Roles('Admin')`). However there is no regression test for the guard and the query includes soft-deleted projects. See [MEDIUM] soft-deleted projects in overview and [MEDIUM] missing test coverage. |

Top priorities to fix before this module is production-safe:

1. Add role + project-membership guards to `BudgetingController` and `ProjectTimeEntriesController` (CRITICAL).
2. Scope `updateLineItem`/`deleteLineItem` by `projectId` (CRITICAL).
3. Move `Admin` check in `POST /api/time-entries/lock` to a `RolesGuard` + `@Roles('Admin')` (CRITICAL).
4. Switch money arithmetic to `Prisma.Decimal` end-to-end (HIGH).
5. Validate `workPackageId.projectId === time-entry.projectId` on create/update, and exclude soft-deleted WPs (HIGH).
6. Make the lock predicate atomic via conditional `updateMany` (HIGH).
7. Replace the "material spent = sum of all material line items" logic with a real planned-vs-actual distinction (HIGH).
8. Fix timezone handling on `weekStart` (HIGH).
