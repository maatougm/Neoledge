Files opened:
- C:\Users\BigPoppa\Desktop\neoleadge\web\back-nest\src\projects\projects.service.ts
- C:\Users\BigPoppa\Desktop\neoleadge\web\back-nest\src\projects\projects.controller.ts
- C:\Users\BigPoppa\Desktop\neoleadge\web\back-nest\src\projects\pm.controller.ts
- C:\Users\BigPoppa\Desktop\neoleadge\web\back-nest\src\projects\projects.module.ts
- C:\Users\BigPoppa\Desktop\neoleadge\web\back-nest\src\projects\phase-gate.service.ts
- C:\Users\BigPoppa\Desktop\neoleadge\web\back-nest\src\projects\phase-gate.service.spec.ts
- C:\Users\BigPoppa\Desktop\neoleadge\web\back-nest\src\projects\dto\create-project.dto.ts
- C:\Users\BigPoppa\Desktop\neoleadge\web\back-nest\src\projects\dto\update-project.dto.ts
- C:\Users\BigPoppa\Desktop\neoleadge\web\back-nest\src\projects\dto\assign-manager.dto.ts

# QA — `web/back-nest/src/projects/`

Focus areas audited: soft-delete filtering on every list query, project-scope authorization (PM of A accessing B), phase-validation forgery/replay, concurrent field-value races, `allowManagerCustomFields` bypass, legacy `@Roles()` on new routes, DTOs as classes vs interfaces, multi-step write transactions, N+1 in list endpoints, automation fire-and-forget.

---

### [CRITICAL] PM controller has no project-scope authorization — any PM can access any project
- File: `web/back-nest/src/projects/pm.controller.ts:30-35`
- Category: auth
- Evidence:
```ts
  @Get('projects/:id')
  async getProject(@Param('id') id: string) {
    const result = await this.service.getById(id);
    if (result.isFailure) throw new NotFoundException(result.error);
    return result.value;
  }
```
- Impact: Any authenticated user with a valid JWT (even non-PM, since the controller only applies `JwtAuthGuard` and no role check) can fetch the full detail of any project in the system by its UUID — `getById` performs no `projectManagerId === user.userId` check and no role gate.
- Fix: Inject `@CurrentUser()` and enforce `project.projectManagerId === user.userId || user.role === 'Admin'` (or use `RolesGuard` + a project-scope guard) inside every `/pm/projects/:id/*` handler.

### [CRITICAL] PM `saveFieldValues` has no ownership check — cross-project field overwrite
- File: `web/back-nest/src/projects/pm.controller.ts:37-41`
- Category: auth
- Evidence:
```ts
  @Patch('projects/:id/field-values')
  async saveFieldValues(@Param('id') id: string, @Body() body: { fieldValues: { projectFieldId: string; value: string | null }[] }) {
    const result = await this.service.saveFieldValues(id, body.fieldValues);
    if (result.isFailure) throw new BadRequestException(result.error);
  }
```
- Impact: Any authenticated user can overwrite the questionnaire/field values of any project — `@CurrentUser` is not even used, and the service does no scope check.
- Fix: Require `CurrentUser`, verify `project.projectManagerId === user.userId` (or Admin/assigned team role) before delegating to `saveFieldValues`.

### [CRITICAL] PM `addField` bypasses `allowManagerCustomFields` gate
- File: `web/back-nest/src/projects/pm.controller.ts:43-48` and `projects.service.ts:294-320`
- Category: auth
- Evidence:
```ts
  @Post('projects/:id/fields')
  async addField(@Param('id') id: string, @Body() dto: { label: string; fieldType?: string; isRequired?: boolean; options?: string }) {
    const result = await this.service.addField(id, dto);
```
```ts
  async addField(projectId: string, dto: any) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, isDeleted: false } });
    if (!project) return Result.fail('Projet non trouvé.');
    // ...no check of project.allowManagerCustomFields, no ownership check
```
- Impact: Even when the Admin toggled `allowManagerCustomFields=false`, any authenticated user (PM or otherwise) can add custom fields to any project, defeating the feature flag entirely. No `projectManagerId` scope check either.
- Fix: Require `user.role === 'Admin' || (project.projectManagerId === user.userId && project.allowManagerCustomFields)` before creation.

