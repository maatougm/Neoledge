# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**NeoLeadge Deployment Manager** — a full-stack project management platform for deployment projects. Administrators manage users, projects, field data, meetings, and client sign-offs.

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
| `PortalModule` | `src/portal/` | Public client portal with token-based access |
| `NotificationsModule` | `src/notifications/` | Real-time notification delivery |
| `PrismaModule` | `src/prisma/` | Global DB client (MariaDB adapter) |

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
- `POST /pm/projects/:id/validations` — submit validation

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

**Client Portal**
- `POST /admin/projects/:id/portal-tokens` — generate token (JWT)
- `GET /admin/projects/:id/portal-tokens` — list tokens (JWT)
- `DELETE /admin/portal-tokens/:id` — revoke (JWT)
- `GET /portal/:token` — public project view (no auth)
- `POST /portal/:token/signoff` — client sign-off (no auth)

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
PortalToken       — public access tokens (crypto.randomBytes(32), expiry, revocation)
PortalSignoff     — client sign-off records (clientName, clientEmail, isApproved, ipAddress)
AnalyticsCache    — 15-min TTL cache for analytics queries (cacheKey, data JSON)
Notification      — per-user notifications delivered via Socket.IO
PhaseChecklist    — per-phase checklist items
AuditLog          — entity change audit trail
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

### Composables (`src/composables/`)

- `useNotificationSocket.ts` — singleton Socket.IO on `/notifications`
- `useCollaborationSocket.ts` — singleton Socket.IO on `/collaboration`; exposes `joinProject`, `leaveProject`, `sendFieldUpdate`, `sendFieldFocus`, `sendFieldBlur`, reactive `presenceList` and `remoteFieldChange`
- `useProjectForm.ts` — reactive project form state and validation

### Key Components

**Admin:**
- `components/admin/sections/AnalyticsSection.vue` — Chart.js dashboard (phase velocity, bottleneck, deadline risk, team workload)
- `components/admin/PortalTokenManager.vue` — generate/revoke/copy portal tokens

**PM module:**
- `components/pm/QuestionnaireForm.vue` — field form with real-time collaboration (presence avatars, field focus indicators)
- `components/pm/MeetingSection.vue` — meeting list, upload, recorder
- `components/pm/MeetingAiPanel.vue` — AI results tabs (summary, action items, decisions); polls every 5s while processing
- `components/pm/AutomationSection.vue` — rule builder dialog, rules list, execution logs
- `components/pm/PMProjectDetail.vue` — tabbed project view (questionnaire, meetings, validations, activity, automation)

**Common:**
- `components/common/PresenceAvatars.vue` — colored avatar circles with initials, up to 5 + overflow

**Views:**
- `views/ClientPortalView.vue` — public (no auth), route `/portal/:token`; phase stepper, field values, sign-off form

### Router (`src/router/index.ts`)

- `/login` — LoginView (public)
- `/portal/:token` — ClientPortalView (public, outside auth guard)
- `/admin/*` — AdminLayout (requires Admin role)
- `/pm/*` — PmLayout (requires ProjectManager role)
- `/team/*` — TeamLayout (requires team member role)

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

---

## Known Issues & Constraints

- **`prisma db push` fails on existing DB** — FK index drift causes errors. Use raw SQL via `mysql.exe` for all schema changes on an existing database.
- **HTTPS disabled in dev** — Vite dev server runs HTTP only (`http://localhost:5173`).
- **`NeoButton severity="primary"` does not exist** — omit `severity` for default teal style.
- **`useNeoToast()` has no shorthand methods** — always use `.add({ severity, detail, life })`.
- **`NeoDatePicker` v-model must be `string | null`** — never bind to a `Date` object.
- **Axios multipart uploads** — never set `Content-Type: multipart/form-data` manually; axios sets it with the boundary automatically when `FormData` is passed.
- **Collaboration presence is single-instance** — the in-process presence Map won't work correctly with multiple NestJS processes (PM2 cluster, etc.).

---

## Legacy — ASP.NET Core 8 (`web/Back/`)

> **Status: STANDBY — not in active development. Kept for reference only.**

The original .NET backend built for Elise CustomAction integration. Uses:
- EF Core 8 + SQL Server
- Autofac DI, Serilog, AutoMapper 14+, FluentValidation
- Elise SOAP integration via `Integration.Elise.Web.Core` package
- JWT issued after GUID validation with Elise SOAP service

Do not run or modify this backend unless specifically working on Elise CustomAction integration. All new features are built on the NestJS backend.
