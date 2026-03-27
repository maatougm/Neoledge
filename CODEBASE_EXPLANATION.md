# NeoLeadge — Deployment Manager: Full Codebase Explanation

## What This App Does

A **deployment project management tool** embedded inside the Elise document management system (by Archimed) via iframe. Admins create and oversee deployment projects; project managers fill out questionnaires; teams validate each phase before the project can advance.

---

## Backend (ASP.NET Core 8 / C#)

### Two projects in the solution:

- **`Integration.Elise.Api.Template`** — the HTTP host
- **`Integration.Elise.Services`** — all business logic, DB access, models

---

### Controllers (13 total)

| Controller | Route | What it does |
|---|---|---|
| `AuthController` | `/auth` | Login, JWT generation, password change, 5-attempt lockout (15 min) |
| `ProjectController` | `/admin/project` | Full project CRUD, status transitions, field management, bulk ops, duplication |
| `ProjectManagerController` | `/pm` | PM-specific: questionnaire saves, custom fields, validations, activity — all ownership-checked |
| `DashboardController` | `/api/dashboard` | Stats, overdue alerts, PM workloads, recent activity |
| `ExportController` | `/api/export` | CSV/JSON file downloads, plain-text reports |
| `CommentsController` | `/api/projects/{id}/comments` | Threaded comments with soft delete |
| `AttachmentController` | `/api/projects/{id}/attachments` | Upload/download/delete files (base64) |
| `ProjectTemplateController` | `/admin/projecttemplate` | Create/apply reusable field templates |
| `UserProfileController` | `/api/userprofile` | Profile, avatar upload, preferences, password change |
| `AppUserController` | `/admin/AppUser` | User CRUD, role management |
| `SecurityController` | `/api/security` | View failed login tracker (admin debug) |
| `EliseInteractionController` | `/hook/*` | Elise iframe handshake (GUID → JWT exchange) |
| `HomeController` | `/` | Redirects to Swagger |

---

### Domain Models (10 entities in SQL Server)

```
AppUser           — users, BCrypt passwords, 6 roles, profile fields
Project           — core aggregate, soft delete, 7-stage status
ProjectField      — field schema (label, type, required, options JSON)
ProjectFieldValue — runtime values for fields (stored as string)
ProjectValidation — team approval records per phase
ProjectActivity   — audit log (who did what, when)
ProjectTemplate   — reusable custom field sets
ProjectTemplateField — fields within a template
ProjectComment    — threaded discussion with mentions
ProjectAttachment — uploaded files with metadata
```

**Key relationships:**
- Project has one ProjectManager (AppUser) and one CreatedByAdmin (AppUser) — both use `NoAction` cascade to avoid multi-cascade-path SQL errors
- Project → ProjectField → ProjectFieldValue — cascade delete on removal
- ProjectComment has a self-FK (`ParentCommentId`) for threading

---

### Enums

| Enum | Values |
|---|---|
| `UserRole` | Admin, ProjectManager, SpecificationTeam, RealizationTeam, DeploymentTeam, Viewer |
| `ProjectStatus` | Draft → InProgress → SpecificationValidation → Realization → DeploymentValidation → Completed → Archived |
| `FieldType` | Text, Number, Date, Select, Checkbox |
| `FieldCategory` | Static (system-seeded), Dynamic (admin), Custom (PM if allowed) |
| `ProjectPriority` | Low, Medium, High, Critical |

---

### Services & Repositories

**Services (business logic):**

| Service | Responsibility |
|---|---|
| `ProjectService` | Lifecycle, duplication, bulk ops, soft delete, field management |
| `AuthService` | BCrypt validation against DB |
| `AppUserService` | User CRUD |
| `DashboardService` | Metrics, workloads, overdue alerts |
| `ExportService` | CSV/JSON/text report generation |
| `ProjectTemplateService` | Template CRUD and application to projects |
| `CommentService` | Threaded comment CRUD |
| `AttachmentService` | File upload/download/storage stats |
| `UserProfileService` | Profile updates, avatar, preferences, password change (8 chars + uppercase + digit) |

**Repositories (data access):**
- `ProjectRepository`, `AppUserRepository`, `ProjectValidationRepository`, `ProjectActivityRepository`, `ProjectTemplateRepository`

