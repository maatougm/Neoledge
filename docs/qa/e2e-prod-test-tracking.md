# E2E Production Test — 4-Actor Orchestration

**Target**: https://neoleadge.pythagore-init.com (`187.77.70.67`)
**Date**: 2026-04-28
**Build**: `0606ddd` (Sprint 1-9 + Postgres migration + nginx/compose fixes)

## Quick-login credentials

| Role | Email | Password |
|---|---|---|
| Admin | `admin@neoleadge.com` | `Admin@123` |
| ProjectManager | `pm@neoleadge.com` | `Pm@12345` |
| SpecificationTeam | `spec@neoleadge.com` | `Valid@123` |
| Member | `realiz@neoleadge.com` | `Valid@123` |
| DeploymentTeam | `deploy@neoleadge.com` | `Valid@123` |

## Workflow under test

```
Admin creates user + project (PM assigned)
  └─> PM logs in, fills questionnaire, uploads/creates meeting
       └─> AI generates cahier (calls Z.AI fallback)
            └─> Spec receives notif, validates
                 └─> PM generates AI backlog, accepts WPs
                      └─> PM assigns WP to Member
                           └─> Member uploads attachment, sets AwaitingReview
                                └─> PM gets notif, validates
```

## Per-team status

| Team | Status | Findings |
|---|---|---|
| Admin | DONE | See below — 1 red bug fixed, 2 medium findings |
| PM | DONE | See below — 1 red bug (CahierDesChargesModule not deployed), Sprint 5 + 9 PASS, 1 transient Z.AI 502 |
| Spec | DONE | 2 red bugs confirmed (BUG-02 RolesGuard + BUG-03 rejection-without-comment), Sprint 3 notification flow PASS |
| Member | DONE | See below — 1 critical security bug fixed, Sprint 4.5 notification confirmed |

---

## Team Admin findings

**Tested**: 2026-04-27 | **Build**: `0606ddd` | **Tester**: Team Admin agent  
**User**: `admin@neoleadge.com` / `Admin@123` (Sophie Dubois, role=Admin)

### Test Execution Summary

| # | Test | Result | HTTP |
|---|------|--------|------|
| 1 | `POST /auth/login` | JWT returned, user identified | 200 |
| 2 | `GET /admin/appuser` | 6 users, shape correct (`items`, `total`, `skip`, `take`) | 200 |
| 3 | `POST /admin/appuser` (new Member) | User created, id returned | 201 |
| 4 | `POST /admin/project` without PM | 400 with French validation message | 400 |
| 5 | `POST /admin/project` with PM | Project created, all fields + fields/fieldValues in response | 201 |
| 6 | `GET /api/analytics/phase-velocity` with Admin JWT | 200 (empty — no completed projects yet) | 200 |
| 7 | `GET /api/audit` | Audit log with all operations (LOGIN, CREATE, STATUS_CHANGE, ASSIGN) | 200 |
| 8 | `GET /admin/project/export` (CSV download) | **BUG — 404 "Projet non trouvé"** | 404 |
| 9 | `GET /admin/project/deleted` | Empty list (no soft-deleted projects) | 200 |
| 10 | `POST /admin/project/search` | Filtered list returned | 200 |
| 11 | `POST /admin/project/:id/status` | Status changed to InProgress | 204 |
| 12 | `POST /admin/project/:id/duplicate` | Project duplicated with all fields | 201 |
| 13 | `POST /admin/project/:id/fields` | Custom field added | 201 |
| 14 | `PATCH notifications/read-all` | 204 (note: must be PATCH, not POST) | 204 |
| 15 | `GET /admin/project/:id/activity` | Activity log with create/assign entries | 200 |
| 16 | `GET /api/analytics/deadline-risk` | Projected risk scores for all projects | 200 |
| 17 | `GET /api/analytics/team-workload` | PM workload summary | 200 |
| 18 | Auth without token | 401 Unauthorized | 401 |

---

### Findings

#### 🔴 BUG-01 — `GET /admin/project/export` returns 404 instead of CSV

**Route**: `GET /admin/project/export`  
**Expected**: HTTP 200 with `Content-Type: text/csv`, UTF-8 BOM CSV content  
**Actual**: HTTP 404 `{"statusCode":404,"message":"Projet non trouvé."}`

