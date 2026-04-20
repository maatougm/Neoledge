# Phase 9 Fix Pass — Projects Module

Build status: **GREEN** (`npm run build` exits 0, no type errors)

---

## Changes Applied

### Already in place — verified, skipped

| Item | Verification |
|------|-------------|
| Project-scope auth (`ProjectAccessGuard`) on `PmController` | `pm.controller.ts:17` — `@UseGuards(JwtAuthGuard, ProjectAccessGuard)` + `@ProjectAccess('id')` on every project-scoped handler |
| `currentPhaseEnteredAt` on `Project` model | `prisma/schema.prisma:156` — `currentPhaseEnteredAt DateTime?` present |
| Phase-gate replay guard using `currentPhaseEnteredAt` | `phase-gate.service.ts:143-155` — `validatedAt: { gt: phaseEnteredAt }` filter in `hasRequiredApprovals` |
| `submitValidation` derives role from DB via `resolveValidatorRole` | `projects.service.ts:671-689` — queries `UserRoleAssignment` scoped → global → `AppUser.role`; JWT claim discarded |
| `bulkArchive/bulkUpdateStatus/bulkAssignManager` — soft-delete filter + BULK_MAX cap + phase-gate via per-row methods | `projects.service.ts:503-578` |
| `deleteProject` — no hard-delete leak; only `softDelete` and guarded `hardDeleteProjectAsync` on service | Confirmed |
| `saveFieldValues` — `$transaction` + `updatedBy` set | `projects.service.ts:622-659` |
| `create` / `addField` / `duplicate` — `$transaction` | `projects.service.ts:180, 401, 461` |
| `addField` — orderIndex computed inside transaction | `projects.service.ts:401-424` |
| `removeField` — `$transaction` with cascade of `projectFieldValue` + `workPackageCustomValue` | `projects.service.ts:429-445` |
| `assignManager` — rejects `isActive === false` | `projects.service.ts:349-351` |
| `getByStatus` pagination | `projects.service.ts:138-160` — `skip/take` + clamped |
| `getDeletedProjectsAsync` pagination | `projects.service.ts:252-295` — `skip/take` + clamped |
| DTO classes for `SaveFieldValuesDto`, `AddFieldDto`, `SubmitValidationDto`, `UpdateStatusDto`, `ToggleManagerFieldsDto`, `DuplicateProjectDto`, `BulkIdsDto/BulkStatusDto/BulkAssignManagerDto` | `src/projects/dto/` — all present as proper classes with class-validator decorators |

---

### Changes made in this pass

#### 1. `pm.controller.ts` — Replace inline body types with class DTOs

**File:** `web/back-nest/src/projects/pm.controller.ts`

- Added imports for `SaveFieldValuesDto`, `AddFieldDto`, `SubmitValidationDto` at top of file.
- `saveFieldValues` handler: `@Body() body: { fieldValues: ... }[]` → `@Body() body: SaveFieldValuesDto`. Now `ValidationPipe` enforces `@IsUUID`, `@MaxLength(10000)` on each field item.
- `addField` handler: `@Body() dto: { label: string; fieldType?: string; ... }` → `@Body() dto: AddFieldDto`. Now enforces `@IsNotEmpty`, `@MaxLength(200)` on label, `@IsIn(FIELD_TYPES)` on fieldType.
- `submitValidation` handler: `@Body() dto: { isApproved: boolean; comment?: string }` → `@Body() dto: SubmitValidationDto`. Now enforces `@IsBoolean` and `@MaxLength(2000)` on comment.

#### 2. `pm.controller.ts` — `sendValidationNotifications` — parallel fan-out + soft-delete guard

**File:** `web/back-nest/src/projects/pm.controller.ts:108-151`

- Added `isDeleted: false` to the project lookup so validations on soft-deleted projects do not trigger notifications.
- Replaced serial `for (const admin of admins) { await notify(...) }` with `Promise.all(notifyTargets)` — all notification creates fire in parallel, eliminating O(admins) sequential latency from the PATCH response time.

#### 3. `projects.controller.ts` — Replace local `interface AddFieldDto` + inline body types with class DTOs

**File:** `web/back-nest/src/projects/projects.controller.ts`

- Removed local `interface AddFieldDto` (line 16 in original). All DTO types now imported from `src/projects/dto/`.
- Added imports: `AddFieldDto`, `UpdateStatusDto`, `ToggleManagerFieldsDto`, `DuplicateProjectDto`, `BulkIdsDto`, `BulkStatusDto`, `BulkAssignManagerDto`.
- `updateStatus` handler: `body: { status: string }` → `body: UpdateStatusDto` (validated `@IsIn(PROJECT_STATUSES)`).
- `toggleManagerFields` handler: `body: { allow: boolean }` → `body: ToggleManagerFieldsDto` (validated `@IsBoolean()`).
- `duplicate` handler: `body: { name: string }` → `body: DuplicateProjectDto` (validated `@IsNotEmpty`, `@MaxLength(200)`).
- `bulkArchive` handler: `body: { projectIds: string[] }` → `body: BulkIdsDto` (validated `@IsUUID`, `@ArrayMaxSize(BULK_MAX)`).
- `bulkStatus` handler: `body: { projectIds: string[]; status: string }` → `body: BulkStatusDto`.
- `bulkAssignManager` handler: `body: { projectIds: string[]; managerId: string }` → `body: BulkAssignManagerDto`.

#### 4. `projects.controller.ts` — Thread `actorId` through admin-mutating endpoints

**File:** `web/back-nest/src/projects/projects.controller.ts`

- `updateStatus`, `archive`, `assignManager`, `hardDelete`, `bulkArchive`, `bulkStatus`, `bulkAssignManager` — added `@CurrentUser() user: JwtUser` parameter and passed `user.userId` as `actorId` to each service call. Activity log entries and audit log now record the admin who triggered the change instead of `null`.

#### 5. `projects.service.ts` — Strip sensitive PM fields from `getById`

**File:** `web/back-nest/src/projects/projects.service.ts:120`

- Removed `isActive`, `mustChangePassword`, `createdAt`, `lastLoginAt` from the `projectManager` select in `getById`. The detail payload now only includes `{ id, firstName, lastName, email, role }` — fields that any project stakeholder legitimately needs.

---

## Items Not Fixed (out of scope / deferred)

| QA Finding | Reason deferred |
|-----------|----------------|
| `@Controller('admin/project')` singular prefix | Frontend-facing route change; left for a dedicated migration PR to avoid breaking the running app. |
| `toSummary(p: any)` / `toDetail(p: any)` type safety | Medium refactor; no security impact; deferred to separate typing pass. |
| `findWithFilters` ignores `priority` / `tags` filters | MEDIUM logic gap; deferred — requires schema clarification on `priority`/`tags` columns. |
| `assignedToMe === false` branch | MEDIUM logic; deferred. |
| Case-insensitive `contains` / full-text index | MEDIUM perf; requires DB migration; deferred. |
| `getActivity` hard-coded take-50 cursor pagination | MEDIUM; service already accepts skip/take params; controller not yet exposed — deferred. |
| Validation P2002 race on `submitValidation` | Serializable-transaction fix; deferred — requires DB-level isolation change, not a controller patch. |
| `getProjectsPaged` NaN coercion on bad query params | LOW; `+skip`/`+take` coercion; deferred. |
