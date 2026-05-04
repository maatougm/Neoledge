# Sprint 2 — ProjectAccessGuard Rollout

## Summary

Built a reusable `ProjectAccessGuard` + `@ProjectAccess(param)` decorator pair
and applied it to every controller exposing project-scoped routes. The guard
sits in the `JwtAuthGuard` → `ProjectAccessGuard` → `PermissionsGuard` chain:
it short-circuits (404) whenever the authenticated user has no role assignment
scoped to the requested project (and no global assignment with
`projectId = null`). Fine-grained action permissions are still enforced by the
existing `@RequirePermission` decorator + `PermissionsGuard`.

Expected to close ~24 CRITICALs from the QA report (IDOR / horizontal
privilege escalation across projects).

---

## Files Created

| File | Purpose |
|------|---------|
| `web/back-nest/src/common/decorators/project-access.decorator.ts` | `@ProjectAccess(paramName = 'id')` metadata decorator |
| `web/back-nest/src/common/guards/project-access.guard.ts` | Guard with per-user/per-project 30s TTL cache + `invalidate(userId?)` |

The guard returns `NotFoundException` (not `ForbiddenException`) on deny to
avoid leaking project existence. Cache has an opportunistic eviction pass
when size exceeds 5000 entries.

---

## Per-Controller Changes

| # | File | Route-param | Guard stack updated | Decorator placement |
|---|------|-------------|---------------------|---------------------|
| 1 | `src/projects/pm.controller.ts` (`PmController`) | `id` | yes | per-method on `:id` routes (list/team-projects/users skipped — not project-scoped) |
| 2 | `src/work-packages/work-packages.controller.ts` (`WorkPackagesController`) | `projectId` | yes | class-level |
| 2b | `src/work-packages/work-packages.controller.ts` (`WorkPackageCustomFieldsController`) | `projectId` | yes | class-level |
| 2c | `src/work-packages/work-packages.controller.ts` (`MyTasksController`) | — | no (intentional — `/pm/my-tasks` is self-scoped, no `:projectId`) | — |
| 3 | `src/work-packages/wp-comments.controller.ts` (`WpCommentsController`) | `projectId` | yes | class-level |
| 4 | `src/meetings/meetings.controller.ts` (`MeetingsController`) | `projectId` | yes | class-level |
| 5 | `src/meetings/meeting-extras.controller.ts` (`MeetingExtrasController`) | `projectId` | yes | class-level |
| 6 | `src/comments/comments.controller.ts` (`CommentsController`) | `projectId` | yes | class-level (route: `api/projects/:projectId/comments`) |
| 7 | `src/gantt/gantt.controller.ts` (`GanttController`) | `projectId` | yes | class-level |
| 8 | `src/agile/agile.controller.ts` (`AgileController`) | `projectId` | yes | class-level |
| 9 | `src/wiki/wiki.controller.ts` (`WikiController`) | `projectId` | yes | class-level |
| 10 | `src/budgeting/budgeting.controller.ts` (`BudgetingController`) | `projectId` | yes | class-level (Admin `AdminBudgetsController` untouched — not project-scoped) |
| 11 | `src/time-tracking/time-tracking.controller.ts` (`ProjectTimeEntriesController`) | `projectId` | yes | class-level. `TimeEntriesController` (`/api/time-entries`, self-scoped) and `HourlyRatesController` (`/admin/hourly-rates`) left untouched as instructed |
| 12 | `src/attachments/attachments.controller.ts` (`AttachmentsController`) | `projectId` | yes | class-level (`AttachmentAdminController` untouched) |
| 13 | `src/checklists/checklists.controller.ts` (`ChecklistsController`) | `projectId` | yes | class-level |
| 14 | `src/team-planner/team-planner.controller.ts` | — | **skipped** — all team-planner routes are cross-project (`/pm/team-planner`, no `:projectId` in any path, including `/work-packages/:wpId/reassign`) |
| 15 | `src/portfolio/portfolio.controller.ts` (`VersionsController`) | `projectId` | yes | class-level on `VersionsController`. `PortfolioController` (`/admin/portfolios`) left untouched — Admin-only, not project-scoped |
| 16 | `src/automation/automation.controller.ts` (`AutomationController`) | `projectId` | yes | class-level (duplicates the existing `assertAccess()` check, but now enforced before the method runs and cached for 30s) |
| 17 | `src/portal/portal.controller.ts` (`PortalTokensAdminController`) | `projectId` | yes | class-level on `PortalTokensAdminController`. `PortalTokenRevokeController` uses `:id` (portal-token ID, not project) and `PortalPublicController` is public — both untouched |

