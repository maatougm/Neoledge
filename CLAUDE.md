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