### [CRITICAL] `submitValidation` trusts client-supplied role from JWT — forged-role approvals possible
- File: `web/back-nest/src/projects/pm.controller.ts:78-91` and `projects.service.ts:430-467`
- Category: auth | validation | logic
- Evidence:
```ts
  async submitValidation(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Body() dto: { isApproved: boolean; comment?: string },
  ) {
    const result = await this.service.submitValidation(id, user.userId, user.role, dto);
```
```ts
    const validation = await this.prisma.projectValidation.create({
      data: {
        projectId,
        validatedByUserId: userId,
        validatedByRole: userRole,       // comes from JWT payload `user.role`
        phase: project.status,
        isApproved: dto.isApproved,
```
- Impact: The role stamped on the validation is the role claim on the JWT. `PhaseGateService.hasRequiredApprovals` selects on `validatedByRole` — so anyone whose JWT role is `SpecificationTeam` or `DeploymentTeam` can self-approve the gate regardless of their relationship to the project. There is no check that the submitter is (a) a member/assignee of the project, (b) not the PM who owns it, (c) not an Admin rubber-stamping their own gate. Combined with no project-scope guard (see above), any authenticated user of the right role class can unlock the gate on any project.
- Fix: Re-fetch the user's role from the DB, verify the user is a legitimate validator for this project (team membership), and block self-approval by the owning PM or submitting admin; optionally require the actor to NOT be the actor who triggered the phase change.

### [CRITICAL] Validation replay possible after status moves on and back — unique index uses current `phase`
- File: `web/back-nest/src/projects/projects.service.ts:434-450`
- Category: logic | data-integrity
- Evidence:
```ts
    const duplicate = await this.prisma.projectValidation.findFirst({
      where: { projectId, validatedByUserId: userId, phase: project.status },
    });
    if (duplicate) return Result.fail('Vous avez déjà soumis une validation pour cette phase.');
```
- Impact: Duplicate guard uses `project.status` read at request time. Because `phase` is derived from the live project status, and the service accepts approvals for whatever the project currently sits on, two classes of abuse exist: (1) Under concurrent requests from the same user, both checks race past the `findFirst` before either `create` lands, producing two rows (the `@@unique([projectId, validatedByUserId, phase])` index will catch the duplicate, but the second request surfaces a 500 not the friendly error). (2) The project's `status` can change between when a user last submitted and when they submit again, so the same user can accumulate one approval per distinct phase, but nothing prevents stale approvals from previous cycles from satisfying a later gate because `hasRequiredApprovals` only filters on `phase` and `isApproved` — there's no `createdAt >= phaseEnteredAt` constraint.
- Fix: Wrap the check + insert in a transaction, catch the P2002 unique-violation explicitly, and require `validatedAt >= project.statusChangedAt` (add column) inside `hasRequiredApprovals`.

### [HIGH] Inline body types in PM controller are interfaces/object types — stripped by global ValidationPipe whitelist
- File: `web/back-nest/src/projects/pm.controller.ts:38,44,82`
- Category: validation
- Evidence:
```ts
  async saveFieldValues(@Param('id') id: string, @Body() body: { fieldValues: { projectFieldId: string; value: string | null }[] }) {
```
```ts
  async addField(@Param('id') id: string, @Body() dto: { label: string; fieldType?: string; isRequired?: boolean; options?: string }) {
```
```ts
    @Body() dto: { isApproved: boolean; comment?: string },
```
- Impact: `main.ts` enables `ValidationPipe({ whitelist: true, transform: true })`. With inline TS object types (no class), Nest's metatype resolves to `Object`, no validator metadata exists, so `whitelist: true` strips every property — yielding `{}` at runtime. CLAUDE.md explicitly calls this out: "DTOs must be classes … interface DTOs are stripped by ValidationPipe". These handlers appear to work only because `whitelist` without `forbidNonWhitelisted` and a plain `Object` metatype does not reach the stripping branch — but the rule still bans this pattern, and any later change to `forbidNonWhitelisted` silently breaks the endpoints. No min/max/type validation runs: `isApproved: "yes"` string, arrays of 50k field values, or 10MB `value` strings are all accepted.
- Fix: Convert each inline body into a proper `class` DTO with `class-validator` decorators (e.g. `SaveFieldValuesDto`, `AddFieldDto`, `SubmitValidationDto`), matching the style of `CreateProjectDto`.

### [HIGH] Admin controller `AddFieldDto` is a local TS `interface` — stripped by ValidationPipe
- File: `web/back-nest/src/projects/projects.controller.ts:16,127-133`
- Category: validation
- Evidence:
```ts
interface JwtUser { userId: string; role: string; }
interface AddFieldDto { label: string; fieldType?: string; isRequired?: boolean; options?: string; }
```
```ts
  @Post(':id/fields')
  @HttpCode(HttpStatus.CREATED)
  async addField(@Param('id') id: string, @Body() dto: AddFieldDto) {
    const result = await this.service.addField(id, dto);
```
- Impact: Same as above — CLAUDE.md rule "DTOs must be classes, not interfaces, when used with `@Body()`". The interface erases to `Object`; no length/type validation on `label`, `fieldType`, or `options`. A caller can send `label: ""` or a 100KB string and it will be persisted.
- Fix: Replace with `class AddFieldDto` and decorators: `@IsString() @IsNotEmpty() @MaxLength(200) label`; `@IsOptional() @IsIn(['Text','Number','Select','Checkbox','Date']) fieldType`; `@IsOptional() @IsBoolean() isRequired`; `@IsOptional() @IsString() @MaxLength(2000) options`.