All updated controllers now use `@UseGuards(JwtAuthGuard, ProjectAccessGuard)`
(or `JwtAuthGuard, ProjectAccessGuard, RolesGuard` where `@Roles` was already
present).

---

## Module Providers Registered

`ProjectAccessGuard` added to `providers: []` in the following modules:

| Module | File |
|--------|------|
| `ProjectsModule` | `src/projects/projects.module.ts` |
| `WorkPackagesModule` | `src/work-packages/work-packages.module.ts` |
| `MeetingsModule` | `src/meetings/meetings.module.ts` |
| `CommentsModule` | `src/comments/comments.module.ts` |
| `GanttModule` | `src/gantt/gantt.module.ts` |
| `AgileModule` | `src/agile/agile.module.ts` |
| `WikiModule` | `src/wiki/wiki.module.ts` |
| `BudgetingModule` | `src/budgeting/budgeting.module.ts` |
| `TimeTrackingModule` | `src/time-tracking/time-tracking.module.ts` |
| `AttachmentsModule` | `src/attachments/attachments.module.ts` |
| `ChecklistsModule` | `src/checklists/checklists.module.ts` |
| `PortfolioModule` | `src/portfolio/portfolio.module.ts` |
| `AutomationModule` | `src/automation/automation.module.ts` |
| `PortalModule` | `src/portal/portal.module.ts` |
| `RolesModule` | `src/roles/roles.module.ts` (needed so `RolesService` can DI the guard) |

`TeamPlannerModule` intentionally skipped (no project-scoped routes on its
controllers).

The guard pulls `PrismaService` via the `@Global() PrismaModule`, so no
additional imports are required in any of these modules.

---

## Invalidation Sites Wired

`web/back-nest/src/roles/roles.service.ts`:
- Constructor: injected `private readonly projectAccessGuard: ProjectAccessGuard`
- `assignRole()` — after `permissions.invalidate(input.userId)`, calls
  `this.projectAccessGuard.invalidate(input.userId)`
- `unassign()` — after `permissions.invalidate(row.userId)`, calls
  `this.projectAccessGuard.invalidate(row.userId)`

Note on cache scope: because the guard is registered per-module (not globally
in `AppModule`), each module instantiates its own guard with its own
`Map`. `RolesService` holds the `RolesModule` instance, so invalidation
clears that instance's cache only. Other modules' caches still expire on
the 30s TTL — acceptable worst-case staleness for a role change, and the JWT
`tokenVersion` bump (also done in `assignRole` / `unassign`) forces the client
to re-authenticate independently of the ACL cache.

---

## Constraints Honored

- Did **not** touch test-login (`TEST_USERS` in `auth.service`, `quickAccounts`
  in `LoginView`, dev auto-login in router).
- Did **not** modify `getJwtSecret()` helper.
- Did **not** break the existing `JwtAuthGuard + PermissionsGuard` stack —
  `ProjectAccessGuard` is inserted between them, and
  `PermissionsGuard` still runs its `@RequirePermission` checks.
- Did **not** touch any file outside the Sprint 2 scope listed in the brief.

---

## Build Status

`cd web/back-nest && npm run build` — **PASSED**. Zero TypeScript errors.

```
> back-nest@0.0.1 build
> nest build
(no output — success)
```