**Result pattern** — every service returns `Result<T>` or `Result`:
```csharp
Result<T>.Ok(data)      // success
Result<T>.Fail("msg")   // failure
```
Controllers check `result.IsSuccess` → `Ok(result.Value)` or `BadRequest(result.Error)`.

---

### Authentication Flow

```
POST /auth/login { email, password }
  → Check in-memory lockout tracker
  → Try DB: BCrypt.Verify(password, user.PasswordHash)
  → If DB unavailable: fall back to hardcoded TestUsers dict (dev only)
  → Generate JWT (5h expiry, HS256, claims: sub, email, role, firstName, lastName)
  → Return { jwt, mustChangePassword }

All subsequent requests:
  Authorization: Bearer {token}
  → JWT middleware validates signature
  → Controller reads CurrentUserId from "sub" claim
  → [Authorize(Roles = "...")] enforced per endpoint
```

**Test credentials (seeded at startup):**

| Email | Password | Role |
|---|---|---|
| admin@neoleadge.com | Admin@123 | Admin |
| pm@neoleadge.com | Pm@123 | ProjectManager |
| pm2@neoleadge.com | Pm2@123 | ProjectManager |
| valid@neoleadge.com | Valid@123 | DeploymentTeam |
| newuser@neoleadge.com | Temp@123 | Viewer (force-change on first login) |

---

### DI & Startup (Program.cs)