### [HIGH] Many admin endpoints accept plain `{ ... }` body literals with zero validation
- File: `web/back-nest/src/projects/projects.controller.ts:115,144,151,159,165,171`
- Category: validation
- Evidence:
```ts
  async updateStatus(@Param('id') id: string, @Body() body: { status: string }) {
```
```ts
  async toggleManagerFields(@Param('id') id: string, @Body() body: { allow: boolean }) {
```
```ts
  async duplicate(@Param('id') id: string, @Body() body: { name: string }) {
```
```ts
  async bulkArchive(@Body() body: { projectIds: string[] }) {
```
```ts
  async bulkStatus(@Body() body: { projectIds: string[]; status: string }) {
```
```ts
  async bulkAssignManager(@Body() body: { projectIds: string[]; managerId: string }) {
```
- Impact: No enum validation on `status` — callers can set any string including `Archived` bypassing `archive` semantics, or arbitrary values that break phase-gate logic. No UUID or array-length check on `projectIds` — a 10k-long array is accepted, `updateMany` runs, and every row is archived. No UUID check on `managerId`. No `@MaxLength` on `name` (duplicate project).
- Fix: Define DTOs: `UpdateStatusDto { @IsIn([...STATUS_ORDER,'Archived']) status }`, `ToggleManagerFieldsDto { @IsBoolean() allow }`, `DuplicateProjectDto { @IsString() @IsNotEmpty() @MaxLength(200) name }`, `BulkIdsDto { @ArrayMaxSize(200) @IsUUID('4',{each:true}) projectIds }` + extend for status/manager variants.

### [HIGH] `bulkUpdateStatus` / `bulkArchive` / `bulkAssignManager` ignore soft-delete and phase gates
- File: `web/back-nest/src/projects/projects.service.ts:383-396`
- Category: data-integrity | logic
- Evidence:
```ts
  async bulkArchive(ids: string[]) {
    await this.prisma.project.updateMany({ where: { id: { in: ids } }, data: { status: 'Archived' } });
    return Result.ok();
  }

  async bulkUpdateStatus(ids: string[], status: string) {
    await this.prisma.project.updateMany({ where: { id: { in: ids } }, data: { status } });
    return Result.ok();
  }

  async bulkAssignManager(ids: string[], managerId: string) {
    await this.prisma.project.updateMany({ where: { id: { in: ids } }, data: { projectManagerId: managerId } });
    return Result.ok();
  }
```
- Impact: (1) `updateMany` has no `isDeleted: false` — already-soft-deleted projects get their status clobbered, defeating the soft-delete flow. (2) `bulkUpdateStatus` bypasses `PhaseGateService.canTransition` entirely — any admin can hop from `Draft` straight to `Completed` for N projects at once, or move a backward transition `Completed → Draft` that `updateStatus` would block. (3) `bulkAssignManager` does not verify the target `managerId` actually has `role === 'ProjectManager'` (single-row `assignManager` does). (4) No audit log, no notification, no activity entry — silent mass change. (5) No cardinality cap on `ids` — N×query cost could be weaponized.
- Fix: Add `isDeleted: false` to every bulk `where`; loop (or pre-filter) and call `updateStatus` per id so gates run; validate manager role; emit activity + audit + notification per row; cap to e.g. 100 items.

### [HIGH] `deleteProject` is hard-delete — orphans related rows and bypasses audit
- File: `web/back-nest/src/projects/projects.service.ts:192-197`
- Category: data-integrity
- Evidence:
```ts
  async deleteProject(id: string) {
    const existing = await this.prisma.project.findUnique({ where: { id } });
    if (!existing) return Result.fail('Projet non trouvé.');
    await this.prisma.project.delete({ where: { id } });
    return Result.ok();
  }
```
- Impact: Even though the public controller now wires `softDelete`, this method is still exported on the service. Recent commit `fd31053 fix: soft-delete projects instead of hard-delete` suggests this was the mistake being fixed — leaving the method reachable is a foot-gun for new callers. It also skips the audit log and notification sent by other destructive operations, and any module consuming `ProjectsService` (via the module exports) can invoke it.
- Fix: Remove `deleteProject` (callers now go through `softDelete`) or rename to a private helper that’s only used by `hardDeleteProjectAsync` with admin guard.