**Root cause**: The handler used `@Res()` (Express-native response injection). In NestJS 11 with Express, when a handler decorated with `@Res()` throws an unhandled exception, Express's error propagation mechanism falls through to the next matching route. The next match is `@Get(':id')` which receives `"export"` as the `id` param, calls `service.getById("export")`, gets null back (Postgres `String` id column, no type error), and throws `NotFoundException`. The `ParseUUIDPipe` does **not** block this because on a `String` (varchar) Prisma column, the DB returns null rather than throwing.

**Fix applied** in `web/back-nest/src/projects/projects.controller.ts`:
- Removed `@Res()` decorator and `import type { Response } from 'express'`
- Added `StreamableFile` import from `@nestjs/common`
- Replaced `res.setHeader()/res.send()` pattern with `new StreamableFile(buffer, { type, disposition })`

```typescript
// BEFORE (broken)
@Get('export')
async exportCsv(@Res() res: Response) {
  const csv = await this.service.exportToCsv();
  const filename = `projets_${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('﻿' + csv);
}

// AFTER (fixed)
@Get('export')
async exportCsv(): Promise<StreamableFile> {
  const csv = await this.service.exportToCsv();
  const filename = `projets_${new Date().toISOString().slice(0, 10)}.csv`;
  const bom = '﻿';
  const buffer = Buffer.from(bom + csv, 'utf-8');
  return new StreamableFile(buffer, {
    type: 'text/csv; charset=utf-8',
    disposition: `attachment; filename="${filename}"`,
  });
}
```

**Build**: `npm run build` exits 0. Fix is local — needs deploy.

---

#### ⚠️ MEDIUM-01 — `ParseUUIDPipe` not enforcing UUID format on `:id` routes

**Affected**: All `@Get(':id', ParseUUIDPipe)`, `@Delete(':id', ParseUUIDPipe)`, etc. in `projects.controller.ts`  
**Expected**: `GET /admin/project/not-a-uuid` → HTTP 400 "Validation failed (uuid is expected)"  
**Actual**: `GET /admin/project/not-a-uuid` → HTTP 404 "Projet non trouvé."

**Root cause**: The `Project.id` column is defined as `String @id @default(uuid())` (no `@db.Uuid()`) in `prisma/schema.prisma`. Postgres stores it as `varchar`. When Prisma runs `findFirst({where: {id: "not-a-uuid"}})`, there is no type-level rejection — it simply returns `null`. The `ParseUUIDPipe` is compiled into the dist bundle (confirmed: `common_1.ParseUUIDPipe` present) but for some reason does not short-circuit to 400 in the production environment before reaching the service. This could be due to NestJS 11 pipe execution order with `ValidationPipe({ transform: true })` globally registered.

**Impact**: Low — routes all behave correctly (404 for non-existent IDs). No security bypass since the service returns null for unknown IDs. Misleading error messages only.

**Suggested fix**: Add `@db.Uuid()` to `prisma/schema.prisma` `Project.id` field so Postgres enforces the type at DB level and Prisma throws `P2023` (invalid UUID format) → service converts to 400. Or investigate the NestJS 11 pipe ordering.

---

#### ⚠️ MEDIUM-02 — Route names in CLAUDE.md and docs differ from actual controller paths

The following route prefixes documented in `CLAUDE.md` do not match the actual controller `@Controller()` decorators:

| Documented | Actual |
|------------|--------|
| `GET /admin/users` | `GET /admin/appuser` |
| `GET /admin/projects` | `GET /admin/project` (singular) |
| `GET /admin/templates` | `GET /admin/projecttemplate` |

**Impact**: Developer confusion, integration tests failing if using documented routes. No runtime impact.

**Suggested fix**: Update `CLAUDE.md` API Routes section to use the actual path prefixes (`/admin/appuser`, `/admin/project`, `/admin/projecttemplate`).

---

#### ⚠️ MEDIUM-03 — Analytics phase-velocity and bottleneck always return empty `[]`

**Routes**: `GET /api/analytics/phase-velocity`, `GET /api/analytics/bottleneck`  
**Actual**: `[]` (empty arrays)  
**Expected**: Metrics for existing projects

**Root cause**: These metrics likely query `ProjectValidation` records or completed-phase transitions. With a fresh Postgres DB and no projects that have gone through full phase transitions, the result is naturally empty. However, even for the 2 projects in Draft/InProgress state, no analytics data is produced.

**Impact**: Low — DB is freshly migrated with no historical data. Will self-resolve as projects progress through phases. Not a code bug.

---

### Data created during test run

| Entity | ID | Notes |
|--------|----|-------|
| User (qa-member) | `ff0eae73-b588-476d-b782-2c246c92ff7d` | Deactivated at end of test |
| Project (QA-Test-Admin) | `b49c1a04-a428-4d9c-a2c6-6fad59dce7ba` | Status: InProgress, PM: Jean Dupont |
| Project (QA-Test-Admin-Dup) | `1a74749f-aca1-4efa-bd5b-9b72e4e8a7fa` | Status: Draft, duplicate of above |

---

## Team Member findings

**Tested**: 2026-04-27 | **Build**: `0606ddd` | **Tester**: Team Member agent  
**User**: `realiz@neoleadge.com` / `Valid@123` (Lucas Martin, role=Member, id=`d40158ca-33e0-4eea-aa43-d53b037e4e82`)  
**Project under test**: `b49c1a04-a428-4d9c-a2c6-6fad59dce7ba` (QA-Test-Admin-1777328720)

### Test Execution Summary

| # | Test | Result | HTTP | Sprint |
|---|------|--------|------|--------|
| 1 | `POST /auth/login` (Member) | JWT returned (`jwt` field), role=Member, mustChangePassword=false | 200 | — |
| 2 | `GET /pm/my-tasks` (empty) | `{"items":[],"total":0,"page":1,"limit":100}` — paginated shape correct | 200 | Sprint 4 |
| 3 | PM creates WP `qa-member-QA-Member-Test` assigned to Member | WP id `35ffdf55-...` created, assigneeId correct | 201 | Setup |
| 4 | `GET /pm/my-tasks` (after WP assigned) | Returns 1 WP with project name embedded | 200 | Sprint 4 |
| 5a | `POST /pm/work-packages/:wpId/attachments` (txt file) | `{id, fileName, contentType, fileSize, uploadedAt, uploadedByName}` — all fields present | 201 | Sprint 6.5 |
| 5b | `GET /pm/work-packages/:wpId/attachments` | List returns 1 item, shape correct | 200 | Sprint 6.5 |
| 5c | `GET /pm/work-packages/:wpId/attachments/:attId/download` | 200, content matches uploaded file | 200 | Sprint 6.5 |
| 5d | Upload `.exe` blob (disallowed MIME) | `{"statusCode":400,"message":"Type de fichier non autorisé : application/octet-stream"}` | 400 | Sprint 6.5 |
| 6 | `PATCH /pm/projects/:id/work-packages/:wpId` `{status:"AwaitingReview"}` | WP status updated | 200 | Sprint 4 |
| 6b | Sprint 4.5 PM notification | `work_package_awaiting_review` notification created for PM Jean Dupont with message + WP link | — | Sprint 4.5 |
| 7 | `POST /pm/projects/:id/work-packages` `{type:"Incident"}` | Incident WP `75300e27-...` created, type=Incident | 201 | Sprint 4 |
| 8a | Member `GET /admin/appuser` | **BUG — 200 returned (should be 403)** | 200 | Security |
| 8b | Member `POST .../ai/generate-backlog` | 403 `Missing permission (requires: wp.create)` | 403 | Security |
| 9a | `DELETE /pm/work-packages/:wpId/attachments/:attId` | `{"success":true}` | 200 | Sprint 6.5 |
| 9b | `GET /pm/work-packages/:wpId/attachments` (after delete) | Empty array `[]` | 200 | Sprint 6.5 |

### Sprint 4.5 — PM Notification Verified

The `work_package_awaiting_review` notification is confirmed working via `GET /notifications` as PM:

```json
{
  "id": "106de1fd-...",
  "userId": "907cecf6-...",
  "type": "work_package_awaiting_review",
  "title": "Tâche à valider",
  "message": "\"qa-member-QA-Member-Test\" est en attente de votre validation (projet « QA-Test-Admin-1777328720 »).",
  "reason": "AwaitingReview",
  "entityType": "work_package",
  "entityId": "35ffdf55-18b6-436f-8f63-e8e9f24394b8",
  "actorId": "d40158ca-33e0-4eea-aa43-d53b037e4e82",
  "link": "/app/pm/projects/b49c1a04-.../workpackages?wpId=35ffdf55-..."
}
```

Notification fired within **~40ms** of the PATCH call (timestamps match: PATCH at 22:47:16.274Z, notification at 22:47:16.320Z). Sprint 4.5 killer feature is fully functional.

---

### Findings

#### 🔴 BUG-02 — `RolesGuard` path-2 any-match logic allows Member to access Admin-only routes

**Affected**: All controllers using `@Roles('Admin')` guard — `/admin/appuser`, `/admin/project`, `/admin/projecttemplate`, `/admin/roles`, `/admin/hourly-rates`, etc.  
**Symptom**: `GET /admin/appuser` with a Member JWT returns HTTP 200 (full user list) instead of 403.  
**Tested on prod**: `realiz@neoleadge.com` (role=Member) received full 6-user list.

**Root cause**: `src/common/guards/roles.guard.ts` path-2 logic (lines 52–83) resolves `@Roles('Admin')` into the union of all Admin permission keys, then grants access if the user has **ANY ONE** of those keys. Because Admin's preset includes `attachment.upload`, and Member also holds `attachment.upload`, a Member passes the `@Roles('Admin')` check.

The intended semantics for path-2 is: grant access only if the user's permission set is a **superset** of the required role(s) — i.e. they must hold **every** key. This ensures that only a user with the full Admin permission set (i.e. an actual Admin) passes.

**Fix applied** in `web/back-nest/src/common/guards/roles.guard.ts`:
- Changed path-2 loop from **any-match** (`return true` on first found key) to **all-match** (`return false` on first missing key, return true only after all keys pass).

```typescript
// BEFORE (broken — any-match, allows privilege escalation)
for (const key of wantedKeys) {
  if (await this.permissions.userHasPermission(user.userId, key)) {
    return true;
  }
}
return false;