- **Autofac** — two modules: `ServiceModule` (all services + repos + AutoMapper) + `BaseEliseWebApplicationModule` (Elise infrastructure)
- **EF Core** — SQL Server, migrations live in `Integration.Elise.Services`
- **JSON** — camelCase + string enum serialization (`JsonStringEnumConverter`)
- **CORS** — localhost:5173 allowed in dev
- **Serilog** — structured logging to console + file (`C:\ProgramData\Archimed\logs\`)
- **DbSeeder** — runs at startup if `AppUsers` table is empty, seeds 5 users + sample projects
- **Soft delete** — global EF query filter on Projects, Comments, Attachments (`HasQueryFilter(x => !x.IsDeleted)`)

---

### Validators (FluentValidation, French messages)

- `CreateUserValidator` — password: min 8 chars, 1 uppercase, 1 digit
- `UpdateUserValidator` — optional field checks
- `ProjectValidator` — StartDate must be before EndDate

---

### AutoMapper Profiles

- **`ProjectMappingProfile`** — Project → ProjectSummaryDto, Project → ProjectDetailDto (with nested PM + fields), ProjectActivity → ProjectActivityDto, ProjectTemplate → ProjectTemplateSummaryDto
- **`AppUserMappingProfile`** — AppUser → UserResponseDto

---

## Frontend (Vue 3 + TypeScript + NeoLibrary)

### Views (8)

| View | Route | Who sees it |
|---|---|---|
| `LoginView` | `/login` | Everyone (public) |
| `CustomActionView` | `/` | All authenticated (role-based landing) |
| `AdminView` | `/admin` | Admin only |
| `ProjectManagerView` | `/pm` | ProjectManager |
| `TeamMemberView` | `/team` | Spec/Realization/Deployment teams |
| `UserProfileView` | `/profile` | All authenticated |
| `ForceChangePasswordView` | `/force-change-password` | Users with MustChangePassword=true |
| `UnauthorizedView` | `/unauthorized` | Public (error page) |

---

### AdminView — 7 Sidebar Sections

1. **DashboardSection** — stats cards, PM workload table, recent activity
2. **ProjectManagementSection** → `ProjectList`, `ProjectDetailPanel`, `ProjectCreateForm`
3. **UserManagementSection** → `UserList`, `UserFormDialog`, `AssignManagerDialog`
4. **TemplatesSection** — create/list/apply reusable field templates
5. **LogsSection** — full audit activity log
6. **AnalyticsSection** — trends and metrics
7. **SystemStatusSection** — DB health, log viewer

---

### Pinia Stores (4)

**`useApp`**
- Holds: JWT, API URL, Elise URL, `mustChangePassword` flag, loading state
- Actions: `login()`, `logout()`, `fetchJwt(guid)`, `fetchApiUrl()`
- Computed: `userRole` (decoded from JWT), `authHeader()`

**`useUserStore`**
- Holds: user list
- Actions: `fetchAll()`, `createUser()`, `updateUser()`, `deactivateUser()`
- Computed: `activeUsers`, `projectManagers`

**`useProjectStore`**
- Holds: project list, current project detail, activities, templates
- Actions: `fetchAll()`, `createProject()`, `updateProject()`, `deleteProject()`, `assignManager()`, `updateStatus()`, `addField()`, `duplicateProject()`, `bulkArchive()`, `bulkStatus()`, `bulkAssignManager()`, `fetchActivity()`, template methods
- Computed: `draftProjects`, `activeProjects`

**`usePmStore`**
- Holds: PM's own projects only
- Actions: `fetchMyProjects()`, `saveFieldValues()`, `addCustomField()`, `submitValidation()`, `fetchActivity()`

---

### Router Auth Guard (`router.beforeEach`)

1. Skip guard for `/login`, `/unauthorized`, `/force-change-password`
2. Fetch `config.json` for API URL (once per session)
3. No JWT → check for Elise `?Guid=` in query string → exchange for JWT
4. No GUID → auto-login with dev credentials
5. Redirect to role-appropriate view (`/admin`, `/pm`, `/team`)

---

### Key TypeScript Types

```typescript
type UserRole =
  | 'Admin'
  | 'ProjectManager'
  | 'SpecificationTeam'
  | 'RealizationTeam'
  | 'DeploymentTeam'
  | 'Viewer'

type ProjectStatus =
  | 'Draft'
  | 'InProgress'
  | 'SpecificationValidation'
  | 'Realization'
  | 'DeploymentValidation'
  | 'Completed'
  | 'Archived'

type FieldType = 'Text' | 'Number' | 'Date' | 'Select' | 'Checkbox'
type FieldCategory = 'Static' | 'Dynamic' | 'Custom'
```

---

### NeoLibrary Component Constraints

| Component | Key Notes |
|---|---|
| `NeoButton` | No `severity="primary"` — omit for default teal. Use `"secondary"`, `"danger"`, `"warning"` only |
| `NeoDatePicker` | `v-model` must be `string \| null`, NOT a `Date` object |
| `NeoTag` | `severity`: `"success" \| "info" \| "warning" \| "danger" \| "secondary" \| "contrast"` |
| `useNeoToast()` | Only `.add({ severity, detail, life? })` — no `.success()` / `.error()` shortcuts |
| `useNeoConfirm()` | `.require(options)` returns `void` — use `accept` callback, not `await` |

---

## End-to-End Data Flow Examples

### Create Project
```
Admin fills ProjectCreateForm
  → useProjectStore.createProject(payload)
  → POST /admin/project  (with JWT)
  → ProjectController extracts CurrentUserId from JWT sub claim
  → ProjectService.CreateProjectAsync(adminId, dto)
      - validates StartDate < EndDate
      - validates ProjectManagerId is a valid PM user
      - saves Project entity to DB
      - auto-seeds 6 Static fields (Description, Budget, Type, etc.)
      - writes ProjectActivity record: Action="ProjectCreated"
  → returns ProjectDetailDto (201 Created)
  → store updates, success toast shown, navigates to detail view
```

### PM Saves Questionnaire
```
PM edits QuestionnaireForm
  → usePmStore.saveFieldValues(projectId, [{ fieldId, value }, ...])
  → PATCH /pm/projects/{id}/field-values  (with JWT)
  → ProjectManagerController checks:
      project.ProjectManagerId == CurrentUserId  →  else 403 Forbid
  → ProjectRepository.SaveFieldValuesAsync()  →  upserts ProjectFieldValue rows
  → 204 No Content
```

### Export CSV
```
Admin clicks Export
  → GET /api/export/projects/csv?ids=...
  → ExportService.ExportToCsvAsync(ids)
      - queries projects with ProjectManager (eager loaded)
      - builds UTF-8 BOM CSV (header row + one row per project)
  → File(bytes, "text/csv; charset=utf-8", "projets_20260327.csv")
  → browser triggers file download
```

### Team Validation
```
DeploymentTeam member approves a project
  → POST /pm/projects/{id}/validations { isApproved: true, comment: "OK" }
  → Extracts role from JWT claim
  → Creates ProjectValidation:
      { Phase = current project status, IsApproved = true, ValidatedByRole = "DeploymentTeam" }
  → Saved to DB, returns ProjectValidationDto
```

### Force Password Change (New User)
```
newuser@neoleadge.com logs in with Temp@123
  → Login response: { jwt, mustChangePassword: true }
  → useApp sets mustChangePassword = true
  → Router redirects to /force-change-password
  → User submits new password (8+ chars, 1 uppercase, 1 digit)
  → POST /auth/change-password { currentPassword, newPassword }
  → UserProfileService: skips BCrypt verify (MustChangePassword=true)
  → Hashes new password, sets MustChangePassword = false
  → User redirected to their role view
```

---

## Security Measures

| Measure | Implementation |
|---|---|
| Password hashing | BCrypt (salted, irreversible) |
| Account lockout | 5 failed attempts → 15 min lock (in-memory tracker) |
| JWT expiry | 5 hours |
| Password complexity | Min 8 chars + 1 uppercase + 1 digit (enforced in service + validator) |
| Role-based access | `[Authorize(Roles = "...")]` on every controller/endpoint |
| Ownership checks | PM endpoints verify `project.ProjectManagerId == CurrentUserId` |
| Soft delete | Data never permanently lost — IsDeleted flag + EF query filter |
| CORS | Locked to configured origins only |

---

## Architecture Summary

| Concern | Approach |
|---|---|
| ORM | EF Core 8 with eager loading, global query filters for soft delete |
| DI | Autofac, `InstancePerLifetimeScope` (scoped per HTTP request) |
| Mapping | AutoMapper 14 profiles (entity → DTO) |
| Validation | FluentValidation (French messages) + service-layer checks |
| Error handling | `Result<T>` monad — no exceptions in normal flow |
| Auth | JWT stateless, claims-based, 5h expiry |
| Audit | `ProjectActivity` records every significant action |
| State (frontend) | Pinia stores — immutable updates, no direct mutation |
| UI library | NeoLibrary (PrimeVue 4 + Tailwind CSS wrapper) |
| Logging | Serilog structured logging → `C:\ProgramData\Archimed\logs\` |

---

## Database Tables

```
AppUsers              — user accounts
Projects              — deployment projects (soft delete)
ProjectFields         — field definitions per project
ProjectFieldValues    — questionnaire answers
ProjectValidations    — team approval records
ProjectActivities     — audit log
ProjectTemplates      — reusable field sets
ProjectTemplateFields — fields within templates
ProjectComments       — threaded discussion (soft delete)
ProjectAttachments    — uploaded files (soft delete)
```

**Migrations:**
- `20260326000000_InitialCreate` — base schema
- `20260327000000_AddProfileFieldsAndNewTables` — avatar, preferences, comments, attachments, soft delete, priority, tags

---

## Project File Structure

```
web/
├── Back/
│   ├── Integration.Elise.Api.Template/
│   │   ├── Controllers/          (13 controllers)
│   │   ├── Filters/              (ModelStateExceptionFilterAttribute)
│   │   ├── Middleware/           (HeaderMiddleware)
│   │   └── Program.cs
│   └── Integration.Elise.Services/
│       ├── DI/ServiceModule.cs   (Autofac registration)
│       ├── Infrastructure/       (DbContext, DbSeeder, Migrations)
│       ├── Interfaces/           (service + repository contracts)
│       ├── Impl/                 (repository implementations)
│       ├── Services/             (business logic implementations)
│       ├── Models/Domain/        (10 EF Core entities)
│       ├── Models/DTOs/          (20+ DTOs)
│       ├── Models/Enums/         (5 enums)
│       └── Validators/           (FluentValidation rules)
└── Front/customapp/
    └── src/
        ├── router/index.ts       (auth guard + role routing)
        ├── main.ts               (app bootstrap)
        ├── stores/               (4 Pinia stores)
        ├── views/                (8 page views)
        ├── components/admin/     (admin sections + project/user forms)
        ├── components/pm/        (PM questionnaire + validation UI)
        ├── composables/          (useDarkMode, useProjectForm, useUserManagement)
        └── types/                (user.types.ts, project.types.ts)
```