### [HIGH] `hardDeleteProjectAsync` has no FK cascade protection and no audit
- File: `web/back-nest/src/projects/projects.service.ts:245-250` + controller `:99-104`
- Category: data-integrity
- Evidence:
```ts
  async hardDeleteProjectAsync(id: string) {
    const existing = await this.prisma.project.findUnique({ where: { id } });
    if (!existing) return Result.fail('Projet non trouvé.');
    await this.prisma.project.delete({ where: { id } });
    return Result.ok();
  }
```
- Impact: Hard delete does not check soft-delete state (can hard-delete an undeleted row bypassing the two-step), emits no audit log, no notification. If cascade rules aren't strict FK delete, the call will throw raw Prisma errors to the client (revealing schema / DB internals). No "are there child WorkPackages?" safety check.
- Fix: Only allow when `isDeleted === true`; wrap delete + related-row cleanup in a `$transaction`; emit audit `PROJECT_HARD_DELETE`.

### [HIGH] `saveFieldValues` has no lost-update protection (concurrent PM + collaboration race)
- File: `web/back-nest/src/projects/projects.service.ts:416-428`
- Category: race | data-integrity
- Evidence:
```ts
  async saveFieldValues(projectId: string, fieldValues: { projectFieldId: string; value: string | null }[]) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, isDeleted: false } });
    if (!project) return Result.fail('Projet non trouvé.');

    for (const fv of fieldValues) {
      await this.prisma.projectFieldValue.upsert({
        where: { projectId_projectFieldId: { projectId, projectFieldId: fv.projectFieldId } },
        update: { value: fv.value },
        create: { projectId, projectFieldId: fv.projectFieldId, value: fv.value },
      });
    }
    return Result.ok();
  }
```
- Impact: (1) N sequential round-trips instead of one `$transaction` — partial writes visible to other clients if the process crashes mid-loop. (2) No `updatedAt`/version check: per CLAUDE.md the schema on `ProjectFieldValue` has `updatedAt, updatedBy added for collaboration tracking`, but this code neither reads nor sets them, so concurrent PMs can silently clobber each other, and the `CollaborationModule` presence/focus signals are informational only. (3) `updatedBy` is never written → audit gap. (4) `fv.value` is not validated against `projectField.fieldType` (e.g. Number field receives free-form text).
- Fix: Wrap in `this.prisma.$transaction`, accept an optional `expectedUpdatedAt` per field and fail if mismatched (optimistic lock), set `updatedBy = userId` and `updatedAt = new Date()`, validate `value` against field type before upsert.

### [HIGH] `create` does 1 + 2N sequential writes, no transaction — aborted seed leaves a half-built project
- File: `web/back-nest/src/projects/projects.service.ts:135-173`
- Category: data-integrity
- Evidence:
```ts
    const project = await this.prisma.project.create({ ... });
    // Seed static fields
    for (const sf of staticFields) {
      const field = await this.prisma.projectField.create({ ... });
      await this.prisma.projectFieldValue.create({ ... });
    }
```
- Impact: 13 sequential network round-trips. If the process dies after `project.create` but before the fields land, the project exists with zero fields and the PM cannot fill the questionnaire. Likewise for `duplicate` (`projects.service.ts:339-381`). Violates CLAUDE.md rule "multi-step-write transactions".
- Fix: Use `this.prisma.$transaction(async (tx) => { ... })` so project + fields + initial values are atomic. Use `tx.projectField.createMany` and `tx.projectFieldValue.createMany` when possible to reduce round-trips.

### [HIGH] `addField` does a check-then-write race on `orderIndex`
- File: `web/back-nest/src/projects/projects.service.ts:294-320`
- Category: race | data-integrity
- Evidence:
```ts
    const maxOrder = await this.prisma.projectField.aggregate({
      where: { projectId },
      _max: { orderIndex: true },
    });

    const field = await this.prisma.projectField.create({
      data: {
        ...
        orderIndex: (maxOrder._max.orderIndex ?? 0) + 1,
      },
    });
```
- Impact: Two concurrent `addField` calls read the same `_max.orderIndex` and both write `max+1`, producing duplicate `orderIndex` values. The UI order becomes non-deterministic.
- Fix: Add a uniqueness constraint on `(projectId, orderIndex)` and retry on P2002, or compute order inside a transaction using `SELECT ... FOR UPDATE`, or switch to sortable double/string ordering (lexorank).

