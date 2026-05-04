# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**NeoLeadge Deployment Manager** — a full-stack project management platform for deployment projects. Administrators manage users, projects, field data, and meetings.

**Active stack:**
- `web/back-nest/` — **NestJS (TypeScript) — ACTIVE backend** — port 5122
- `web/Front/customapp/` — Vue 3 + Vite + NeoLibrary SPA (TypeScript) — port 5173
- `web/Transcription/` — Python FastAPI transcription service — port 8000

**Legacy (standby, not in active development):**
- `web/Back/` — ASP.NET Core 8 Web API (C#) — kept for reference, not running

---

## Backend — NestJS (`web/back-nest/`)

### Run

```bash
cd web/back-nest
npm install
npm run start:dev   # Watch mode on http://localhost:5122
npm run build       # Production build
```

### Environment variables (`.env`)

```env
DATABASE_URL=mysql://root:@127.0.0.1:3306/NeoLeadgeDeployment
JWT_SECRET=your-secret
JWT_EXPIRES_IN=7d
TRANSCRIPTION_URL=http://localhost:8000
AI_ENABLED=true
AI_PROVIDER=openai          # openai | gemini
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...
```

### Database

- **MySQL via XAMPP** on port 3306, database `NeoLeadgeDeployment`
- **Prisma 7** with `@prisma/adapter-mariadb` — async factory pattern in `PrismaModule`
- **`PrismaModule` is `@Global()`** — `PrismaService` is available in every module without importing `PrismaModule`
- **NEVER run `prisma db push`** — it always fails due to FK index drift. All schema changes must be applied via raw SQL:
  ```bash
  C:/xampp/mysql/bin/mysql.exe -u root -h 127.0.0.1 -P 3306 NeoLeadgeDeployment -e "SQL"
  ```
- After editing `schema.prisma`, regenerate the client:
  ```bash
  cd web/back-nest && npx prisma generate
  ```

### Architecture

- **Result pattern** — all service methods return `Result.ok(data)` / `Result.fail(message)` from `src/common/result.ts`
- **JWT auth guard** — `JwtAuthGuard` from `src/common/guards/jwt-auth.guard.ts`; applied at controller level with `@UseGuards(JwtAuthGuard)`
- **Socket.IO** — real-time notifications on `/notifications` namespace, collaboration on `/collaboration` namespace; both use JWT from `client.handshake.auth.token`
- **Module registration** — all modules registered in `src/app.module.ts`

### Modules

| Module | Path | Description |
|--------|------|-------------|
| `AuthModule` | `src/auth/` | JWT login, token refresh |
| `UsersModule` | `src/users/` | User CRUD, roles |
| `ProjectsModule` | `src/projects/` | Project CRUD, status, validations, field values |
| `MeetingsModule` | `src/meetings/` | Audio transcription, transcript management |
| `AiModule` | `src/ai/` | AI transcript analysis (OpenAI / Gemini) |
| `AnalyticsModule` | `src/analytics/` | Dashboard metrics with 15-min cache |
| `AutomationModule` | `src/automation/` | Workflow rule engine, event triggers |
| `CollaborationModule` | `src/collaboration/` | Real-time WebSocket collaboration |
| `NotificationsModule` | `src/notifications/` | Real-time notification delivery (+ reason/entityType since v2.0) |
| `PrismaModule` | `src/prisma/` | Global DB client (MariaDB adapter) |
| `WorkPackagesModule` | `src/work-packages/` | Issues / tasks / features with hierarchy, watchers, dependencies, custom fields |
| `GanttModule` | `src/gantt/` | Gantt timeline payload, milestones, baselines |
| `AgileModule` | `src/agile/` | Boards, columns, sprints, burndown, card moves |
| `TimeTrackingModule` | `src/time-tracking/` | Time entries, weekly timesheet, hourly rates |
| `BudgetingModule` | `src/budgeting/` | Project budget, line items, burn report |
| `WikiModule` | `src/wiki/` | Per-project wiki pages with revision history |
| `PortfolioModule` | `src/portfolio/` | Portfolios grouping projects + per-project versions |
| `TeamPlannerModule` | `src/team-planner/` | Capacity / assignments / conflicts |

### API Routes

**Auth**
- `POST /auth/login` — email + password → JWT

**Users** (Admin only)
- `GET /admin/users` — list users
- `POST /admin/users` — create user
- `PUT /admin/users/:id` — update user
- `DELETE /admin/users/:id` — deactivate
- `POST /admin/users/:id/reset-password`

**Projects**
- `GET /admin/projects` — list (Admin)
- `GET /pm/projects` — my projects (PM)
- `GET /pm/team-projects` — team projects
- `GET /pm/projects/:id` — project detail + validations
- `POST /admin/projects` — create (Admin)
- `PATCH /pm/projects/:id/field-values` — save questionnaire
- `POST /pm/projects/:id/fields` — add custom field
- `POST /pm/projects/:id/validations` — submit validation. Body: `{ isApproved: boolean, comment?: string }`. Comment is **required when `isApproved === false`** (rejection must be motivated). The `@@unique([projectId, validatedByUserId, phase])` constraint is enforced at the service layer (400 "déjà soumis").

**Meetings**
- `POST /pm/projects/:id/meetings/upload` — upload audio for transcription
- `GET /pm/projects/:id/meetings` — list meetings
- `GET /pm/projects/:id/meetings/:meetingId` — transcript detail
- `DELETE /pm/projects/:id/meetings/:meetingId`
- `PATCH /pm/projects/:id/meetings/:meetingId/rename-speaker`
- `POST /pm/projects/:id/meetings/:meetingId/ai-analyze` — trigger AI analysis
- `GET /pm/projects/:id/meetings/:meetingId/ai-results` — poll AI results

**Analytics** (Admin only)
- `GET /api/analytics/phase-velocity`
- `GET /api/analytics/bottleneck`
- `GET /api/analytics/deadline-risk`
- `GET /api/analytics/team-workload`

**Automation** (Admin or project manager)
- `GET /pm/projects/:id/automation/rules`
- `POST /pm/projects/:id/automation/rules`
- `PATCH /pm/projects/:id/automation/rules/:ruleId`
- `DELETE /pm/projects/:id/automation/rules/:ruleId`
- `PATCH /pm/projects/:id/automation/rules/:ruleId/toggle`
- `GET /pm/projects/:id/automation/logs`

**Work Packages** (PM / Admin)
- `GET /pm/projects/:id/work-packages` — list (filters: status, type, priority, assigneeId, sprintId, versionId, parentId, q, page, limit)
- `GET /pm/projects/:id/work-packages/:wpId` — detail with watchers, deps, custom values
- `POST /pm/projects/:id/work-packages` — create
- `PATCH /pm/projects/:id/work-packages/:wpId` — update (triggers notification on assignee/status change)
- `DELETE /pm/projects/:id/work-packages/:wpId` — soft-delete
- `PATCH /pm/projects/:id/work-packages/:wpId/move` — reposition (sprint/column/parent)
- `POST /pm/projects/:id/work-packages/:wpId/watchers` — add watcher
- `DELETE /pm/projects/:id/work-packages/:wpId/watchers/:userId`
- `POST /pm/projects/:id/work-packages/:wpId/dependencies` — add dep `{ toWpId, type }`
- `DELETE /pm/projects/:id/work-packages/:wpId/dependencies/:depId`
- `GET/POST/DELETE /pm/projects/:id/wp-custom-fields[/:fieldId]` — custom-field CRUD
- `PUT /pm/projects/:id/work-packages/:wpId/custom-values` — bulk upsert `{ values: [{ customFieldId, value }] }`

**Gantt + Milestones + Baselines**
- `GET /pm/projects/:id/gantt` — full payload (WPs with dates + milestones + dependencies)
- `GET/POST/PATCH/DELETE /pm/projects/:id/milestones[/:msId]`
- `POST /pm/projects/:id/milestones/:msId/reach`
- `GET/POST /pm/projects/:id/baselines` — list + capture
- `GET /pm/projects/:id/baselines/:snapshotName/compare` — drift report
- `DELETE /pm/projects/:id/baselines/:snapshotName`

**Agile (Boards / Sprints / Burndown)**
- `GET/POST /pm/projects/:id/boards` — auto-creates Kanban with 4 columns if none
- `GET /pm/projects/:id/boards/:boardId` — board + columns + cards
- `POST/PATCH/DELETE /pm/projects/:id/boards/:boardId/columns[/:colId]`
- `PATCH /pm/projects/:id/boards/:boardId/cards/:wpId/move` — kanban drag-drop
- `GET/POST /pm/projects/:id/boards/:boardId/sprints`
- `PATCH/DELETE /pm/projects/:id/sprints/:sprintId`
- `POST /pm/projects/:id/sprints/:sprintId/{start,close}`
- `POST /pm/projects/:id/sprints/:sprintId/work-packages` — bulk add
- `GET /pm/projects/:id/sprints/:sprintId/burndown` — ideal vs remaining hours

**Time Tracking + Hourly Rates**
- `GET/POST/PATCH/DELETE /api/time-entries[/:id]` — my entries (self-scoped)
- `GET /api/time-entries/week?weekStart=YYYY-MM-DD`
- `POST /api/time-entries/lock` — Admin lock period
- `GET /pm/projects/:id/time-entries[/summary]` — per-project
- `GET/POST/PATCH/DELETE /admin/hourly-rates[/:id]` — Admin only

**Budgeting**
- `GET /pm/projects/:id/budget` — budget + line items
- `PUT /pm/projects/:id/budget` — upsert
- `POST/PATCH/DELETE /pm/projects/:id/budget/line-items[/:id]`
- `GET /pm/projects/:id/budget/burn` — spent vs remaining report
- `GET /admin/budgets/overview` — Admin cross-project

**Wiki**
- `GET /pm/projects/:id/wiki` — page tree
- `GET /pm/projects/:id/wiki/search?q=`
- `GET/POST/PATCH/DELETE /pm/projects/:id/wiki/pages[/:slug]`
- `PATCH /pm/projects/:id/wiki/pages/:slug/move` — reparent
- `GET /pm/projects/:id/wiki/pages/:slug/revisions[/:version]`
- `POST /pm/projects/:id/wiki/pages/:slug/restore/:version`

**Portfolio + Versions** (Admin / PM)
- `GET/POST /admin/portfolios` — Admin only
- `GET/PATCH/DELETE /admin/portfolios/:id`
- `POST /admin/portfolios/:id/projects` — attach project
- `PATCH /admin/portfolios/:id/projects/reorder`
- `DELETE /admin/portfolios/:id/projects/:projectId`
- `GET /admin/portfolios/:id/roadmap` — projects + versions + milestones on timeline
- `GET/POST/PATCH/DELETE /pm/projects/:id/versions[/:versionId]`
- `POST /pm/projects/:id/versions/:versionId/{lock,close}`
- `GET /pm/projects/:id/versions/:versionId/progress`

**Team Planner** (PM / Admin)
- `GET /pm/team-planner?from&to&userIds[]&projectIds[]` — assignments per user
- `GET /pm/team-planner/capacity?from&to` — heatmap (allocated vs capacity)
- `GET /pm/team-planner/conflicts?from&to` — overlapping assignments
- `PATCH /pm/team-planner/work-packages/:wpId/reassign`
- `GET /admin/team-planner/utilization` — Admin only

**Meeting enhancements**
- `GET/POST/PATCH/DELETE /pm/projects/:id/meetings/:mId/agenda[/:itemId]`
- `PATCH /pm/projects/:id/meetings/:mId/agenda/reorder`
- `GET/POST/PATCH/DELETE /pm/projects/:id/meetings/:mId/attendees[/:attendeeId]`
- `POST /pm/projects/:id/meetings/:mId/attendees/bulk-mark` — set present/absent
- `GET/POST/PATCH/DELETE /pm/projects/:id/meetings/:mId/outcomes[/:outcomeId]`
- `POST /pm/projects/:id/meetings/:mId/outcomes/:outcomeId/convert-to-wp` — turn an outcome into a Work Package

### Prisma Schema — Key Models

```
AppUser         — users with roles (Admin | ProjectManager | SpecificationTeam | RealizationTeam | DeploymentTeam | Viewer)
Project         — projects with status, priority, budget, soft-delete
ProjectField    — dynamic/static/custom field definitions per project
ProjectFieldValue — field values (updatedAt, updatedBy added for collaboration tracking)
ProjectValidation — per-phase approval records @@unique([projectId, validatedByUserId, phase])
MeetingTranscript — transcription records with AI fields (aiStatus, aiSummary, aiModel, aiError, aiProcessedAt)
TranscriptSegment — speaker-diarized segments
MeetingActionItem — AI-extracted action items per transcript
MeetingDecision   — AI-extracted decisions/risks per transcript
AutomationRule    — workflow rules (triggerEvent, actionType, actionConfig JSON, isActive)
AutomationLog     — execution history per rule
AnalyticsCache    — 15-min TTL cache for analytics queries (cacheKey, data JSON)
Notification      — per-user notifications with reason/entityType/entityId/actorId/link (v2.0)
PhaseChecklist    — per-phase checklist items
AuditLog          — entity change audit trail

— v2.0 models (OpenProject parity) —
Board + BoardColumn + Sprint — kanban & scrum boards, auto-seeded with 4 columns
Version            — per-project release versions (Open/Locked/Closed)
WorkPackage        — issues/tasks/features (type, status, priority, parent, sprint, version, column)
WorkPackageDependency — blocks / follows / relates relationships
WorkPackageWatcher    — subscribe users to WP change notifications
WorkPackageCustomField + WorkPackageCustomValue — per-project custom attributes
Milestone          — project-level milestones with isReached + color
GanttBaseline      — dated snapshots of WP dates for drift comparison
TimeEntry + HourlyRate — timesheet entries + role/project-scoped rates
ProjectBudget + BudgetLineItem — labor + material budgets + line items
WikiPage + WikiRevision — per-project wiki with revision history
Portfolio + PortfolioProject — group projects into portfolios for roadmap view
MeetingAgendaItem + MeetingAttendee + MeetingOutcome — meeting prep & outputs
```

### AI Module (`src/ai/`)

- `AiService.analyzeTranscript(transcriptId)`:
  1. Sets `aiStatus = 'processing'`
  2. Builds transcript text from segments
  3. Calls provider (OpenAI or Gemini based on `AI_PROVIDER` env var)
  4. Persists `actionItems` + `decisions` in a transaction
  5. Sets `aiStatus = 'completed'` or `'failed'`
- Both providers have `AbortSignal.timeout(60_000)` on fetch calls
- Fire-and-forget calls use `.catch((e) => logger.error(...))` to prevent unhandled rejections

### Automation Module (`src/automation/`)

- `executeRulesForEvent(projectId, event, context)` triggered by `ProjectsService` after:
  - Status changes → `status_changed`
  - Validation submissions → `validation_submitted`
- Supported actions: `send_notification` (creates Notification row), `update_field` (upserts ProjectFieldValue)
- Condition evaluation: `equals`, `not_equals`, `contains` operators

### Collaboration Module (`src/collaboration/`)

- WebSocket gateway on `/collaboration` namespace
- Auth: reads `client.handshake.auth.token`, verifies with `JwtService` — same pattern as `NotificationsGateway`
- Events: `join-project`, `leave-project`, `field-update`, `field-focus`, `field-blur`
- In-process presence Map (single-instance — not distributed)

### Adding a new service

1. Create `src/<module>/<module>.service.ts` — inject `PrismaService`, return `Result.ok()` / `Result.fail()`
2. Create `src/<module>/<module>.controller.ts` — `@UseGuards(JwtAuthGuard)`, map results to HTTP responses
3. Create `src/<module>/<module>.module.ts` — declare providers/controllers, export service if needed
4. Add to `imports` in `src/app.module.ts`

---

## Transcription Service — Python (`web/Transcription/`)

```bash
cd web/Transcription
pip install -r requirements.txt
uvicorn app:app --port 8000
```

- `POST /transcribe` — accepts `multipart/form-data` with `audio` file
- Uses `faster-whisper large-v3` for speech-to-text
- Uses `speechbrain ECAPA` for speaker diarization
- Returns: `{ segments: [{speaker, text, start_time, end_time, language, confidence}], duration_seconds, detected_languages }`

---

## Frontend — Vue 3 (`web/Front/customapp/`)

```bash
cd web/Front/customapp
npm install
npm run dev      # http://localhost:5173
npm run build    # dist/
npm run lint
```

### NeoLibrary Component API — Critical Constraints

| Component | Key Props / Notes |
|-----------|-------------------|
| `NeoButton` | `label`, `icon`, `loading`, `disabled`, `outlined`, `text`, `size`. **No `severity="primary"`** — omit `severity` for default teal. Use `severity="secondary"` / `"danger"` / `"warning"` only |
| `NeoInputText` | `v-model`, `label`, `placeholder`, `disabled` |
| `NeoSelect` | `v-model`, `options`, `optionLabel`, `optionValue`, `placeholder`, `disabled` |
| `NeoDatePicker` | `v-model` is `string \| string[] \| null` — **never** bind to a `Date` object |
| `NeoTag` | `value`, `severity` (`"success" \| "info" \| "warning" \| "danger" \| "secondary" \| "contrast"`) |
| `NeoMessage` | `severity`, `text` |
| `NeoToast` | Placed once in layout. Use `useNeoToast()` composable |
| `NeoDialog` | `v-model:visible`, `header`, `modal`, `style` |
| `NeoCard` | Standard card wrapper |

**`useNeoToast()`** — only `.add({ severity, summary?, detail, life? })`. **No `.success()` / `.error()` shortcuts.**

**`useNeoConfirm().require(options)`** — returns `void`. Use `accept` callback; do not `await` it.

### Stores (`src/stores/`)

| Store | Purpose |
|-------|---------|
| `authStore.ts` | JWT, current user, login/logout |
| `configStore.ts` | App config from `public/config.json` |
| `projectStore.ts` | Admin project CRUD |
| `userStore.ts` | Admin user CRUD |
| `pmStore.ts` | PM module — projects, meetings, transcripts, AI polling, automation rules/logs |
| `analyticsStore.ts` | Analytics dashboard — 4 metrics, `fetchAll()` runs in parallel |
| `notificationStore.ts` | Per-user notifications |
| `commentStore.ts` | Project comments |
| `templateStore.ts` | Project templates |
| `uiStore.ts` | UI state (sidebar, dark mode) |
| `workPackageStore.ts` | Work Packages CRUD, watchers, dependencies, custom fields |
| `agileStore.ts` | Boards, sprints, card moves, burndown |
| `ganttStore.ts` | Gantt payload, milestones, baselines |
| `timeStore.ts` | Time entries, weekly grid, project summary |
| `budgetStore.ts` | Project budget + line items + burn report |
| `wikiStore.ts` | Wiki tree + pages + revisions |
| `portfolioStore.ts` | Portfolios + versions |
| `teamPlannerStore.ts` | Assignments, capacity, conflicts |
| `meetingExtrasStore.ts` | Agenda items + attendees + outcomes (convert-to-WP) |

### Composables (`src/composables/`)

- `useNotificationSocket.ts` — singleton Socket.IO on `/notifications`
- `useCollaborationSocket.ts` — singleton Socket.IO on `/collaboration`; exposes `joinProject`, `leaveProject`, `sendFieldUpdate`, `sendFieldFocus`, `sendFieldBlur`, reactive `presenceList` and `remoteFieldChange`
- `useProjectForm.ts` — reactive project form state and validation

### Key Components

**Admin:**
- `components/admin/sections/AnalyticsSection.vue` — Chart.js dashboard (phase velocity, bottleneck, deadline risk, team workload)

**PM module:**
- `components/pm/QuestionnaireForm.vue` — field form with real-time collaboration (presence avatars, field focus indicators)
- `components/pm/MeetingSection.vue` — meeting list, upload, recorder
- `components/pm/MeetingAiPanel.vue` — AI results tabs (summary, action items, decisions); polls every 5s while processing
- `components/pm/AutomationSection.vue` — rule builder dialog, rules list, execution logs
- `components/pm/PMProjectDetail.vue` — tabbed project view (questionnaire, meetings, validations, activity, automation)

**Common:**
- `components/common/PresenceAvatars.vue` — colored avatar circles with initials, up to 5 + overflow

**v2.0 Views (OpenProject parity):** — all under `/app/pm/projects/:id/*`, wrapped by `ProjectModuleShell` for breadcrumbs + header
- `WorkPackagesView.vue` — split-panel WP list + detail (tabs: Détails, Relations, Observateurs), create dialog
- `GanttView.vue` — timeline with zoom, milestones (clickable for CRUD), baseline capture
- `KanbanBoardView.vue` — HTML5 drag-drop cards between columns
- `BacklogView.vue` — unassigned WPs + active sprint with drag-drop assignment
- `SprintBoardView.vue` — sprint selector, metadata, Chart.js burndown (ideal vs remaining)
- `WikiView.vue` — tree + markdown view/edit + search + revisions
- `BudgetView.vue` — summary cards + line items + edit modals
- `TimeTrackingView.vue` — log time dialog + my entries + project summary (by user/activity)
- `MembersView.vue` — project members table
- `ProjectActivityView.vue` — activity timeline
- `PMProjectDetailView.vue` — project overview tile grid (entry point)
- `PortfolioView.vue` — `/app/admin/portfolio` — portfolio CRUD
- `TeamPlannerView.vue` — `/app/admin/team-planner` — capacity heatmap, assignments, conflicts

**v2.0 Shared components:**
- `common/ProjectModuleShell.vue` — wraps every project module with breadcrumbs + page header
- `common/ProjectBreadcrumbs.vue` — Home > Project > Module trail
- `common/SplitPanel.vue` — 35/65 list+detail responsive split
- `common/ModulePageHeader.vue` — title + status tag + action bar
- `common/AppModal.vue` — Teleport-based modal (replacement for deprecated NeoDialog)
- `common/PriorityDot.vue` — colored dot for WP priority
- `common/WpStatusTag.vue` — severity-mapped NeoTag wrapper
- `meetings/MeetingExtrasTabs.vue` — agenda/attendees/outcomes tabs in meeting detail

**Shared utilities:**
- `lib/formatDate.ts` — `formatDate`, `formatDateShort`, `formatDateTime`, `formatRelative`
- `utils/phaseLabels.ts` — FR translation of ProjectStatus enum values

### Router (`src/router/index.ts`)

- `/login` — LoginView (public)
- `/app/admin/*` — AdminLayout (requires Admin role) — includes `portfolio`, `team-planner`
- `/app/pm/*` — PmLayout (requires ProjectManager or Admin) — includes project module routes:
  - `/app/pm/projects/:id` — project overview
  - `/app/pm/projects/:id/{workpackages,gantt,board,backlogs,sprint,wiki,wiki/:slug,budget,time,members,activity}`
- `/app/team/*` — TeamLayout (requires team member role)

### Contextual Sidebar

`AppShell.vue` builds the sidebar nav from role, but **switches to a project-module nav** when `route.path` starts with `/app/pm/projects/:id`. The switch happens in `router.afterEach` (not a computed) to avoid RouterView reconciliation crashes during layout transitions. Per-project nav arrays are cached in a `Map` keyed by projectId so navigation between sub-routes of the same project doesn't re-render the sidebar.

---

## Database Setup (first-time)

1. Start XAMPP → MySQL on port 3306
2. Create database: `C:/xampp/mysql/bin/mysql.exe -u root -h 127.0.0.1 -P 3306 -e "CREATE DATABASE IF NOT EXISTS NeoLeadgeDeployment;"`
3. Set `DATABASE_URL=mysql://root:@127.0.0.1:3306/NeoLeadgeDeployment` in `web/back-nest/.env`
4. Push schema (only on fresh DB — use raw SQL for updates on existing DB):
   ```bash
   cd web/back-nest && npx prisma db push
   ```
5. Generate client: `npx prisma generate`

### Seed demo data (OpenProject-parity tables)

After migrations are applied and the core app data exists (projects, users, meetings), run:

```bash
cd web/back-nest
npx tsx prisma/seed-openproject.ts    # 57 WPs, 15 sprints, 20 milestones, 120 time entries, 5 budgets, 13 wiki pages, 1 portfolio, 56 watchers, 16 dependencies
npx tsx prisma/seed-notifications.ts  # 7 demo notifications for admin (mention, assignee, watcher, deadline)
```

The seeders are idempotent — safe to re-run. They scan existing `bbbbbbbb-*` seed projects and attach demo data to each.

### Migration for new tables

The 21 new tables added in v2.0 are defined in `prisma/migration-sprint0.sql`. Apply to an existing DB via:

```bash
C:/xampp/mysql/bin/mysql.exe -u root -h 127.0.0.1 -P 3306 NeoLeadgeDeployment < prisma/migration-sprint0.sql
cd web/back-nest && npx prisma generate
```

---

## Known Issues & Constraints

- **`prisma db push` fails on existing DB** — FK index drift causes errors. Use raw SQL via `mysql.exe` for all schema changes on an existing database.
- **HTTPS disabled in dev** — Vite dev server runs HTTP only (`http://localhost:5173`).
- **`NeoButton severity="primary"` does not exist** — omit `severity` for default teal style.
- **`useNeoToast()` has no shorthand methods** — always use `.add({ severity, detail, life })`.
- **`NeoDatePicker` v-model must be `string | null`** — never bind to a `Date` object.
- **Axios multipart uploads** — never set `Content-Type: multipart/form-data` manually; axios sets it with the boundary automatically when `FormData` is passed.
- **Collaboration presence is single-instance** — the in-process presence Map won't work correctly with multiple NestJS processes (PM2 cluster, etc.).
- **DTOs must be classes, not interfaces, when used with `@Body()`** — `import type` erases the class at runtime, and NestJS's `ValidationPipe` with `whitelist: true` will strip all fields because the metatype resolves to `Object`. Always define DTOs as `class` with `class-validator` decorators and import normally (not `import type`).
- **New nav changes must defer to `router.afterEach`** — changing `navSections` during navigation crashes `RouterView` mid-reconciliation. See `AppShell.vue` for the stable pattern.
- **Admin routes on new modules use `@Roles('Admin')`** — apply `JwtAuthGuard + RolesGuard` stack for any `/admin/*` endpoint in new modules. See `portfolio.controller.ts`, `time-tracking.controller.ts` for examples.

---

## Legacy — ASP.NET Core 8 (`web/Back/`)

> **Status: STANDBY — not in active development. Kept for reference only.**

The original .NET backend built for Elise CustomAction integration. Uses:
- EF Core 8 + SQL Server
- Autofac DI, Serilog, AutoMapper 14+, FluentValidation
- Elise SOAP integration via `Integration.Elise.Web.Core` package
- JWT issued after GUID validation with Elise SOAP service

Do not run or modify this backend unless specifically working on Elise CustomAction integration. All new features are built on the NestJS backend.
