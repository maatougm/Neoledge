# QA Manifest — Phase 0

## Totals
- Backend `.ts`: 148 files / 13,037 lines
- Frontend `.ts + .vue`: 173 files / 35,392 lines
- Python: 2 files
- **Grand total: ~323 source files**

## Hot files (>800 LOC — extra care, may sub-shard)

Backend:
- `src/auth/auth.service.ts` — 576
- `src/projects/projects.service.ts` — 531

Frontend:
- `src/views/ClientPortalView.vue` — 1025
- `src/components/admin/sections/DashboardSection.vue` — 809
- `src/views/UserProfileView.vue` — 800

## Security hot files (pre-surfaced for Phase 4)

| File:Line | Pattern |
|---|---|
| `web/back-nest/src/health/health.controller.ts:21` | `$queryRaw` (health check, low risk) |
| `web/back-nest/src/system-status/system-status.service.ts:20` | `$queryRaw` (health check, low risk) |
| `web/back-nest/src/portal/portal.service.ts:73` | `crypto.randomBytes(32)` — portal token entropy |
| `web/back-nest/src/users/users.service.ts:60` | `crypto.randomBytes` — temp password |
| `web/Front/customapp/src/components/pm/MeetingAiPanel.vue:85` | **`v-html` — AI summary markdown render (XSS risk)** |
| `web/Front/customapp/src/views/WikiView.vue:40` | **`v-html` — wiki page markdown render (XSS risk)** |

## Shard assignment — Backend (Phase 1)

| Shard | Path |
|---|---|
| auth | src/auth/ |
| users | src/users/ |
| projects | src/projects/ |
| meetings | src/meetings/ |
| ai | src/ai/ |
| automation | src/automation/ |
| collaboration | src/collaboration/ |
| portal | src/portal/ |
| analytics | src/analytics/ |
| work-packages | src/work-packages/ |
| gantt | src/gantt/ |
| agile | src/agile/ |
| wiki | src/wiki/ |
| budgeting | src/budgeting/ |
| time-tracking | src/time-tracking/ |
| portfolio | src/portfolio/ |
| team-planner | src/team-planner/ |
| notifications | src/notifications/ |
| permissions-roles | src/permissions/ + src/roles/ |
| small-1 | src/attachments/ + src/audit/ + src/checklists/ + src/comments/ |
| small-2 | src/dashboard/ + src/export/ + src/filters/ + src/health/ + src/search/ |
| small-3 | src/mail/ + src/profile/ + src/templates/ + src/system-status/ + src/deadlines/ |
| infra | src/common/ + src/prisma/ + src/app.module.ts + src/main.ts |
| prisma | prisma/schema.prisma + prisma/*.sql + prisma/seed-*.ts |

## Shard assignment — Frontend (Phase 2)

| Shard | Paths |
|---|---|
| stores | src/stores/ |
| views-admin | src/views/admin*.vue + views/Admin*.vue + layouts/AdminLayout.vue |
| views-pm | src/views/PM*.vue + views/WorkPackages*.vue + views/Gantt*.vue + views/Kanban*.vue + views/Backlog*.vue + views/Sprint*.vue + views/Wiki*.vue + views/Budget*.vue + views/Time*.vue + views/Members*.vue + views/ProjectActivity*.vue + layouts/PmLayout.vue |
| views-other | src/views/Login*.vue + ClientPortal*.vue + Home*.vue + TeamMember*.vue + Unauthorized*.vue + UserProfile*.vue + CustomAction*.vue + TeamPlanner*.vue + Portfolio*.vue + MyTasks*.vue + AuditLog*.vue + ForceChangePassword*.vue |
| components-admin | src/components/admin/ |
| components-pm | src/components/pm/ |
| components-common-meetings | src/components/common/ + src/components/meetings/ + NotificationBell.vue |
| components-filters-other | src/components/filters/ + src/components/*.vue root |
| composables | src/composables/ |
| router-lib-utils | src/router/ + src/lib/ + src/utils/ + src/types/ |
| layouts-main | src/layouts/ + src/App.vue + src/main.ts |