### [HIGH] `removeField` does not cascade `WorkPackageCustomValue` / history rows tied to the field
- File: `web/back-nest/src/projects/projects.service.ts:322-330`
- Category: data-integrity
- Evidence:
```ts
  async removeField(projectId: string, fieldId: string) {
    const field = await this.prisma.projectField.findFirst({ where: { id: fieldId, projectId } });
    if (!field) return Result.fail('Champ non trouvé.');
    if (field.fieldCategory === 'Static') return Result.fail('Les champs statiques ne peuvent pas être supprimés.');

    await this.prisma.projectFieldValue.deleteMany({ where: { projectFieldId: fieldId } });
    await this.prisma.projectField.delete({ where: { id: fieldId } });
    return Result.ok();
  }
```
- Impact: Two statements, not in a transaction — partial delete possible. Also no audit, no activity log entry. If a dependent row exists (FK) the second delete throws Prisma code leaked to HTTP 400.
- Fix: Wrap in `$transaction`, emit `logActivity` + `audit.log`, add user param (currently not tracked).

### [HIGH] `assignManager` on a soft-deleted target manager or inactive user silently succeeds
- File: `web/back-nest/src/projects/projects.service.ts:252-274`
- Category: validation
- Evidence:
```ts
    const manager = await this.prisma.appUser.findUnique({ where: { id: managerId } });
    if (!manager || manager.role !== 'ProjectManager') {
      return Result.fail('L\'utilisateur sélectionné n\'est pas un chef de projet.');
    }
```
- Impact: No `isActive` check — a deactivated PM can still be assigned, receive a notification, and show up as project manager in `toSummary`. Admin bulk flow in `bulkAssignManager` does none of these checks at all (see above).
- Fix: Add `manager.isActive === true` to the precondition.

### [HIGH] `getByStatus` returns every project for any status string — no pagination, no soft-delete check on take, no auth scope
- File: `web/back-nest/src/projects/projects.service.ts:127-133` + controller `:64-68`
- Category: logic | error-handling
- Evidence:
```ts
  async getByStatus(status: string) {
    const projects = await this.prisma.project.findMany({
      where: { status, isDeleted: false },
      include: { projectManager: { select: { id: true, firstName: true, lastName: true, email: true } } },
    });
    return Result.ok(projects.map((p) => this.toSummary(p)));
  }
```
- Impact: No `take` cap — a status with 50k projects returns everything in one response. No ordering → non-deterministic pagination if later added. `status` is an arbitrary string (not validated), so typos return empty result with no error.
- Fix: Add pagination (`skip/take` clamp), validate `status` against `STATUS_ORDER ∪ {'Archived'}`, add `orderBy: { createdAt: 'desc' }`.

### [HIGH] `getDeletedProjectsAsync` has no pagination and no ordering guarantee under large deletions
- File: `web/back-nest/src/projects/projects.service.ts:209-233`
- Category: logic
- Evidence:
```ts
    const deleted = await this.prisma.project.findMany({
      where: { isDeleted: true },
      include: { ... },
      orderBy: { deletedAt: 'desc' },
    });
```
- Impact: Unbounded list. With thousands of deleted projects, this payload dominates response time / memory. No search/filter either.
- Fix: Add `skip`/`take` with clamp (e.g. 50/200), optional search param.

### [HIGH] Notification fan-out in `PmController.sendValidationNotifications` runs serially — O(admins) round-trips
- File: `web/back-nest/src/projects/pm.controller.ts:93-126`
- Category: logic
- Evidence:
```ts
    for (const admin of admins) {
      if (admin.id !== submitterId) {
        await this.notifications.notify(admin.id, type, title, message, projectId);
      }
    }
```
- Impact: Each `notify` is awaited sequentially — for N admins the PATCH call blocks N×notify-latency. Also no soft-delete check on `project` (`findFirst({ where: { id } })` without `isDeleted: false`), so validations can be submitted on a soft-deleted project via the service (compounded with the lack of project-scope check).
- Fix: `await Promise.all(admins.filter(...).map(a => notifications.notify(...)))` or batch-insert; add `isDeleted: false` to the project lookup.

### [MEDIUM] `create` date validation permits `endDate === startDate` via string-equality only
- File: `web/back-nest/src/projects/projects.service.ts:136-138`
- Category: validation
- Evidence:
```ts
    if (new Date(dto.endDate) <= new Date(dto.startDate)) {
      return Result.fail('La date de fin doit être postérieure à la date de début.');
    }
```
- Impact: Good on range, but `update` (line 175-190) does NOT re-validate that new `startDate`/`endDate` still satisfy `endDate > startDate` — admin can PATCH a `startDate` later than existing `endDate`. Also neither endpoint validates that the project's start/end dates remain inside any milestone, sprint, or version window — a broader invariant issue.
- Fix: Duplicate the check into `update` with merge semantics (use existing value when field not supplied).

