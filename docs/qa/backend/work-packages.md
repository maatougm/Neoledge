# QA Review — `web/back-nest/src/work-packages/`

Files opened:
- `C:\Users\BigPoppa\Desktop\neoleadge\web\back-nest\src\work-packages\work-packages.controller.ts`
- `C:\Users\BigPoppa\Desktop\neoleadge\web\back-nest\src\work-packages\work-packages.service.ts`
- `C:\Users\BigPoppa\Desktop\neoleadge\web\back-nest\src\work-packages\work-packages.service.spec.ts`
- `C:\Users\BigPoppa\Desktop\neoleadge\web\back-nest\src\work-packages\work-packages.module.ts`
- `C:\Users\BigPoppa\Desktop\neoleadge\web\back-nest\src\work-packages\wp-comments.controller.ts`
- `C:\Users\BigPoppa\Desktop\neoleadge\web\back-nest\src\work-packages\wp-comments.service.ts`
- `C:\Users\BigPoppa\Desktop\neoleadge\web\back-nest\src\work-packages\dto\work-package.dto.ts`

Cross-reference queries run (to verify suspected gaps):
- `Grep ProjectMember|projectMember|hasProjectAccess|checkProjectAccess|assertProjectAccess` across `web/back-nest/src` → **no files found** (no project-access helper exists in the backend).
- `Grep RolesGuard|@Roles\(` across `web/back-nest/src/work-packages` → **no files found** (this module uses only `JwtAuthGuard`, no role gate).

---

## Summary scoreboard

| Severity | Count |
|----------|-------|
| CRITICAL | 5 |
| HIGH | 7 |
| MEDIUM | 6 |
| LOW | 4 |
| UNCERTAIN | 2 |

---

## CRITICAL issues

### [CRITICAL] No project-access authorization on any `/pm/projects/:projectId/work-packages/*` endpoint
- File: `web/back-nest/src/work-packages/work-packages.controller.ts:32-144`
- Category: auth / idor
- Evidence:
```ts
@Controller('pm/projects/:projectId/work-packages')
@UseGuards(JwtAuthGuard)
export class WorkPackagesController {
  constructor(private readonly service: WorkPackagesService) {}

  @Get()
  async findAll(
    @Param('projectId') projectId: string,
    ...
  ) {
    ...
    const r = await this.service.findAll(projectId, filters);
```
And in the service (`work-packages.service.ts:115-149`):
```ts
async findAll(projectId: string, filters: WorkPackageFilters = {}) {
  try {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(200, Math.max(1, filters.limit ?? 50));
    const where: Record<string, unknown> = { projectId, isDeleted: false };
    ...
    const [items, total] = await Promise.all([
      this.prisma.workPackage.findMany({ where, ... }),
      this.prisma.workPackage.count({ where }),
    ]);
```
- Impact: Any authenticated user (including `Viewer` or `DeploymentTeam` members who have zero relation to the target project) can enumerate, read, create, update, soft-delete, move, watch, add dependencies on, and mutate custom values for work packages on **any** project just by knowing/guessing `projectId`. Classic IDOR at scale — the controller relies solely on a JWT being present and never verifies the caller belongs to the project or has a PM/Admin role. Confirmed by the absence of any `ProjectMember`/access helper in the codebase (grep returned nothing) and by the module not registering `RolesGuard`.
- Fix: Add `RolesGuard` + `@Roles('Admin', 'ProjectManager', 'SpecificationTeam', ...)` at the controller, and also add a project-access helper (check `project.primaryUserId`, team membership, or an explicit `ProjectMember` table) that is invoked at the start of every service method taking `projectId`. Return `ForbiddenException` when the caller has no relationship to the project. The `CLAUDE.md` in this repo even mandates this pattern for admin routes — it has been skipped here.

