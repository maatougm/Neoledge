# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **NeoLeadge/Elise CustomAction — Deployment Manager** — a full-stack integration project for embedding a deployment-management UI panel inside the Elise document management system (by Archimed). The CustomAction is loaded in an iframe inside Elise and lets administrators manage users and deployment projects.

The project is structured under `web/` with three top-level directories:

- `web/Back/` — ASP.NET Core 8 Web API (C#)
- `web/Front/customapp/` — Vue 3 + Vite + NeoLibrary SPA (TypeScript)
- `web/Packages/` — Deployment artifacts and Elise integration config

---

## Backend (ASP.NET Core 8)

**Solution:** `web/Back/Elise projects templates.sln`

**Projects:**
- `Integration.Elise.Api.Template` — API host; entry point is `Program.cs`
- `Integration.Elise.Services` — Business logic, repositories, EF Core, DTOs, validators

**Build & run:**
```bash
# From web/Back/
dotnet build
dotnet run --project Integration.Elise.Api.Template
# Runs on http://localhost:5122 and https://localhost:44377
```

**Key NuGet packages:**
| Package | Version | Purpose |
|---|---|---|
| `Integration.Elise.Web.Core` | Archimed internal | JWT auth, webhook, SOAP facade, `IEliseFramePageService` |
| Autofac + Autofac.Extensions.DependencyInjection | latest | DI container |
| Serilog.AspNetCore | latest | Structured logging |
| Microsoft.EntityFrameworkCore.SqlServer | 8.0.12 | ORM + SQL Server provider |
| Microsoft.EntityFrameworkCore.Design | 8.0.12 | EF Core CLI tooling |
| AutoMapper | 14.0.0 | DTO ↔ domain mapping (must be ≥14 — Core package requires it) |
| BCrypt.Net-Next | 4.0.3 | Password hashing |
| FluentValidation | 11.11.0 | Input validation with French error messages |
| FluentValidation.DependencyInjectionExtensions | 11.11.0 | FluentValidation DI integration |

### Architecture

- **DI** is handled by Autofac modules: `ServiceModule` (in `Integration.Elise.Services/DI/`) registers all services, repositories, AutoMapper, and validators; `BaseEliseWebApplicationModule` (from Core) registers Elise infrastructure.
- **HeaderMiddleware** injects required Elise iframe headers via `IEliseFramePageService` on every response.
- **JWT authentication flow:** Elise calls `/hook/auth?guid=...` → backend validates the GUID via Elise SOAP → returns a JWT → frontend stores and sends it on all subsequent requests.
- **`ModelStateExceptionFilterAttribute`** is a global exception filter that logs all unhandled exceptions via Serilog.
- **Configuration** lives in `appsettings.json` and `appsettings.Development.json`; the `CustomAction` section controls JWT settings, webhook validation, and the API key. `ConnectionStrings:DefaultConnection` is in `appsettings.Development.json`.

### Domain Model

```
AppUser (1) ─────────────────── (*) Project  [as ProjectManager]
AppUser (1) ─────────────────── (*) Project  [as CreatedByAdmin]
Project (1) ──────────────────── (*) ProjectFieldValue
ProjectField (1) ─────────────── (*) ProjectFieldValue
```

**Enums** (all stored as strings in SQL Server):
- `UserRole`: `Admin | ProjectManager | SpecificationTeam | RealizationTeam | DeploymentTeam | Viewer`
- `ProjectStatus`: `Draft | InProgress | SpecificationValidation | Realization | DeploymentValidation | Completed`
- `FieldType`: `Text | Number | Date | Select | Checkbox`
- `FieldCategory`: `Static | Dynamic | Custom`

**`AppUser`** entity (`Models/Domain/AppUser.cs`):
- `Id` (Guid), `FirstName`, `LastName`, `Email` (unique), `PasswordHash` (BCrypt), `Role` (UserRole), `IsActive` (soft-delete), `CreatedAt`, `UpdatedAt`

**`Project`** entity (`Models/Domain/Project.cs`):
- `Id` (Guid), `Name`, `Description`, `ClientName`, `Status`, `StartDate` (nullable), `EndDate` (nullable)
- FK `ProjectManagerId` → `AppUser`, FK `CreatedByAdminId` → `AppUser`
- Navigation: `FieldValues` (list of `ProjectFieldValue`)

**`ProjectField`** entity (`Models/Domain/ProjectField.cs`):
- `Id` (Guid), `Label`, `Type` (FieldType), `Category` (FieldCategory), `IsRequired`, `DisplayOrder`, `Options` (JSON string for Select fields)

**`ProjectFieldValue`** entity (`Models/Domain/ProjectFieldValue.cs`):
- `Id` (Guid), FK `ProjectId`, FK `FieldId`, `Value` (string)

### EF Core

**DbContext:** `Integration.Elise.Services/Infrastructure/ApplicationDbContext.cs`
- Tables: `AppUsers`, `Projects`, `ProjectFields`, `ProjectFieldValues`
- Enum columns stored as `nvarchar(50)` strings
- Cascade: Project.FieldValues deletes on cascade; Project.PM/Admin FKs use `NoAction` to avoid multiple-cascade paths

**Migration:** `Integration.Elise.Services/Infrastructure/Migrations/20260326000000_InitialCreate.cs` (manual migration)

**Run migration:**
```bash
# From web/Back/ (after connection string is configured)
dotnet ef database update --project Integration.Elise.Services --startup-project Integration.Elise.Api.Template
```

**Connection string** (in `appsettings.Development.json`):
```json
"ConnectionStrings": {
  "DefaultConnection": "Server=localhost;Database=NeoLeadgeDeployment;Trusted_Connection=True;TrustServerCertificate=True;"
}
```
Adjust `Server=` to `.\SQLEXPRESS` or `(localdb)\MSSQLLocalDB` if not using default SQL Server instance.

### Result Pattern

All service methods return `Result<T>` or `Result` (`Models/Result.cs`):
```csharp
Result<T>.Success(data)
Result<T>.Failure("message")
Result.Success()
Result.Failure("message")
```
Controllers check `result.IsSuccess` and return `Ok(result.Value)` or `BadRequest(result.Error)`.

### Services & Repositories

| Interface | Implementation | Responsibility |
|---|---|---|
| `IAppUserRepository` | `AppUserRepository` | EF Core CRUD for `AppUser` |
| `IProjectRepository` | `ProjectRepository` | EF Core CRUD for `Project` + field values |
| `IAppUserService` | `AppUserService` | Business logic: create/update/deactivate users, BCrypt, email uniqueness, temp password |
| `IProjectService` | `ProjectService` | Business logic: create/update project, seed static fields, PM assignment, status transitions |

**Static field seeding** — `ProjectService.CreateProjectAsync` automatically seeds 6 `ProjectFieldValue` rows for each new project:
1. Société (Text, Static, Required)
2. Code client (Text, Static, Required)
3. Type de projet (Select: NeoLeadge/Elise/Both, Static, Required)
4. Date de démarrage (Date, Static)
5. Chef de projet (Text, Static)
6. Statut global (Select: À faire/En cours/Terminé, Dynamic)

### Validators (FluentValidation, French messages)

- `CreateUserDtoValidator` / `UpdateUserDtoValidator` (`Validators/AppUserValidator.cs`)
- `CreateProjectDtoValidator` / `UpdateProjectDtoValidator` (`Validators/ProjectValidator.cs`)

### AutoMapper Profiles

- `AppUserMappingProfile` (in `Models/DTOs/AppUserDto.cs`)
- `ProjectMappingProfile` (in `Models/DTOs/ProjectDto.cs`)
- Registered in `ServiceModule` via `builder.RegisterInstance(new MapperConfiguration(...)).SingleInstance()`

### Controllers

All controllers use `[Authorize]` and live in `Integration.Elise.Api.Template/Controllers/`.

**`AppUserController`** — `[Route("admin/[controller]")]`
| Method | Route | Description |
|---|---|---|
| GET | `/admin/appuser` | List all active users |
| GET | `/admin/appuser/{id}` | Get user by ID |
| POST | `/admin/appuser` | Create user |
| PUT | `/admin/appuser/{id}` | Update user |
| DELETE | `/admin/appuser/{id}` | Soft-delete (deactivate) user |
| POST | `/admin/appuser/{id}/reset-password` | Reset password, returns temp password |
| POST | `/admin/appuser/{id}/reactivate` | Reactivate soft-deleted user |

**`ProjectController`** — `[Route("admin/[controller]")]`
| Method | Route | Description |
|---|---|---|
| GET | `/admin/project` | List all projects (summary) |
| GET | `/admin/project/{id}` | Get project detail with field values |
| POST | `/admin/project` | Create project + seed static fields |
| PUT | `/admin/project/{id}` | Update project metadata |
| DELETE | `/admin/project/{id}` | Delete project |
| POST | `/admin/project/{id}/assign-manager` | Assign project manager |
| PATCH | `/admin/project/{id}/status` | Update project status |

### Adding a new service

1. Define interface in `Integration.Elise.Services/Interfaces/`
2. Implement in `Integration.Elise.Services/Impl/`
3. Register in `Integration.Elise.Services/DI/ServiceModule.cs`
4. Inject via constructor in any controller

### New Backend Modules (NestJS)

> **Note:** The project has been modernized with a NestJS backend (`web/back-nest/src/`). The legacy ASP.NET Core modules remain but new features are built on NestJS.

#### `collaboration/` — Real-time Collaboration (WebSocket)

Located in `web/back-nest/src/collaboration/`

- **Gateway:** `/collaboration` namespace with JWT auth (same pattern as NotificationsGateway)
- **Events handled:**
  - `join-project` — user joins real-time session for a project
  - `leave-project` — user leaves session
  - `field-update` — collaborative field value change
  - `field-focus` — user focusing on a field
  - `field-blur` — user leaving a field
- **Service:** `saveField(projectId, projectFieldId, value, userId)` — upserts `ProjectFieldValue` row
- **Presence:** In-process Map tracking active users per project (single-instance only; not distributed)

#### `ai/` — AI Meeting Assistant

Located in `web/back-nest/src/ai/`

- **Controller:** Inherited by `MeetingsController` (GET `/meetings/:id/ai-analysis`)
- **Service methods:**
  - `analyzeTranscript(transcriptId)` — sets processing status → calls AI provider → persists `actionItems` + `decisions` → sets completed/failed status
- **Providers:** Pluggable architecture
  - `OpenAiProvider` — uses `gpt-4o-mini` model
  - `GeminiProvider` — uses `gemini-1.5-flash` model
  - Factory pattern reads `AI_PROVIDER` env var (default: `openai`)
  - Both providers have `AbortSignal.timeout(60_000)` on fetch calls
- **Required env vars:**
  ```
  AI_ENABLED=true
  AI_PROVIDER=openai|gemini
  OPENAI_API_KEY=sk-...
  GEMINI_API_KEY=...
  ```

#### `analytics/` — Advanced Analytics

Located in `web/back-nest/src/analytics/`

- **Routes:** All admin-only (`JwtAuthGuard` + role check)
  - `GET /api/analytics/phase-velocity` — phase completion rates
  - `GET /api/analytics/bottleneck` — resource/process bottleneck heatmap
  - `GET /api/analytics/deadline-risk` — projects at risk of missing deadlines
  - `GET /api/analytics/team-workload` — workload distribution by team member
- **Cache:** `AnalyticsCacheService` with 15-minute TTL, backed by `AnalyticsCache` table
- **Methods:**
  - `getPhaseVelocity(dateRange)` — returns phases, completion %, trend
  - `getBottleneckHeatmap()` — returns bottleneck zones with severity
  - `getDeadlineRisk()` — returns projects + risk score + days until deadline
  - `getTeamWorkload()` — returns team members + assigned task count + utilization %

#### `automation/` — Workflow Automation Engine

Located in `web/back-nest/src/automation/`

- **Routes:** All under `/pm/projects/:id/automation/`; auth: `JwtAuthGuard` + ownership check (Admin or project manager)
  - `GET /pm/projects/:id/automation/rules` — list all rules for project
  - `POST /pm/projects/:id/automation/rules` — create new rule
  - `PATCH /pm/projects/:id/automation/rules/:ruleId` — update rule
  - `DELETE /pm/projects/:id/automation/rules/:ruleId` — delete rule
  - `PATCH /pm/projects/:id/automation/rules/:ruleId/toggle` — enable/disable rule
  - `GET /pm/projects/:id/automation/logs` — view execution history
- **Core method:** `executeRulesForEvent(projectId, event, context)` — triggered by `ProjectsService` after status changes and validation submissions
- **Supported trigger events:**
  - `status_changed` — project status transition
  - `validation_submitted` — field validation completed
  - `field_updated` — field value changed
  - `deadline_approaching` — project deadline within threshold
- **Supported actions:**
  - `send_notification` — creates `Notification` row (triggers websocket event to client)
  - `update_field` — upserts `ProjectFieldValue` row

#### `portal/` — Client Portal (Public Access)

Located in `web/back-nest/src/portal/`

- **Admin routes (JWT protected):**
  - `POST /admin/projects/:projectId/portal-tokens` — generate new public access token
  - `GET /admin/projects/:projectId/portal-tokens` — list active tokens
  - `DELETE /admin/portal-tokens/:id` — revoke token
- **Public routes (no auth):**
  - `GET /portal/:token` — fetch project + field values (token validity checked)
  - `POST /portal/:token/signoff` — client submits approval/sign-off
- **Token scheme:** `crypto.randomBytes(32).toString('hex')` (64 hex chars); expiry checked on every request
- **Sign-off model:** `PortalSignoff` — `clientName`, `clientEmail`, `comment`, `isApproved`, `ipAddress`, `signedAt`

**Logs** are written to `C:\ProgramData\Archimed\logs\` (two files: app log and SOAP log).

---

## Frontend (Vue 3 + Vite + NeoLibrary)

> **Note:** Vuetify has been fully removed. The UI library is now `@neolibrary/components` (PrimeVue 4 + Tailwind wrapper, installed from `deign/components-0.2.123448.tgz`).

**Root:** `web/Front/customapp/`

**Commands:**
```bash
npm install
npm run dev          # HTTP dev server on http://localhost:5173
npm run build        # Type-check + Vite build → dist/
npm run test:unit    # Vitest (jsdom environment)
npm run lint         # ESLint --fix
npm run format       # Prettier on src/
```

**Run a single test file:**
```bash
npx vitest run src/components/__tests__/MyComponent.spec.ts
```

### NeoLibrary Component API — Critical Constraints

These constraints are derived from the real `.d.ts` declarations. **Do not guess; use only what is listed here.**

| Component | Key Props / Notes |
|---|---|
| `NeoButton` | `label`, `icon`, `loading`, `disabled`, `outlined`, `text`, `size`. **No `severity="primary"`** — omit `severity` for default teal style. Use `severity="secondary"` / `"danger"` / `"warning"` only |
| `NeoInputText` | `v-model`, `label`, `placeholder`, `disabled`, `class` |
| `NeoSelect` | `v-model`, `options`, `optionLabel`, `optionValue`, `placeholder`, `disabled` |
| `NeoDatePicker` | `v-model` is `string \| string[] \| null` — bind directly to a string field, **not** a `Date` object |
| `NeoTag` | `value`, `severity` (`"success" \| "info" \| "warning" \| "danger" \| "secondary" \| "contrast"`) |
| `NeoMessage` | `severity`, `text` |
| `NeoToast` | Component placed once in layout. Use `useNeoToast()` composable |
| `NeoDialog` | `v-model:visible`, `header`, `modal`, `style` |
| `NeoCard` | Standard card wrapper |

**`useNeoToast()`** — only exposes: `.add({ severity, summary?, detail, life? })`, `.remove(msg)`, `.removeAll()`. **No `.success()` / `.error()` shortcuts.**

**`useNeoConfirm().require(options)`** — returns `void`. Use `accept` callback in options object; do not wrap in `if (await ...)`.

### Architecture

**Plugin setup** (`src/main.ts`):
```ts
import { NeoLibraryThemePlugin } from '@neolibrary/components'
import '@neolibrary/components/style.css'
import 'primeicons/primeicons.css'
app.use(NeoLibraryThemePlugin, { ... })
```

**Router** (`src/router/index.ts`):
- Global `beforeEach` guard fetches `config.json` on first load
- Obtains JWT via `?Guid=...` query param (passed by Elise) or hardcoded dev GUID
- Dev GUID: `3fa85f64-5717-4562-b3fc-2c963f66afa6` — bypasses real Elise in development
- Redirects to `/unauthorized` on auth failure
- `/admin` route → `AdminView.vue`

**Pinia stores:**
- `src/stores/useApp.ts` — JWT, API URL, Elise URL, loading state (original template store)
- `src/stores/userStore.ts` — User list, CRUD operations, immutable state updates
- `src/stores/projectStore.ts` — Project list/detail, CRUD, assign manager, status update

**Type definitions:**
- `src/types/user.types.ts` — `UserRole` enum, `USER_ROLE_LABELS`, `USER_ROLE_OPTIONS`, `UserResponse`, `CreateUserPayload`, `UpdateUserPayload`
- `src/types/project.types.ts` — `ProjectStatus` enum, `PROJECT_STATUS_LABELS`, `PROJECT_STATUS_SEVERITY`, field/value interfaces, request/response types

**Composables:**
- `src/composables/useUserManagement.ts` — Dialog open/close state, form handlers, toast notifications
- `src/composables/useProjectForm.ts` — Reactive form state, client-side validation, submit handlers

### Component Tree (Admin Module)

```
AdminView.vue
├── NeoToast (placed once)
├── Tab: Users
│   ├── UserList.vue          — table with NeoTag role/status badges, edit/delete actions
│   └── UserFormDialog.vue    — create/edit NeoDialog with NeoInputText + NeoSelect
└── Tab: Projects
    ├── ProjectList.vue        — table with NeoTag status badges, action buttons
    ├── ProjectCreateForm.vue  — two-column form with NeoDatePicker (string v-model)
    └── AssignManagerDialog.vue — PM assignment NeoDialog with NeoSelect
```

**Other views:**
- `src/views/CustomActionView.vue` — Main CustomAction panel (NeoInputText, NeoButton, NeoMessage)
- `src/views/UnauthorizedView.vue` — Plain CSS flex layout, no Vuetify
- `src/components/Loader.vue` — Fixed overlay CSS spinner

### Vite Config

```ts
// vite.config.ts
server: { https: false, port: 5173 }  // HTTP only — no mkcert
base: '/Sample/Front/'                 // Must match Elise CustomAction URL
```
Aliases: `@` → `src/`, `~@neoledge` → `node_modules/@neoledge`

Build output: `assets/[name].js`, `assets/[name].js`, `assets/[name].[ext]` (no content hashes — required by Elise deployment).

### New Frontend Features

#### New Composables

**`src/composables/useCollaborationSocket.ts`** — Real-time field collaboration via WebSocket

- Singleton Socket.IO client for `/collaboration` namespace
- **Methods:**
  - `connect()` — establish connection with JWT auth
  - `disconnect()` — close socket
  - `joinProject(projectId)` — listen for project-specific updates
  - `leaveProject(projectId)` — stop listening
  - `sendFieldUpdate(projectId, fieldId, value)` — broadcast field change
  - `sendFieldFocus(projectId, fieldId)` — indicate field focus
  - `sendFieldBlur(projectId, fieldId)` — indicate field blur
- **Reactive state:**
  - `presenceList` (Ref<Array>) — currently active users in project, with initials + color
  - `remoteFieldChange` (reactive object) — listens for incoming field updates from other users

#### New Components

**`src/components/common/PresenceAvatars.vue`** — Presence indicator

- Props: `users` (array of active user objects)
- Displays colored avatar circles with user initials
- Shows up to 5 avatars; overflow badge displays remaining count

**`src/components/pm/MeetingAiPanel.vue`** — AI Meeting Assistant UI

- Props: `projectId`, `meetingId`
- Three tabs:
  1. **Compte-rendu** — markdown-rendered AI summary
  2. **Actions** — table of generated action items with assignee, due date, status
  3. **Décisions & Risques** — list of key decisions and identified risks
- Polling: every 5 seconds while processing; shows loading spinner and progress indicator
- Integrates with `pmStore` AI actions

**`src/components/pm/AutomationSection.vue`** — Workflow Automation Rule Builder

- Rule creation dialog with trigger selector + action selector
- Rules list with toggle (enable/disable) and delete buttons
- Execution logs panel showing recent rule triggers with status + timestamp
- Integrates with `pmStore` automation CRUD actions

**`src/components/admin/PortalTokenManager.vue`** — Public Portal Token Management

- Generate new token button (opens dialog confirming token before display)
- Tokens table: token (masked), created date, expiry, access count
- Copy-to-clipboard button for each token
- Revoke button with confirmation
- Shows portal URL template: `https://app.example.com/portal/{token}`

#### New Views

**`src/views/ClientPortalView.vue`** — Public Client Sign-Off Portal

- Route: `/portal/:token` (no auth required)
- Fetches project + field values via public token endpoint
- **Sections:**
  1. Project phase stepper (visual progress through deployment phases)
  2. Read-only field values display
  3. Sign-off form with client name, email, optional comment
- Submit sign-off button calls backend `/portal/:token/signoff` endpoint
- Success message + redirect to thank-you view on completion

#### New Store

**`src/stores/analyticsStore.ts`** — Analytics Dashboard State

- **State:**
  - `phaseVelocity` — phase completion metrics
  - `bottleneck` — bottleneck heatmap data
  - `deadlineRisk` — at-risk projects
  - `teamWorkload` — team member utilization
  - `loading`, `error` — loading/error states
- **Actions:**
  - `fetchAll()` — runs all 4 analytics endpoints in parallel via `Promise.all()`
  - `fetchPhaseVelocity()`
  - `fetchBottleneck()`
  - `fetchDeadlineRisk()`
  - `fetchTeamWorkload()`
- **Used by:** Admin dashboard analytics view

#### Modified Stores

**`src/stores/pmStore.ts`** — Project Manager Store Extensions

- **New AI state:**
  - `aiProcessing` — boolean flag
  - `aiResults` — meeting summary, action items, decisions
  - `aiPollingInterval` — NodeJS interval handle
- **New AI actions:**
  - `triggerAiAnalysis(meetingId)` — POST to trigger analysis
  - `fetchAiResults(meetingId)` — poll for results until complete
  - `stopAiPolling()` — clear interval
  - `resumeAiPolling()` — restart polling
- **New automation actions:**
  - `fetchAutomationRules(projectId)` — GET rules list
  - `createAutomationRule(projectId, ruleDto)` — POST rule
  - `updateAutomationRule(projectId, ruleId, updates)` — PATCH rule
  - `deleteAutomationRule(projectId, ruleId)` — DELETE rule
  - `toggleAutomationRule(projectId, ruleId)` — PATCH toggle
  - `fetchAutomationLogs(projectId)` — GET execution logs
- Maintains immutability in all state updates

#### Modified Prisma Schema

**New/updated models** (`web/back-nest/prisma/schema.prisma`):

```prisma
model ProjectFieldValue {
  // ... existing fields
  updatedAt DateTime   @updatedAt
  updatedBy String?    // User ID who last modified
}

model AutomationRule {
  id        String    @id @default(cuid())
  projectId String
  project   Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  name      String
  trigger   String    // status_changed | validation_submitted | field_updated | deadline_approaching
  action    String    // send_notification | update_field
  config    Json      // Action parameters (fieldId, updateValue, notificationTemplate, etc.)
  isEnabled Boolean   @default(true)
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
}

model AutomationLog {
  id        String   @id @default(cuid())
  projectId String
  project   Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  ruleId    String
  event     String   // trigger event name
  status    String   // success | failed
  error     String?
  context   Json?    // Debug context
  createdAt DateTime @default(now())
}

model MeetingActionItem {
  id          String   @id @default(cuid())
  transcriptId String
  transcript  MeetingTranscript @relation(fields: [transcriptId], references: [id], onDelete: Cascade)
  title       String
  assignee    String?
  dueDate     DateTime?
  status      String   @default("open") // open | in_progress | completed
  createdAt   DateTime @default(now())
}

model MeetingDecision {
  id          String   @id @default(cuid())
  transcriptId String
  transcript  MeetingTranscript @relation(fields: [transcriptId], references: [id], onDelete: Cascade)
  description String
  impact      String?
  createdAt   DateTime @default(now())
}

model PortalToken {
  id        String   @id @default(cuid())
  projectId String
  project   Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  token     String   @unique
  expiresAt DateTime
  accessCount Int    @default(0)
  lastAccessedAt DateTime?
  createdAt DateTime @default(now())
  createdBy String   // User ID
  signoffs  PortalSignoff[]
}

model PortalSignoff {
  id        String   @id @default(cuid())
  tokenId   String
  token     PortalToken @relation(fields: [tokenId], references: [id], onDelete: Cascade)
  clientName String
  clientEmail String
  comment   String?
  isApproved Boolean
  ipAddress String?
  signedAt  DateTime @default(now())
}

model AnalyticsCache {
  id        String   @id @default(cuid())
  metric    String   // phase_velocity | bottleneck | deadline_risk | team_workload
  data      Json
  expiresAt DateTime
  createdAt DateTime @default(now())
}

model MeetingTranscript {
  // ... existing fields
  aiSummary    String?
  aiStatus     String? // processing | completed | failed
  aiProcessedAt DateTime?
  aiModel      String? // gpt-4o-mini | gemini-1.5-flash
  aiError      String?
  actionItems  MeetingActionItem[]
  decisions    MeetingDecision[]
}
```

---

## Deployment & Packaging

After `npm run build`, run the post-build script:
```bat
web/Back/postBuild.bat
```
This copies the Vue `dist/` output and `Publish/web.config` to `web/Packages/Build/Front/`.

`web/Packages/Config.json` is the Elise deployment configuration. It defines:
- `AppSettings` — key/value overrides for `appsettings.json` (dot-notation paths)
- `CustomActions` — button registration in Elise (action ID, icon, frame size, target scope, URL)

**When renaming for a new client project:**
1. Rename folders, `.sln`, and `.csproj` files
2. Fix all namespaces globally (`namespace Integration.Elise.*`)
3. Update `Config.json` `CustomActions[].url` and `AppSettings` paths
4. Update `vite.config.ts` `base` path to match the new CustomAction URL

---

## Authentication Flow

```
Elise iframe → loads /Sample/Front/?Guid=<token>
  → Vue router beforeEach guard
  → POST /hook/storeNewGuid (dev) or GET /hook/auth?guid=<token>
  → Backend validates GUID with Elise SOAP service → returns JWT
  → Frontend stores JWT in Pinia (useApp store), attaches to all axios requests
  → All API controllers require [Authorize]
  → On completion: window.parent.postMessage('EliseCustomActionDone', '*')
```

---

## Database Setup (first-time)

1. Ensure SQL Server is running locally
2. Verify `appsettings.Development.json` has the correct `ConnectionStrings:DefaultConnection`
3. Run EF Core migration:
   ```bash
   cd web/Back
   dotnet ef database update --project Integration.Elise.Services --startup-project Integration.Elise.Api.Template
   ```
4. Tables created: `AppUsers`, `Projects`, `ProjectFields`, `ProjectFieldValues`

Common connection string variants:
```
# Default SQL Server (Windows Auth)
Server=localhost;Database=NeoLeadgeDeployment;Trusted_Connection=True;TrustServerCertificate=True;

# SQL Express
Server=.\SQLEXPRESS;Database=NeoLeadgeDeployment;Trusted_Connection=True;TrustServerCertificate=True;

# LocalDB
Server=(localdb)\MSSQLLocalDB;Database=NeoLeadgeDeployment;Trusted_Connection=True;TrustServerCertificate=True;
```

---

## Known Issues & Constraints

- **AutoMapper must be ≥ 14.0.0** — the `Integration.Elise.Web.Core` package has a transitive dependency that requires this version. Do not downgrade.
- **HTTPS disabled in dev** — `vite-plugin-mkcert` was removed because its self-signed cert is blocked by browsers. Dev runs on plain HTTP (`http://localhost:5173`).
- **`NeoButton severity="primary"` does not exist** — omit `severity` to get the default teal style.
- **`useNeoToast()` has no shorthand methods** — always use `.add({ severity: 'success' | 'error' | 'info' | 'warn', detail: '...', life: 3000 })`.
- **`NeoDatePicker` v-model must be `string | null`** — do not bind to a `Date` object.