### [MEDIUM] `toSummary` / `toDetail` are `(p: any)` — loses all type safety, hides drift when Prisma schema changes
- File: `web/back-nest/src/projects/projects.service.ts:495-530`
- Category: validation
- Evidence:
```ts
  private toSummary(p: any) {
```
- Impact: Any schema rename (e.g. `clientName` → `customerName`) compiles fine and silently produces `undefined` in the response. CLAUDE.md / TS rules forbid `any` in application code.
- Fix: Define `ProjectSummary` / `ProjectDetail` types, accept `Prisma.ProjectGetPayload<{ include: ... }>` for input, and return the typed summary.

### [MEDIUM] `findWithFilters` ignores `criteria.priority`, `criteria.tags`
- File: `web/back-nest/src/projects/projects.service.ts:19-73`
- Category: logic
- Evidence:
```ts
    criteria: {
      status?: string[];
      priority?: string[];
      assignedToMe?: boolean;
      tags?: string[];
      search?: string;
      dateRange?: { from?: string; to?: string };
```
- Impact: Client can send `priority` and `tags` arrays — they type-check but the service never adds them to `where`, so the filter is silently ignored. Users get unfiltered results thinking they applied filters.
- Fix: Either delete the fields from the contract or translate them to `where` (e.g. `where.priority = { in: criteria.priority }` and a `where.tags = { hasSome: ... }` equivalent).

### [MEDIUM] `findWithFilters` — `assignedToMe: false` not distinguishable from unset
- File: `web/back-nest/src/projects/projects.service.ts:40-42`
- Category: logic
- Evidence:
```ts
    if (criteria.assignedToMe === true) {
      where.projectManagerId = userId;
    }
```
- Impact: No branch for `assignedToMe === false` → caller who explicitly wants "not assigned to me" gets everything instead.
- Fix: Add `else if (criteria.assignedToMe === false) { where.NOT = { projectManagerId: userId } }`.

### [MEDIUM] `findWithFilters` uses `contains` without `mode: 'insensitive'` — MySQL dialect ambiguity + no index
- File: `web/back-nest/src/projects/projects.service.ts:44-49, 78-82`
- Category: logic | perf
- Evidence:
```ts
    if (criteria.search) {
      where.OR = [
        { name: { contains: criteria.search } },
        { clientName: { contains: criteria.search } },
      ];
    }
```
- Impact: Case-sensitivity depends on the column collation. On a `utf8mb4_bin` column the search becomes case-sensitive; on `utf8mb4_general_ci` it's case-insensitive but silently. `contains` degenerates to `LIKE '%...%'` which cannot use a B-tree index — O(n) scan per query.
- Fix: Pick one collation, document it; for large tables add a full-text index and switch to `AND MATCH(...) AGAINST(...)` via raw query.

### [MEDIUM] `getById` returns the project manager's `mustChangePassword` flag in the response payload
- File: `web/back-nest/src/projects/projects.service.ts:105-116`
- Category: security
- Evidence:
```ts
        projectManager: { select: { id: true, firstName: true, lastName: true, email: true, role: true, isActive: true, mustChangePassword: true, createdAt: true, lastLoginAt: true } },
```
- Impact: Leaks sensitive operational metadata (`mustChangePassword`, `lastLoginAt`, `isActive`) about another user to anyone who can read the project. Any PM, team member, or (given the CRITICAL findings) any authenticated user can learn that user X's password is in a reset state and they've never logged in, enabling targeted phishing.
- Fix: Strip to `{ id, firstName, lastName, email, role }`; keep the wide select for an admin-only detail endpoint.

### [MEDIUM] Legacy `@Roles('Admin')` on `Controller('admin/project')` uses singular `project` — inconsistent with CLAUDE.md (`/admin/projects`) and other modules
- File: `web/back-nest/src/projects/projects.controller.ts:18`
- Category: logic
- Evidence:
```ts
@Controller('admin/project')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Admin')
export class ProjectsController {
```
- Impact: CLAUDE.md lists the Admin routes as `/admin/projects` and `/admin/projects/:id/portal-tokens`. The controller is `/admin/project` (singular) which contradicts the documented contract — either the docs are wrong or the frontend is sending to the wrong base path. Possible double-routing via a prefix alias would double the attack surface.
- Fix: Confirm the expected path (`admin/projects` matches the doc) and correct the controller prefix, adjusting frontend axios base.

### [MEDIUM] `updateStatus` fire-and-forget `automation.executeRulesForEvent` — swallows failures
- File: `web/back-nest/src/projects/projects.service.ts:286`
- Category: error-handling
- Evidence:
```ts
    void this.automation.executeRulesForEvent(projectId, 'status_changed', { newStatus: status, oldStatus: project.status });
```
- Impact: If the automation engine throws, the rejection is attached to an unhandled promise (Nest may or may not catch it depending on Node version). No retry queue. The per-CLAUDE.md pattern says fire-and-forget must use `.catch((e) => logger.error(...))`. Same issue in `submitValidation` (`:452`) and `audit.log` calls (`:171, :263, :285`).
- Fix: `.catch((e) => this.logger.error('automation failed', e))` on every `void ...` call.