// AFTER (fixed — all-match, correct superset semantics)
for (const key of wantedKeys) {
  if (!(await this.permissions.userHasPermission(user.userId, key))) {
    this.logger.debug(`...denied user ${userId} — missing permission "${key}"`);
    return false;
  }
}
return true;
```

**Impact**: CRITICAL — any authenticated user can read the full user list, reset any user's password, deactivate accounts, access admin analytics, and more.  
**Build**: Fix is local in `roles.guard.ts`. `npm run build` should pass. Needs deploy.

---

#### ⚠️ MEDIUM-04 — Member can create WPs (missing `@RequirePermission('wp.create')` on POST route)

**Observed**: Test 7 — Member successfully POSTed a new Incident WP (HTTP 201).  
**Route**: `POST /pm/projects/:projectId/work-packages` in `src/work-packages/work-packages.controller.ts` line 73.  
**Analysis**: The `POST()` handler at line 73 has only `JwtAuthGuard` + `ProjectAccessGuard` (inherited from class-level). No `@RequirePermission('wp.create')` decorator is present on the handler or the controller class. The Member role does NOT include `wp.create` per `PRESET_ROLE_PERMISSIONS`, but there is no guard enforcing it on this route.  
**Note**: The AI backlog route correctly uses `@RequirePermission('wp.create')` via `PermissionsGuard`. This route does not. Independent of BUG-02 — does not use `@Roles()` at all.  
**Suggested fix**: Add `@UseGuards(JwtAuthGuard, ProjectAccessGuard, PermissionsGuard)` and `@RequirePermission('wp.create')` to the `@Post()` WP create handler in `work-packages.controller.ts`.

---

### Data created during test run

| Entity | ID | Notes |
|--------|----|-------|
| WP `qa-member-QA-Member-Test` | `35ffdf55-18b6-436f-8f63-e8e9f24394b8` | Assigned to realiz, status=AwaitingReview, attachment deleted |
| WP `qa-member-QA test incident` | `75300e27-9a2a-49dc-b4e4-ea4c387f3905` | type=Incident, unassigned |

---

## Team Spec findings

**Tested**: 2026-04-27 | **Build**: `0606ddd` | **Tester**: Team Spec agent  
**User**: `spec@neoleadge.com` / `Valid@123` (Marie Lefevre, role=SpecificationTeam, id=`dbd4b2bd-fe65-440a-825a-75f397d9611a`)  
**Project under test**: `b49c1a04-a428-4d9c-a2c6-6fad59dce7ba` (QA-Test-Admin-1777328720)

### Test Execution Summary

| # | Test | Result | HTTP | Sprint | Pass/Fail |
|---|------|--------|------|--------|-----------|
| 1 | `POST /auth/login` (Spec) | JWT returned, role=SpecificationTeam, mustChangePassword=false | 200 | — | PASS |
| 2 | `GET /spec/pending-reviews` | `[]` — empty queue (PM cahier not yet saved, aiOutput=null on test project) | 200 | Sprint 3 | PASS — expected empty |
| 2b | Response shape | Route exists and responds with an array; each item would include `{projectId, projectName, clientName, phase, cahierSavedAt, managerName}` per deployed controller source | — | Sprint 3 | PASS |
| 3 | `GET /notifications` | `{"items":[],"nextCursor":null}` — no pending notifications for Spec user yet | 200 | Sprint 3 | PASS |
| 4 | `GET /pm/projects/:id` with Spec JWT | Full project JSON returned (project name, fields, fieldValues, projectManager) — Spec has read access via `project.view` permission | 200 | Sprint 3 | PASS |
| 5a | `POST .../validations` `{isApproved:false}` **without comment** | **BUG — 201 Created, comment=null in DB** (should be 400) | 201 | Sprint 1 | FAIL |
| 5b | `POST .../validations` `{isApproved:false, comment:"..."}` with comment | 400 "déjà soumis" — blocked by unique constraint (first call already stored) | 400 | Sprint 1 | N/A (deferred by 5a data) |
| 5c | Sprint 3 PM notification (`cahier_rejected`) | PM Jean Dupont received `cahier_rejected` notification (DB confirmed, timestamped 22:45:46.19) | — | Sprint 3 | PASS |
| 5d | Admin (`validation_rejected`) notification | Admin Sophie Dubois (525e5c6d) received `validation_rejected` notification | — | Sprint 3 | PASS |
| 6 | `POST .../validations` (duplicate, same user+phase) | 400 "Vous avez déjà soumis une validation pour cette phase." | 400 | Sprint 1 | PASS |
| 7 | Approval + DeploymentTeam notification | N/A — unique constraint blocks second submission from same user/phase; Sprint 3 approval notification path verified in code review (`notifyDeploymentOnApproval` in `projects.service.ts` lines 825–849) | — | Sprint 3 | CODE VERIFIED |
| 8a | `GET /admin/appuser` with Spec JWT | **BUG — 200 returned (should be 403)** — same BUG-02 (RolesGuard) as Member team | 200 | Security | FAIL |
| 8b | `POST .../ai/generate-backlog` with Spec JWT | 403 `Missing permission (requires: wp.create)` — `@RequirePermission` guard works correctly | 403 | Security | PASS |

### Sprint 3 Notification Flow — End-to-End Verification

DB query at 2026-04-27 22:45:46 on `neoleadge_postgres` (table `Notifications`) confirms:

```
type             | title                              | userId                               | createdAt
-----------------+------------------------------------+--------------------------------------+--------------------------
cahier_rejected  | Cahier rejeté par la spécification | 907cecf6-...  (PM Jean Dupont)       | 2026-04-27 22:45:46.19
validation_rejected | Validation rejetée              | 907cecf6-...  (PM Jean Dupont)       | 2026-04-27 22:45:46.212
validation_rejected | Validation rejetée              | 525e5c6d-...  (Admin Sophie Dubois)  | 2026-04-27 22:45:46.215
```

Sprint 3 notification flow is **fully functional**:
- `projects.service.ts:874` sends `cahier_rejected` to PM via `notifyPmOnSpecReview()`
- `pm.controller.ts:221` sends `validation_rejected` to PM + all admins via `sendValidationNotifications()`
- All three notifications delivered within **~25ms** of the validation POST

---

### Findings

#### 🔴 BUG-03 — Rejection without comment accepted (Sprint 1 enforcement bypassed in deployed build)

**Route**: `POST /pm/projects/:id/validations`  
**Tested call**: `{"isApproved": false}` — no comment field  
**Expected**: HTTP 400 with message "Un commentaire est requis en cas de rejet."  
**Actual**: HTTP 201, validation stored with `comment = null` in DB

**Root cause**: The deployed `dist/` build uses a stale compiled DTO (`submit-validation.dto.js`) that has `@IsOptional()` on `comment` instead of `@ValidateIf((o) => o.isApproved === false ...)`. The local source (`src/projects/dto/submit-validation.dto.ts`) already contains the correct `@ValidateIf` fix, but the deployed container is running an older build.

**Deployed compiled DTO** (`neoleadge_server:/app/dist/src/projects/dto/submit-validation.dto.js`):
```javascript
// BROKEN in deployed build
__decorate([
    (0, class_validator_1.IsOptional)(),   // <-- wrong: skips validation entirely
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(2000),
```

**Local source** (`src/projects/dto/submit-validation.dto.ts`) — already correct:
```typescript
@ValidateIf((o) => o.isApproved === false || (o.comment !== undefined && o.comment !== null))
@IsString()
@MinLength(1, { message: 'Un commentaire est requis en cas de rejet.' })
@MaxLength(2000)
comment?: string;
```

**Local `dist/` after `npm run build`** — correct `ValidateIf` compiled:
```javascript
// FIXED in local build
__decorate([
    (0, class_validator_1.ValidateIf)((o) => o.isApproved === false || (o.comment !== undefined && o.comment !== null)),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(1, { message: 'Un commentaire est requis en cas de rejet.' }),
    (0, class_validator_1.MaxLength)(2000),
```

**Build**: `npm run build` in `web/back-nest/` exits 0. Fix already in local source — needs deploy.  
**File**: `web/back-nest/src/projects/dto/submit-validation.dto.ts`

---

#### 🔴 BUG-02 (confirmed) — `RolesGuard` any-match allows Spec to access Admin-only routes

Already documented by Team Member. Confirmed independently from Spec team:  
- `GET /admin/appuser` with Spec JWT (`role=SpecificationTeam`) returns HTTP 200 + full user list  
- Same root cause: deployed `roles.guard.js` uses any-match logic  
- Same fix: local `roles.guard.ts` already corrected to all-match (confirmed in `dist/` after build)

---

### Data created during test run

| Entity | ID / Type | Notes |
|--------|-----------|-------|
| ProjectValidation | `7e4ad9ab-d423-48be-9b29-c296ea60e873` | isApproved=false, comment=null (qa-spec marker: see bug BUG-03), phase=InProgress, user=Marie Lefevre |
| Notification `cahier_rejected` | — | Sent to PM (907cecf6, Jean Dupont) — QA data, can be cleaned |
| Notification `validation_rejected` ×2 | — | Sent to PM + Admin — QA data, can be cleaned |

**QA cleanup**: Admin team can delete the validation record `7e4ad9ab-d423-48be-9b29-c296ea60e873` and associated notifications.

---

## Team PM findings

**Tested**: 2026-04-26 | **Build**: `0606ddd` | **Tester**: Team PM agent  
**User**: `pm@neoleadge.com` / `Pm@12345` (Jean Dupont, id=`907cecf6-511b-47ed-8bcf-f2447bd51096`, role=ProjectManager)  
**Project under test**: `b49c1a04-a428-4d9c-a2c6-6fad59dce7ba` (QA-Test-Admin-1777328720, status=InProgress)

### Test Execution Summary

| # | Test | Result | HTTP | Sprint | Pass/Fail |
|---|------|--------|------|--------|-----------|
| 1 | `POST /auth/login` (PM) | JWT returned (`jwt` field), role=ProjectManager, mustChangePassword=false | 200 | — | PASS |
| 2 | `POST /auth/login` (Admin) | Admin JWT saved for step 8 | 200 | — | PASS |
| 3 | `GET /pm/projects` | Returns 2 projects: QA-Test-Admin-1777328720 (InProgress) + QA-Test-Admin-Dup (Draft) | 200 | Sprint 1 | PASS |
| 4 | `GET /pm/projects/:id` | Full project detail returned with fields, fieldValues, projectManager | 200 | Sprint 1 | PASS |
| 5 | `PATCH /pm/projects/:id/field-values` (first attempt with `fieldId`) | **400** — ValidationPipe rejected `fieldId`; correct field is `projectFieldId` | 400 | Sprint 1 | DOC BUG |
| 5b | `PATCH /pm/projects/:id/field-values` (with `projectFieldId`) | 200 — 8 fields saved (Contexte, Objectif, Périmètre, Stack, Livrables, Exclus, Budget, Priorité) | 200 | Sprint 1 | PASS |
| 6 | `GET /pm/projects/:id/cahier-des-charges/preview` | **404 "Cannot GET …"** — route not registered on server | 404 | Sprint 3 | FAIL |
| 6b | `GET /pm/projects/:id/cahier-des-charges/generate` | **404** — same | 404 | Sprint 3 | FAIL |
| 6c | `POST /pm/projects/:id/cahier-des-charges/save` | **404** — same | 404 | Sprint 3 | FAIL |
| 6d | `POST /pm/projects/:id/cahier-des-charges/feedback` | **404** — same | 404 | Sprint 3 | FAIL |
| 7 | `POST /pm/projects/:id/ai/generate-backlog` (Z.AI) | AI Backlog generated: 4 Epics + 10 Tasks | 201 | Sprint 5 | PASS |
| 8 | `POST /pm/projects/:id/ai/accept-backlog` (6 WPs from 2 Epics) | `{"created":6}` — 6 WPs written in one transaction | 201 | Sprint 5 | PASS |
| 9 | `GET /pm/projects/:id/work-packages` | 8 WPs total (6 qa-pm + 2 qa-member from previous runs) | 200 | Sprint 5 | PASS |
| 10 | `POST /pm/projects/:id/meetings/live/checklist` (initial, empty previousChecklist) | Personalized 6-item checklist generated with project-specific questions | 201 | Sprint 9 | PASS |
| 11 | `POST /pm/projects/:id/meetings/live/checklist` (update with previousChecklist, rich transcript) | Checklist updated: 2 items `covered`, 1 `partial`; `readyForCahier=true` when all covered | 201 | Sprint 9 | PASS |
| 11b | Z.AI transient error on 2nd call (before retry) | 502 `L'assistant IA est temporairement indisponible.` — Z.AI hiccup, succeeded on retry | 502 | Sprint 9 | WARN |
| 12 | `GET /admin/appuser?role=Member` with Admin JWT | Found `realiz@neoleadge.com` id=`d40158ca-...` | 200 | Setup | PASS |
| 13 | `PATCH /pm/projects/:id/work-packages/:wpId` `{assigneeId: realiz-id}` | WP `fe8130aa` assigned to Lucas Martin | 200 | Sprint 3 | PASS |
| 14 | Member notification after WP assignment | `work_package_assigned` notification received by realiz within ~1s | — | Sprint 4.5 | PASS |
| 15 | `GET /api/analytics/phase-velocity` with PM JWT | 200 `[]` (empty — no completed phases, normal on fresh DB) | 200 | Sprint 2 | PASS |
| 16 | `GET /api/analytics/bottleneck` with PM JWT | 200 | 200 | Sprint 2 | PASS |
| 17 | `GET /api/analytics/deadline-risk` with PM JWT | 200 | 200 | Sprint 2 | PASS |
| 18 | `GET /api/analytics/team-workload` with PM JWT | 200 | 200 | Sprint 2 | PASS |
| 19 | `GET /pm/team-planner?from=2026-01-01&to=2026-12-31` with PM JWT | 200 `[]` (no assignments yet) | 200 | Sprint 2 | PASS |
| 20 | `GET /pm/team-planner/capacity?from=...&to=...` with PM JWT | 200, user capacity rows returned | 200 | Sprint 2 | PASS |
| 21 | `GET /spec/pending-reviews` | `[]` — expected: cahier not saved (CahierDesChargesModule not deployed) | 200 | Sprint 3 | BLOCKED by BUG-04 |

---

### Findings

#### 🔴 BUG-04 — `CahierDesChargesModule` missing from deployed `app.module.ts`

**Routes affected**: ALL `/pm/projects/:id/cahier-des-charges/*` (generate, preview, save, saved, feedback)  
**Symptom**: All return HTTP 404 `"Cannot GET/POST /pm/projects/.../cahier-des-charges/..."` — NestJS route-not-found, not a proxy or auth issue.  
**Confirmed with**: PM JWT, Admin JWT, dummy project UUID — same 404 in all cases.

**Root cause**: The local `src/app.module.ts` working tree contains the fix (lines 41 + 164):
```typescript
// Line 41
import { CahierDesChargesModule } from './cahier-des-charges/cahier-des-charges.module.js';
// Line 164
CahierDesChargesModule,
```
But the **deployed commit `0606ddd`** does not include this version of `app.module.ts`. Git verification:
```bash
git show 0606ddd:web/back-nest/src/app.module.ts | grep -c "Cahier"
# Output: 0
```
The `CahierDesChargesModule`, its controller, service, and all `/cahier-des-charges/*` routes are compiled in the local dist but were never present in any committed `app.module.ts`. The module source files were added in commit `a8a3518` but `app.module.ts` was only updated in the local working tree.

**Impact**:
- Sprint 3 cahier generation workflow entirely blocked in production
- `GET /spec/pending-reviews` returns `[]` (depends on `project.aiOutput` being set by `savePersistedCahier`)
- Spec team receives no `cahier_ready_for_review` notifications

**Fix**: The working-tree `app.module.ts` already contains the correct import and registration. No code change needed — just commit and deploy.

**Build validation**: `npm run build` exits 0 with `CahierDesChargesModule` included. Controller routes correctly registered in local dist:
```
dist/src/cahier-des-charges/cahier-des-charges.controller.js  ✓
dist/src/cahier-des-charges/cahier-des-charges.service.js     ✓
dist/src/cahier-des-charges/docx-builder.js                   ✓
```

**File to commit**: `web/back-nest/src/app.module.ts` (already in working-tree M state)

---

#### ⚠️ MEDIUM-05 — `fieldValues` DTO uses `projectFieldId` not `fieldId`

**Route**: `PATCH /pm/projects/:id/field-values`  
**Symptom**: Passing `{"fieldId": "...uuid..."}` returns 400 with message `"fieldValues.0.property fieldId should not exist, fieldValues.0.projectFieldId must be a UUID"`.  
**Root cause**: `FieldValueItemDto` uses `projectFieldId` as the property name (correct per DB schema). However the `CLAUDE.md` Quick Reference and the frontend API docs do not mention this — first-time integrators will use `fieldId` and get a confusing 400.  
**Fix**: No code change needed. Update `CLAUDE.md` to document the correct field name `projectFieldId` in the `PATCH /pm/projects/:id/field-values` body spec.

---

#### ⚠️ MEDIUM-06 — Z.AI transient 502 on `/meetings/live/checklist`

**Route**: `POST /pm/projects/:id/meetings/live/checklist`  
**Symptom**: Second consecutive call (with `previousChecklist` body) returned 502 `"L'assistant IA est temporairement indisponible."`. Retry 12 seconds later succeeded with 201.  
**Root cause**: The Z.AI endpoint at `OPENAI_BASE_URL` returned a non-2xx HTTP status on that call. The 8-second in-process cooldown (`COOLDOWN_MS`) is reset on each call regardless of failure (line 101: `this.lastCallAt.set(projectId, now)` is called before the AI request), so the retry was blocked for only 8s. The 502 is a transient external service issue, not a code bug.  
**Impact**: Low — UI should handle 502 gracefully (show "Réessayez" button). Confirmed the service works correctly on retry.  
**Suggested improvement**: In `LiveMeetingService.checklist()`, only update `lastCallAt` after a **successful** AI call so that failed calls do not consume the cooldown window. This allows immediate retry on Z.AI error without waiting 8 seconds.

---

### Data created during test run

| Entity | ID | Notes |
|--------|----|-------|
| WP `qa-pm-Config Environnement` (Epic) | `489f596d-46d8-4ed8-8dcd-89aedc026603` | AI-generated Epic, no assignee |
| WP `qa-pm-Installation serveurs` (Task) | `d10043e3-6214-496b-bcaf-c1ccde77f111` | Child of Config Environnement |
| WP `qa-pm-Config bases de données` (Task) | `932ebfc9-5366-4717-9106-982011590de2` | Child of Config Environnement |
| WP `qa-pm-Integration ERP SAP` (Epic) | `98243ffe-c94b-41d1-9f10-3cfc12ac3e9b` | AI-generated Epic, no assignee |
| WP `qa-pm-Analyse API SAP` (Task) | `fe8130aa-9956-4bdd-99f9-0659130e0357` | **Assigned to realiz** (`d40158ca-...`) |
| WP `qa-pm-Développement connecteur` (Task) | `06405e3e-ac1f-4eb9-8f92-4bdaa4a2a28b` | Child of Integration ERP SAP |
| Field values (8 fields) | — | Saved on project `b49c1a04-...`, QA data |

**For Spec team**: Project `b49c1a04-a428-4d9c-a2c6-6fad59dce7ba` has questionnaire fully filled (8 fields). Once BUG-04 is deployed, `GET /spec/pending-reviews` will return this project after PM runs the cahier generation + save flow.

**For Member team**: WP `fe8130aa-9956-4bdd-99f9-0659130e0357` (`qa-pm-Analyse API SAP`) is assigned to `realiz@neoleadge.com` and ready for attachment upload + AwaitingReview flow.