### [CRITICAL] `findOne` / `update` / `softDelete` accept a `projectId` but trust it blindly — no ownership recheck on nested endpoints (watchers, dependencies, custom values, move)
- File: `web/back-nest/src/work-packages/work-packages.controller.ts:101-143` and `work-packages.service.ts:311-417`
- Category: idor / auth
- Evidence:
```ts
@Patch(':id/move')
async move(@Param('id') id: string, @Body() dto: MoveWorkPackageDto) {
  const r = await this.service.moveCard(id, dto);
  ...
}

@Post(':id/watchers')
@HttpCode(HttpStatus.CREATED)
async addWatcher(@Param('id') id: string, @Body() body: { userId: string }) {
  const r = await this.service.addWatcher(id, body.userId);
  ...
}

@Post(':id/dependencies')
@HttpCode(HttpStatus.CREATED)
async addDependency(@Param('id') id: string, @Body() dto: AddDependencyDto) {
  const r = await this.service.addDependency(id, dto.toWpId, dto.type ?? 'relates');
  ...
}

@Delete(':id/dependencies/:depId')
@HttpCode(HttpStatus.NO_CONTENT)
async removeDependency(@Param('depId') depId: string) {
  const r = await this.service.removeDependency(depId);
  ...
}

@Put(':id/custom-values')
async upsertCustomValues(@Param('id') id: string, @Body() dto: UpsertCustomValuesDto) {
  const r = await this.service.upsertCustomValues(id, dto.values || []);
```
And in the service:
```ts
async moveCard(id: string, dto: MoveWorkPackageDto) {
  try {
    const data: Record<string, unknown> = {};
    if (dto.boardColumnId !== undefined) data.boardColumnId = dto.boardColumnId;
    ...
    const wp = await this.prisma.workPackage.update({ where: { id }, data });
```
- Impact: The URL says `/pm/projects/:projectId/...` but the controller never passes `projectId` into `moveCard`, `addWatcher`, `removeWatcher`, `addDependency`, `removeDependency`, `upsertCustomValues`. The service therefore never checks `where: { id, projectId }`. An attacker can pass any `projectId` they have a token for and mutate a WP belonging to an entirely different project. Combined with the previous finding, this gives fully cross-project write access to any authenticated user.
- Fix: Every nested route must read `projectId` from the path and pass it to the service, and every service method must re-assert `workPackage.projectId === projectId` (and, for dependencies, that both the source WP and `depId`'s WP belong to the same project) before any DB mutation.

### [CRITICAL] Cross-project dependency leak — `addDependency` never validates that `toWpId` belongs to the same project as `fromWpId`
- File: `web/back-nest/src/work-packages/work-packages.service.ts:350-359`
- Category: data-integrity / idor
- Evidence:
```ts
async addDependency(fromWpId: string, toWpId: string, type: string) {
  try {
    if (fromWpId === toWpId) return Result.fail('Impossible de créer une dépendance sur le même work package.');
    const d = await this.prisma.workPackageDependency.create({ data: { fromWpId, toWpId, type: type || 'relates' } });
    return Result.ok(d);
  } catch (e) {
    this.logger.error('addDependency failed', e);
    return Result.fail('Échec de l\'ajout de la dépendance.');
  }
}
```
- Impact: A user can create dependencies that link a WP in project A to a WP in project B. This leaks WP IDs across projects (via `dependenciesIn`/`dependenciesOut` includes in `findOne`) and breaks all Gantt/Agile queries that assume per-project isolation. Combined with missing project access, attackers can enumerate the WP ID space of every project.
- Fix: Load both `fromWp` and `toWp` (`findFirst { id, isDeleted: false }`), require `fromWp.projectId === toWp.projectId`, and reject otherwise. Also assert both match the URL `projectId`.

### [CRITICAL] No cycle detection on dependencies — A blocks B and B blocks A is accepted
- File: `web/back-nest/src/work-packages/work-packages.service.ts:350-359`
- Category: logic / data-integrity
- Evidence: same block as above. Only same-id self-loops are rejected (`if (fromWpId === toWpId)`). There is no traversal of existing `dependenciesOut` / `dependenciesIn` to detect cycles of length ≥ 2.
- Impact: User can create `A blocks B` + `B blocks A` (or any longer cycle). Gantt scheduling, "what-can-start-now" queries, and any topological computation downstream will either infinite-loop, produce wrong dates, or crash. Bad UX and potential DoS vector if the Gantt module walks the graph without a visited set.
- Fix: Before creating the edge, BFS/DFS from `toWpId` following `dependenciesOut` looking for `fromWpId`. If found → reject with `Result.fail('Cycle de dépendance détecté.')`. Ideally only block the specific types that imply ordering (`blocks`, `follows`); `relates` could be allowed to cycle but it's safer to reject all.

### [CRITICAL] `removeDependency` deletes by `depId` alone — no project/WP-ownership check
- File: `web/back-nest/src/work-packages/work-packages.service.ts:361-369`
- Category: idor
- Evidence:
```ts
async removeDependency(depId: string) {
  try {
    await this.prisma.workPackageDependency.delete({ where: { id: depId } });
    return Result.ok<void>();
  } catch (e) {
    this.logger.error('removeDependency failed', e);
    return Result.fail<void>('Échec de la suppression de la dépendance.');
  }
}
```
- Impact: Any authenticated user can wipe any dependency in the system by guessing/iterating `depId`. No ownership check, no project scoping, no WP-match check against the URL `:id`.
- Fix: Load the dependency first, assert its `fromWpId` corresponds to the URL `:id` and that the WP belongs to the URL `:projectId`. Only then delete.

---

## HIGH issues

### [HIGH] `upsertCustomValues` — mass-assignment with no project/field-ownership verification (bulk PUT)
- File: `web/back-nest/src/work-packages/work-packages.service.ts:403-417`
- Category: idor / data-integrity
- Evidence:
```ts
async upsertCustomValues(workPackageId: string, values: { customFieldId: string; value?: string }[]) {
  try {
    for (const v of values) {
      await this.prisma.workPackageCustomValue.upsert({
        where: { workPackageId_customFieldId: { workPackageId, customFieldId: v.customFieldId } },
        create: { workPackageId, customFieldId: v.customFieldId, value: v.value ?? null },
        update: { value: v.value ?? null },
      });
    }
    return Result.ok<void>();
  } ...
}
```
- Impact: (a) `customFieldId`s are not validated to belong to the same project as `workPackageId` — user can attach any project's custom fields to any WP, creating inconsistent data and leaking field existence across projects. (b) No array length cap → a user can POST 10,000 entries and the service will sequentially upsert each (N round-trips, no transaction), causing a slow path and potential DoS. (c) No per-field type/length/size validation on `value`.
- Fix: Validate `customFieldId IN (SELECT id FROM WorkPackageCustomField WHERE projectId = <wp.projectId>)`, cap array size (≤ 100), wrap all upserts in `prisma.$transaction`, and enforce length limits on `value`.

### [HIGH] `UpsertCustomValuesDto.values` has no `class-validator` decorators — `ValidationPipe` with `whitelist: true` will strip it
- File: `web/back-nest/src/work-packages/dto/work-package.dto.ts:50-57`
- Category: validation
- Evidence:
```ts
export class CustomValueDto {
  @IsString() customFieldId!: string;
  @IsOptional() @IsString() value?: string;
}

export class UpsertCustomValuesDto {
  values!: CustomValueDto[];
}
```
- Impact: No `@IsArray()`, no `@ValidateNested({ each: true })`, no `@Type(() => CustomValueDto)`. With `whitelist: true` in `ValidationPipe` (standard config per `CLAUDE.md`), unknown/un-decorated props get stripped, so the route either receives `values: undefined` or, if stripping is disabled, receives raw objects (including extra unknown keys) without type transformation. The controller then runs `dto.values || []` which masks the bug silently (see code at `work-packages.controller.ts:140`). Result: the endpoint either never works under strict whitelist or happily accepts malformed payloads.
- Fix:
```ts
import { Type } from 'class-transformer';
import { IsArray, ArrayMaxSize, ValidateNested } from 'class-validator';

export class UpsertCustomValuesDto {
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => CustomValueDto)
  values!: CustomValueDto[];
}
```

### [HIGH] `addWatcher` lets any authenticated user subscribe arbitrary OTHER users to watch any WP
- File: `web/back-nest/src/work-packages/work-packages.controller.ts:108-114` + `work-packages.service.ts:326-338`
- Category: auth / logic
- Evidence:
```ts
@Post(':id/watchers')
@HttpCode(HttpStatus.CREATED)
async addWatcher(@Param('id') id: string, @Body() body: { userId: string }) {
  const r = await this.service.addWatcher(id, body.userId);
  ...
}
```
```ts
async addWatcher(workPackageId: string, userId: string) {
  try {
    const existing = await this.prisma.workPackageWatcher.findUnique({
      where: { workPackageId_userId: { workPackageId, userId } },
    });
    if (existing) return Result.ok(existing);
    const w = await this.prisma.workPackageWatcher.create({ data: { workPackageId, userId } });
    return Result.ok(w);
  } ...
}
```
- Impact: `userId` is client-supplied in the POST body. Any caller can subscribe any other user (even an Admin) to watch any WP, causing targeted notification spam / phishing-style harassment via the notification delivery pipeline (since watchers later receive notifications on status/assignee changes). Also no check that `userId` exists, is active (not deactivated), or belongs to the project team.
- Fix: Either (a) only let users subscribe themselves (`userId = CurrentUser().userId`), or (b) require PM/Admin role and verify `userId` belongs to the project. Validate `userId` references an existing, active `AppUser`.

### [HIGH] `removeWatcher` has no authorization — anyone can unsubscribe anyone
- File: `web/back-nest/src/work-packages/work-packages.controller.ts:116-121` + `work-packages.service.ts:340-348`
- Category: auth
- Evidence:
```ts
@Delete(':id/watchers/:userId')
@HttpCode(HttpStatus.NO_CONTENT)
async removeWatcher(@Param('id') id: string, @Param('userId') userId: string) {
  const r = await this.service.removeWatcher(id, userId);
  ...
}
```
```ts
async removeWatcher(workPackageId: string, userId: string) {
  try {
    await this.prisma.workPackageWatcher.deleteMany({ where: { workPackageId, userId } });
    return Result.ok<void>();
  } ...
}
```
- Impact: Any authenticated user can remove any watcher from any WP — silencing notifications that other team members rely on (e.g. an attacker removes the assignee or the PM from watchers, then changes status to hide activity).
- Fix: Allow only self-removal (`userId === currentUser.userId`), or require PM/Admin role, plus verify the WP belongs to the URL `projectId`.

### [HIGH] `update` triggers notifications BEFORE confirming watcher/assignee state — potential spam + missing de-dup with `Assignee` reason
- File: `work-packages.service.ts:260-289` combined with `notifyWatchersAndAssignee:45-83`
- Category: logic / perf
- Evidence:
```ts
if (actorId) {
  const newAssignee = dto.assigneeId;
  if (newAssignee !== undefined && newAssignee !== existing.assigneeId && newAssignee) {
    void this.notifications.notifyEnhanced({
      userId: newAssignee,
      type: 'work_package_assigned',
      title: 'Tâche réassignée',
      ...
      reason: 'Assignee',
      ...
    });
  }
  if (dto.status !== undefined && dto.status !== existing.status) {
    void this.notifyWatchersAndAssignee(
      id, actorId, 'StatusChange', 'Statut mis à jour', `"${wp.title}" → ${dto.status}`, projectId,
    );
    ...
  }
}
```
And:
```ts
const wp = await this.prisma.workPackage.findUnique({
  where: { id: wpId },
  select: { assigneeId: true },
});
const userIds = new Set<string>();
if (wp?.assigneeId && wp.assigneeId !== actorId) userIds.add(wp.assigneeId);
for (const w of watchers) userIds.add(w.userId);
```
- Impact: If one PATCH request changes both `assigneeId` and `status` in the same call, the new assignee receives TWO notifications: one `Assignee` (from the first branch) and one `StatusChange` (via `notifyWatchersAndAssignee`, which always re-adds the current `assigneeId`). Worse: the Set dedup is by userId only, so it can't dedup across different reasons in the same transaction. End result = notification spam when bulk-editing. Also, `notifyWatchersAndAssignee` issues one DB query per event (watchers) + one per event (assignee lookup) rather than reading from the already-updated `wp` object — extra round trips.
- Fix: Consolidate into a single notification pipeline per update; de-dup per `(userId, entityId)`; reuse the `wp` object already returned by `prisma.workPackage.update` instead of issuing another `findUnique`.

### [HIGH] `findForAssignee` / `findAll` `q` filter uses `contains` without MySQL collation handling — may be case-sensitive / slow full-scan
- File: `work-packages.service.ts:86-113` and `115-149`
- Category: perf / data-integrity
- Evidence:
```ts
if (filters.q) where.title = { contains: filters.q };
```
- Impact: On MariaDB the default behavior depends on the column collation (`utf8mb4_unicode_ci` vs `utf8mb4_bin`). Prisma does not pass `mode: 'insensitive'` because MariaDB doesn't support it — which means if the column is `_bin` the search is case-sensitive. Also `contains` → `LIKE '%...%'` → no index usage → full scan on large tables. Coupled with `page`/`limit` capped at 200, this still means a full-table scan + sort on every search request. Without any minimum length, `q=""` (empty string after url-decode) may still be set by the caller if `filters.q` is truthy (e.g. space).
- Fix: Guard minimum length (`filters.q.trim().length >= 2`), add a `FULLTEXT INDEX (title, description)` + use raw SQL `MATCH ... AGAINST`, or at minimum explicitly set search collation. Log/limit suspicious queries.

### [HIGH] `findOne` returns `NotFoundException` only when the service fails — but service returns `Result.fail('Work package introuvable.')` both for "does not exist" and "DB error"
- File: `work-packages.service.ts:151-178` + `work-packages.controller.ts:63-68`
- Category: logic / auth
- Evidence:
```ts
async findOne(id: string, projectId: string) {
  try {
    const wp = await this.prisma.workPackage.findFirst({
      where: { id, projectId, isDeleted: false },
      include: { ... },
    });
    if (!wp) return Result.fail('Work package introuvable.');
    return Result.ok(wp);
  } catch (e) {
    this.logger.error('findOne failed', e);
    return Result.fail('Échec du chargement du work package.');
  }
}
```
```ts
@Get(':id')
async findOne(@Param('projectId') projectId: string, @Param('id') id: string) {
  const r = await this.service.findOne(id, projectId);
  if (r.isFailure) throw new NotFoundException(r.error);
  return r.value;
}
```
- Impact: Because there's no access control, the 404 vs 403 distinction is the only way to avoid leaking "this WP id exists in another project". Here a WP that exists but belongs to a different project would return `findFirst` null → `Result.fail('Work package introuvable.')` → 404 — which is OK — but combined with the missing project-access check on `findAll`, an attacker can still confirm existence via list endpoints. More importantly, on DB errors, 404 Not Found is also thrown (should be 500), which masks operational issues.
- Fix: Distinguish error types (dedicated `NotFoundError` in Result), and keep 404 responses uniform across "not yours" and "not exists" to avoid ID enumeration once access controls are added.

---

## MEDIUM issues

### [MEDIUM] `create` accepts `sprintId`, `versionId`, `boardColumnId`, `parentId` without verifying they belong to the same project
- File: `work-packages.service.ts:180-235`
- Category: data-integrity
- Evidence:
```ts
const wp = await this.prisma.workPackage.create({
  data: {
    projectId,
    ...
    parentId: dto.parentId ?? null,
    sprintId: dto.sprintId ?? null,
    versionId: dto.versionId ?? null,
    boardColumnId: dto.boardColumnId ?? null,
    ...
  },
  ...
});
```
- Impact: A user can create a WP in project A while pointing `sprintId`/`versionId`/`boardColumnId`/`parentId` at entities from project B. The only protection is the Prisma FK check for existence — not for project match. This breaks Agile / Gantt views that filter by `board.projectId` (a card will appear in a board whose project doesn't match its own). Cross-project data leak through indirect references.
- Fix: For each of these 4 fields, if provided, look it up and assert `.projectId === projectId` before creating.

### [MEDIUM] `update` — same cross-project FK problem (parent/sprint/version/column/assignee reassignment not validated)
- File: `work-packages.service.ts:237-297`
- Category: data-integrity
- Evidence:
```ts
const keys: (keyof UpdateWorkPackageDto)[] = ['title', 'description', 'type', 'status', 'priority', 'assigneeId', 'parentId', 'sprintId', 'versionId', 'boardColumnId', 'spentHours', 'percentDone', 'position', 'estimatedHours'];
for (const k of keys) {
  if (dto[k] !== undefined) data[k] = dto[k];
}
```
- Impact: Same as create — plus can reparent a WP under a parent from a different project. Also `assigneeId` is not validated: can set to any `AppUser.id` including deactivated users or users outside the team. And `percentDone` is capped only via DTO (0–100), but `spentHours` is not capped at all (any number accepted by `@IsNumber()`).
- Fix: Re-validate every referenced FK belongs to the same project; validate `assigneeId` references an active team member; add `@Min(0)` / `@Max(100000)` to `spentHours`.

### [MEDIUM] `moveCard` does not re-authorize on the new column/sprint/parent scope
- File: `work-packages.service.ts:311-324`
- Category: idor / data-integrity
- Evidence:
```ts
async moveCard(id: string, dto: MoveWorkPackageDto) {
  try {
    const data: Record<string, unknown> = {};
    if (dto.boardColumnId !== undefined) data.boardColumnId = dto.boardColumnId;
    if (dto.sprintId !== undefined) data.sprintId = dto.sprintId;
    if (dto.parentId !== undefined) data.parentId = dto.parentId;
    if (dto.position !== undefined) data.position = dto.position;
    const wp = await this.prisma.workPackage.update({ where: { id }, data });
    return Result.ok(wp);
```
- Impact: Client can move a WP into any `boardColumnId` / `sprintId` / `parentId` regardless of project membership. Combined with the top-level auth miss, this is how cross-project Kanban cards leak. Also no loop-prevention for parent — a WP can be set as its own ancestor's child, creating a cycle in the `parent` tree that breaks every recursive children fetch (the `children` include will recurse only one level here but other modules may BFS and stack-overflow).
- Fix: Load the WP, assert caller has project access, validate target column/sprint/parent belong to same project, and run an ancestor walk before accepting a new `parentId`.

### [MEDIUM] `listCustomFields` / `createCustomField` / `deleteCustomField` have no project-access check and `deleteCustomField` ignores `projectId`
- File: `work-packages.service.ts:371-401` + `work-packages.controller.ts:146-176`
- Category: idor / auth
- Evidence:
```ts
@Delete(':id')
@HttpCode(HttpStatus.NO_CONTENT)
async remove(@Param('id') id: string) {
  const r = await this.service.deleteCustomField(id);
  ...
}
```
```ts
async deleteCustomField(id: string) {
  try {
    await this.prisma.workPackageCustomField.delete({ where: { id } });
    return Result.ok<void>();
  } ...
}
```
- Impact: Any authenticated user can delete any custom field from any project by guessing the field id. Cascades may wipe thousands of `WorkPackageCustomValue` rows across all WPs in a project — permanent data loss with no undo.
- Fix: Pass `projectId` through, require `RolesGuard + @Roles('Admin', 'ProjectManager')`, assert the field belongs to `projectId`, and soft-delete (not hard delete) to preserve audit trail.

### [MEDIUM] `MyTasksController` at `/pm/my-tasks` paginates page/limit but doesn't validate they are integers — `NaN` bypasses `Math.max`
- File: `work-packages.controller.ts:14-29` + `work-packages.service.ts:86-113`
- Category: validation / perf
- Evidence:
```ts
const r = await this.service.findForAssignee(user.userId, {
  status, q,
  page: page ? parseInt(page, 10) : undefined,
  limit: limit ? parseInt(limit, 10) : undefined,
});
```
```ts
const page = Math.max(1, filters.page ?? 1);
const limit = Math.min(200, Math.max(1, filters.limit ?? 100));
```
- Impact: `parseInt('abc', 10)` → `NaN`. `Math.max(1, NaN)` → `NaN`. `(page - 1) * limit` → `NaN`. Prisma's `skip` and `take` with NaN silently accepts or throws (behavior varies). Also negative pages via `page=-5` → `Math.max(1, -5)` → 1 (fine), but `limit=0` → `Math.max(1, 0)` → 1 (fine). The NaN path is the dangerous one.
- Fix: `const parsed = Number.parseInt(page ?? '', 10); Number.isFinite(parsed) && parsed > 0 ? parsed : 1`. Or better: use `@Query()` DTO with `class-validator` / `ParseIntPipe` with default.

### [MEDIUM] `parentId === 'null'` string coercion in controller is brittle
- File: `work-packages.controller.ts:51-57`
- Category: validation
- Evidence:
```ts
const filters = {
  status, type, priority, assigneeId, sprintId, versionId,
  parentId: parentId === 'null' ? null : parentId,
  q,
  ...
};
```
- Impact: Clients have to know to send the literal string `"null"` (not empty, not `undefined`, not `"NULL"`) to get top-level WPs. Any variation silently returns filtered-by-undefined results (which in the service treats as "no filter"). This is unintuitive and error-prone; also note the service has `if (filters.parentId === null) where.parentId = null; else if (filters.parentId) where.parentId = filters.parentId;` — empty string `parentId` in the URL yields `filters.parentId = ''` (falsy) → no filter applied, silently returns all WPs.
- Fix: Accept a dedicated `topLevel=true` query flag, or document explicitly.

---

## LOW issues

### [LOW] `wp-comments.service.ts` / `wp-comments.controller.ts` — no `projectId` validation chain
- File: `web/back-nest/src/work-packages/wp-comments.controller.ts:8-12`, `wp-comments.service.ts:9-62`
- Category: idor / auth
- Evidence:
```ts
@Controller('pm/projects/:projectId/work-packages/:wpId/comments')
@UseGuards(JwtAuthGuard)
export class WpCommentsController {
```
```ts
async list(workPackageId: string) {
  try {
    const comments = await this.prisma.workPackageComment.findMany({
      where: { workPackageId, isDeleted: false },
      ...
```
- Impact: Same IDOR pattern as above — `projectId` in URL is never validated. Any user can list/create/edit/delete comments on any WP by guessing `wpId`. Author ownership check for update/delete is correct (`if (existing.userId !== userId) return Result.fail('Accès refusé.');`), but: returning `Result.fail('Accès refusé.')` → `BadRequestException` (controller line 33/41) gives 400 instead of 403, and comment-listing has zero check. Note: comment service is NOT in scope of the user's explicit `/pm/projects/:id/work-packages/...` focus but it's under the same module's controller tree.
- Fix: Pass & validate `projectId` → `wpId` → `commentId` chain. Use `ForbiddenException` for unauthorized mutations.

### [LOW] `content` in comments is not length-limited
- File: `wp-comments.service.ts:22-33`
- Category: validation
- Evidence:
```ts
async create(workPackageId: string, userId: string, content: string) {
  try {
    if (!content.trim()) return Result.fail('Contenu requis.');
    const c = await this.prisma.workPackageComment.create({
      data: { workPackageId, userId, content: content.trim() },
```
- Impact: No upper bound — a user can post megabytes into a comment, bloating the DB and any view that renders the full comment list. Also no HTML sanitization (depends on front-end).
- Fix: Add `@MaxLength(10_000)` on a DTO, reject oversize payloads at the controller.

### [LOW] Activity/automation calls inside `create`/`update` pass raw `dto.status` without normalizing — event listeners may branch on casing
- File: `work-packages.service.ts:227-229` and `286-288`
- Category: logic
- Evidence:
```ts
void this.automation.executeRulesForEvent(projectId, 'work_package_created', {
  workPackageId: wp.id, title: wp.title, type: wp.type, status: wp.status, assigneeId: wp.assigneeId,
});
```
```ts
void this.automation.executeRulesForEvent(projectId, 'work_package_status_changed', {
  workPackageId: id, title: wp.title, fromStatus: existing.status, toStatus: dto.status,
});
```
- Impact: `dto.status` is a free-form string (see DTO `@IsString() status?: string;`). Automation rules compare strings with `equals` / `contains` operators. A typo like `"inprogress"` vs `"InProgress"` silently fails to match a rule. No enum enforcement.
- Fix: Enum-validate at DTO level (`@IsIn(['New','InProgress','Done','Blocked', ...])`) so downstream comparators are reliable.

### [LOW] `create` and `update` do NOT trim `description` and accept arbitrarily long input
- File: `work-packages.service.ts:188-210`, `242-249`
- Category: validation
- Evidence:
```ts
description: dto.description ?? null,
```
- Impact: DB can grow without bound from a single user. DTO has `@IsString()` but no `@MaxLength`. Also no XSS sanitization — Front-end is responsible but defense-in-depth is missing.
- Fix: `@MaxLength(20_000)` on the DTO.

---

## UNCERTAIN

### [UNCERTAIN] `executeRulesForEvent` reentrancy with `work_package_status_changed`
- File: `work-packages.service.ts:286-288`
- Category: logic
- Evidence:
```ts
void this.automation.executeRulesForEvent(projectId, 'work_package_status_changed', {
  workPackageId: id, title: wp.title, fromStatus: existing.status, toStatus: dto.status,
});
```
- Impact: If an automation rule on status-change updates the same WP's status (or assignee), the re-entry into `WorkPackagesService.update()` will trigger another status-change event, potentially looping. Without seeing `AutomationService.executeRulesForEvent`, I can't confirm whether there is a guard. [UNCERTAIN] — did not open `automation.service.ts`.
- Fix: Verify `automation.service.ts` has a recursion guard (event depth counter or trigger flag in context).

### [UNCERTAIN] `notifyEnhanced` contract for `projectId` / `link` with `Viewer`s
- File: `work-packages.service.ts:67-78` and `213-224`
- Category: auth / logic
- Evidence:
```ts
void this.notifications.notifyEnhanced({
  userId,
  ...
  link: `/app/pm/projects/${projectId}/workpackages`,
  ...
});
```
- Impact: If a user subscribed as watcher is a `Viewer` role without `/app/pm/*` access, they still receive the notification with a deep link they can't follow. Not a security issue per se, but UX-wise and possibly an info-disclosure (WP title in the message body). Cannot confirm `notifyEnhanced` enforces role gating. [UNCERTAIN] — did not open `notifications.service.ts`.
- Fix: Check in `notifyEnhanced` that the `userId` has visibility on the project (same access helper missing at the top of this module).

---

## Recommended remediation order

1. (CRITICAL) Build a `ProjectAccessService.assertCanAccessProject(userId, projectId, minRole?)` helper; call it at the start of every service method taking a `projectId`. Add `RolesGuard` + `@Roles(...)` at the controller.
2. (CRITICAL) Thread `projectId` through ALL nested endpoints (`/move`, `/watchers`, `/dependencies`, `/custom-values`) and re-assert WP/target ownership.
3. (CRITICAL) Validate dependency endpoints: same-project, no cycles, ownership on delete.
4. (HIGH) Harden `upsertCustomValues` (array decorators, size cap, per-field project check, transaction).
5. (HIGH) Lock down watcher add/remove to self-only (or PM/Admin + validated team member).
6. (MEDIUM) Cross-project FK validation (sprint/version/column/parent/assignee) in create+update.
7. (MEDIUM) Hard-delete → soft-delete on custom fields; add audit.
8. (LOW) DTO-level `@MaxLength`, `@IsIn`, `@ArrayMaxSize`; integer parsing guards; HTTP status codes (403 vs 400).
9. (UNCERTAIN) Audit `automation.service.ts` and `notifications.service.ts` to verify recursion guard and access checks — outside this module but directly consumed from here.