### [MEDIUM] `archive` routes through `updateStatus('Archived')` — phase-gate allows it from any status (intended) but the controller exposes it to anyone who can hit `:id/archive` via PATCH with no `Roles` override; BUT it also bypasses `@Roles('Admin')` inheritance — confirm
- File: `web/back-nest/src/projects/projects.controller.ts:120-125`
- Category: auth
- Evidence:
```ts
  @Patch(':id/archive')
  @HttpCode(HttpStatus.NO_CONTENT)
  async archive(@Param('id') id: string) {
    const result = await this.service.archive(id);
```
- Impact: `[UNCERTAIN]` — the class-level `@Roles('Admin')` at line 20 should apply; I could not open `roles.decorator.ts`/`roles.guard.ts` to confirm they merge class+method metadata. If the decorator at the method level replaces the class-level metadata in the `RolesGuard` reflection, any authenticated user could call archive. Recommend verifying by reading `common/decorators/roles.decorator.ts` and `common/guards/roles.guard.ts`.
- Fix: Verify guard uses `Reflector.getAllAndMerge` (class + method); add an explicit `@Roles('Admin')` to each method where paranoia matters.

### [MEDIUM] `PmController` has no `RolesGuard` — any active user can hit PM routes
- File: `web/back-nest/src/projects/pm.controller.ts:14-16`
- Category: auth
- Evidence:
```ts
@Controller('pm')
@UseGuards(JwtAuthGuard)
export class PmController {
```
- Impact: Only `JwtAuthGuard` → `Viewer`, `RealizationTeam`, `SpecificationTeam`, `DeploymentTeam`, or even a freshly seeded `Admin` user can hit `/pm/projects/:id/*` and `/pm/projects/:id/field-values`. Combined with the missing project-scope check (CRITICAL above), this is a wide surface. `getTeamProjects` intentionally returns all active projects, which may be fine, but `saveFieldValues` / `addField` / `submitValidation` need role+scope gates.
- Fix: Add `RolesGuard` + `@Roles('ProjectManager','Admin','SpecificationTeam','RealizationTeam','DeploymentTeam')` class-level, then per-method tightening for write endpoints.

### [MEDIUM] `logActivity` writes with `userId: null` on status change and manager assignment — audit gap
- File: `web/back-nest/src/projects/projects.service.ts:262, 284, 489-493`
- Category: error-handling | security
- Evidence:
```ts
    await this.logActivity(projectId, null, 'assign_manager', ...);
```
```ts
    await this.logActivity(projectId, null, 'status_change', ...);
```
- Impact: The identity of the admin who changed status or assigned a manager is lost in `ProjectActivity` (only `audit.log` has the actor if provided). Activity feeds will show anonymous "Statut changé" entries.
- Fix: Pass the calling admin's `userId` through (`updateStatus(id, status, actorId)`, `assignManager(id, managerId, actorId)`), route it from controllers.

### [MEDIUM] `getActivity` hard-codes `take: 50` with no pagination contract
- File: `web/back-nest/src/projects/projects.service.ts:398-414`
- Category: logic
- Evidence:
```ts
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
```
- Impact: UI can only ever see the latest 50 actions. No `skip` / cursor / total — older history is silently truncated.
- Fix: Accept `skip`/`take` (clamped), return `{ items, total }`.

### [LOW] `getProjectsPaged` type-coerces `+skip` / `+take` → NaN on bad input
- File: `web/back-nest/src/projects/projects.controller.ts:26-33`
- Category: validation
- Evidence:
```ts
    @Query('skip') skip = '0',
    @Query('take') take = '50',
    ...
    const result = await this.service.getProjectsPaged(+skip, +take, search, status);
```
- Impact: `?skip=abc` → `NaN`, `Math.max(NaN, 1)` → `NaN`, `Math.min(NaN, 100)` → `NaN` → Prisma error leaks through. The clamp in the service only protects the upper bound.
- Fix: Parse with `Number.isFinite` guard, default to 0/50 on invalid; or define a `PaginationDto` with `@Type(() => Number) @IsInt() @Min(0)`.

### [LOW] `duplicate` does not copy `projectManagerId` — silent feature vs bug
- File: `web/back-nest/src/projects/projects.service.ts:339-381`
- Category: logic
- Evidence:
```ts
    const dup = await this.prisma.project.create({
      data: {
        name: newName,
        clientName: source.clientName,
        startDate: source.startDate,
        endDate: source.endDate,
        createdByAdminId: source.createdByAdminId,
        status: 'Draft',
      },
    });
```
- Impact: New project has no PM. Sensible default, but not documented; also `createdByAdminId` copies the SOURCE project's admin rather than the admin who called duplicate — audit trail is misleading.
- Fix: Take `adminId: string` parameter, set `createdByAdminId: adminId`, expose an optional `projectManagerId` in the duplicate DTO.

### [LOW] N+1 in `create` and `duplicate` field-seeding loops
- File: `web/back-nest/src/projects/projects.service.ts:161-168, 357-378`
- Category: logic (perf)
- Evidence: see transaction finding above.
- Impact: Each project creation is 13 queries; duplicating a large-custom-field project is `2N+1`. Acceptable for today's N but should be batched.
- Fix: `createMany` for fields, then a single `createMany` for values (requires two queries).

### [LOW] `assignManager` logs activity with `userId: null` even though a caller is known
- File: `web/back-nest/src/projects/projects.service.ts:262`
- Category: error-handling
- Evidence:
```ts
    await this.logActivity(projectId, null, 'assign_manager', `Chef de projet assigné: ${manager.firstName} ${manager.lastName}`);
```
- Impact: Same as MEDIUM audit-gap finding, restated.
- Fix: Thread `actorId` from the controller.

### [LOW] `getByManager` returns any manager's projects if requested by ID — `managerId` param is not compared to requester
- File: `web/back-nest/src/projects/projects.controller.ts:58-62`
- Category: auth
- Evidence:
```ts
  @Get('manager/:managerId')
  async getByManager(@Param('managerId') managerId: string) {
    const result = await this.service.getByManager(managerId);
    return result.value;
  }
```
- Impact: Inside the admin controller, this is acceptable (Admin-only via class-level `@Roles('Admin')`), but if the `@Roles` inheritance concern in the archive finding is real, this endpoint also leaks another PM's full project portfolio.
- Fix: Confirm role inheritance; otherwise add explicit method-level `@Roles('Admin')`.

### [LOW] `submitValidation` does not restrict `dto.comment` length → unbounded text write
- File: `web/back-nest/src/projects/projects.service.ts:430-450`
- Category: validation
- Evidence:
```ts
    @Body() dto: { isApproved: boolean; comment?: string },
```
- Impact: No max length on `comment` — 1MB string persisted, pagination-view payloads bloat.
- Fix: Class DTO with `@IsOptional() @IsString() @MaxLength(2000)`.

### [UNCERTAIN] `submitValidation` does not assert `project.status === validation.phase` when phase is derived from status anyway
- File: `web/back-nest/src/projects/projects.service.ts:439-448`
- Category: logic
- Evidence:
```ts
        phase: project.status,
```
- Impact: The `project.status` read at the top of the function is used both for the duplicate lookup and the new row's phase. Under a concurrent admin `updateStatus` call, a PM's validation can land with a stale phase — accepted into the old phase, but the project already sits on the next one. Whether that's a security issue or a feature depends on product intent.
- Fix: Wrap the read + insert in a `serializable` transaction, or pass the expected phase from the client and reject on mismatch.

---

## Summary
- 5 CRITICAL: PM project-scope missing (4 handlers), PM validation role forgery, validation replay race.
- 11 HIGH: inline/interface DTOs (2), bulk mutations skip soft-delete + phase gate, unprotected saveFieldValues + addField, sequential notify, unbounded lists, orderIndex race, removeField non-atomic, hardDelete/hardDeleteProjectAsync unaudited, assignManager misses `isActive`.
- 10 MEDIUM: typing (`any`), lost filters, missing auth on `PmController`, legacy route prefix, fire-and-forget error swallow, ambiguous case-insensitivity, audit-gap on activity log, pagination gaps on activity/byStatus/deleted, leaked user metadata, role-guard inheritance uncertainty.
- 6 LOW: pagination coercion, duplicate ownership, N+1, actor logging, route-role leak, comment length.
- 1 UNCERTAIN: phase-read race in submitValidation.

Highest-leverage fixes in order: (1) add project-scope guard (class mixin or interceptor) to every `/pm/projects/:id/*` handler; (2) move all inline `@Body()` objects to class DTOs and confirm `ValidationPipe` options match CLAUDE.md; (3) wrap `create`, `duplicate`, `saveFieldValues`, and `removeField` in `$transaction` and route bulk endpoints through `updateStatus` so phase gates and soft-delete apply; (4) re-fetch the actor's role from DB inside `submitValidation` and block self-approval; (5) remove or privatize `deleteProject`.
