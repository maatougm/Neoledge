# NeoLeadge — Deployment Manager

> Full-stack deployment project management tool embedded inside the **Elise** document management system (Archimed) via iframe.

**Backend** — ASP.NET Core 8 · Entity Framework Core · SQL Server
**Frontend** — Vue 3 · TypeScript · NeoLibrary (PrimeVue 4)
**Auth** — JWT Bearer · Role-based access control (6 roles)

---

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Daily Use](#daily-use)
- [Project Structure](#project-structure)
- [Test Credentials](#test-credentials)
- [Configuration](#configuration)
- [Architecture](#architecture)
- [API Reference](#api-reference)
- [Roles & Permissions](#roles--permissions)
- [Development Guide](#development-guide)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)

---

## Overview

NeoLeadge manages the full lifecycle of Elise deployment projects — from initial specification through deployment and sign-off — with multi-team collaboration and phase-gate validations.

```
Draft → InProgress → SpecificationValidation → Realization → DeploymentValidation → Completed
```

### Key Features

- **Project lifecycle management** — 7-stage workflow with enforced phase gates
- **Role-based access** — 6 roles, each with a dedicated UI view
- **Dynamic questionnaires** — Static, Dynamic and Custom field types per project
- **Team validations** — Each phase requires explicit approval before advancing
- **Activity audit feed** — Every action is logged per project
- **Export** — CSV / JSON / plain-text report downloads
- **File attachments** — Upload, download, categorize per project
- **Threaded comments** — Team discussion with @mentions
- **Project templates** — Reusable custom field sets
- **Dashboard** — Stats, PM workloads, overdue alerts, recent activity

---

## Quick Start

### What the setup script installs automatically

| Tool | Version | How |
|------|---------|-----|
| .NET SDK | 8.x | winget |
| Node.js | LTS (18+) | winget |
| SQL Server Express | 2022 | winget |
| dotnet-ef CLI | latest | dotnet tool |

> **Requirement:** Windows 10/11 with `winget` available (built-in since Windows 11, available on Windows 10 1809+).

### Steps

**1 — Clone**
```bash
git clone https://github.com/maatougm/Neoledge.git
cd Neoledge
```

**2 — Add your secrets**

Open `web\Back\Integration.Elise.Api.Template\appsettings.json` and fill in the values your team lead sent you:

```jsonc
{
  "CustomAction": {
    "APIKey": "← paste here",
    "Jwt": {
      "Key":      "← paste here",
      "Issuer":   "← paste here",
      "Audience": "← paste here"
    }
  },
  "EliseSoapService": {
    "Authentication": {
      "ApplicationKey": "← paste here"
    }
  }
}
```

> `appsettings.json` is in `.gitignore` — it is never committed. You must create it once. The script copies a safe template automatically if the file is missing.

**3 — Run SETUP.bat (one time only)**

Double-click **`SETUP.bat`** from the repo root.

The script will:
1. Install .NET 8 SDK if missing
2. Install dotnet-ef CLI tool if missing
3. Install Node.js LTS if missing
4. Install SQL Server Express if missing
5. Copy config templates if `appsettings.json` is missing
6. Run `dotnet restore` — resolves all NuGet packages including the 6 bundled private Elise packages
7. Run `dotnet build`
8. Run `dotnet ef database update` — creates the SQL Server database and tables
9. Start the backend briefly to trigger `DbSeeder` — inserts 5 test users and sample projects
10. Run `npm install` — installs all frontend dependencies including the bundled NeoLibrary package

---

## Daily Use

Double-click **`LAUNCH.bat`**

Opens two terminal windows and your browser:

| Window | URL | Purpose |
|--------|-----|---------|
| Backend terminal | `http://localhost:5122` | ASP.NET Core API |
| Frontend terminal | `http://localhost:5173` | Vue 3 dev server |
| Browser | `http://localhost:5173` | App UI |
| Swagger | `http://localhost:5122/swagger` | Interactive API docs |

---

## Project Structure

```
Neoledge/
│
├── SETUP.bat                    ← First-time setup (run once)
├── LAUNCH.bat                   ← Daily launcher
├── README.md                    ← This file
├── CODEBASE_EXPLANATION.md      ← Deep-dive architecture doc
│
├── deign/
│   └── components-0.2.123448.tgz   ← NeoLibrary UI package (bundled, private)
│
└── web/
    ├── Back/
    │   ├── NuGet.config             ← Adds LocalPackages as NuGet source
    │   ├── LocalPackages/           ← 6 private Elise .nupkg files (bundled)
    │   │
    │   ├── Integration.Elise.Api.Template/
    │   │   ├── Controllers/         ← 15 REST API controllers
    │   │   ├── Middleware/          ← HeaderMiddleware (Elise iframe headers)
    │   │   ├── Filters/             ← Global exception filter (Serilog)
    │   │   ├── Program.cs           ← App bootstrap, DI, middleware pipeline
    │   │   ├── appsettings.example.json          ← Safe template (committed)
    │   │   └── appsettings.Development.example.json
    │   │
    │   └── Integration.Elise.Services/
    │       ├── DI/ServiceModule.cs  ← Autofac registrations
    │       ├── Infrastructure/      ← DbContext · DbSeeder · Migrations
    │       ├── Interfaces/          ← Service & repository contracts (15 interfaces)
    │       ├── Impl/                ← Repository implementations (5)
    │       ├── Services/            ← Business logic (9 services)
    │       ├── Models/Domain/       ← 10 EF Core entities
    │       ├── Models/DTOs/         ← Data transfer objects
    │       ├── Models/Enums/        ← 5 enumerations
    │       └── Validators/          ← FluentValidation rules (French messages)
    │
    └── Front/customapp/
        └── src/
            ├── router/index.ts      ← Auth guard + role-based routing
            ├── main.ts              ← App bootstrap, NeoLibrary plugin
            ├── stores/              ← 4 Pinia stores
            ├── views/               ← 8 page-level components
            ├── components/          ← 30+ UI components
            │   ├── admin/           ← Admin sections + forms
            │   └── pm/              ← PM questionnaire + validation UI
            ├── composables/         ← Reusable logic hooks
            └── types/               ← TypeScript type definitions
```

### Backend at a glance

| Layer | Files | Responsibility |
|-------|-------|----------------|
| Controllers | 15 | HTTP routing, request/response mapping |
| Services | 9 | Business logic, validation, orchestration |
| Repositories | 5 | EF Core data access, query building |
| Domain models | 10 | Database entities |
| DTOs | ~25 | API contracts, data shaping |
| Validators | 2 | FluentValidation rules (French) |

### Frontend at a glance

| Layer | Files | Responsibility |
|-------|-------|----------------|
| Views | 8 | Page-level components, one per role |
| Components | 30+ | Reusable UI building blocks |
| Stores | 4 | Pinia state (app, users, projects, pm) |
| Composables | 3 | Shared reactive logic |
| Types | 3 | TypeScript interfaces and enums |

---

## Test Credentials

Seeded automatically on first run:

| Email | Password | Role | Access |
|-------|----------|------|--------|
| admin@neoleadge.com | `Admin@123` | Admin | Full access — all features |
| pm@neoleadge.com | `Pm@123` | ProjectManager | Projects 1 & 2 |
| pm2@neoleadge.com | `Pm2@123` | ProjectManager | Projects 3 & 4 |
| valid@neoleadge.com | `Valid@123` | DeploymentTeam | Phase validations |
| newuser@neoleadge.com | `Temp@123` | Viewer | **Must change password on first login** |

**Password rules:** minimum 8 characters · at least 1 uppercase letter · at least 1 digit

---

## Configuration

### `appsettings.json` (secrets — never committed)

```jsonc
{
  "CustomAction": {
    "EnableWebHookCheck": false,   // true in production
    "CheckLocalIp": false,
    "APIKey": "YOUR_API_KEY",
    "Jwt": {
      "Issuer":   "https://your-elise-url/",
      "Audience": "https://your-elise-url/",
      "Key":      "YOUR_JWT_SECRET_MIN_32_CHARS",
      "Expires":  5                // token lifetime in hours
    }
  },
  "EliseSoapService": {
    "Address": "https://your-elise-url/{instance}/Elise/WebServiceApplication/EliseWebService.svc/SOAP",
    "Authentication": {
      "ApplicationID":  "CustomActions",
      "ApplicationKey": "YOUR_ELISE_SOAP_KEY",
      "Instance":       "GED",
      "Language":       "fr-FR"
    }
  }
}
```

### `appsettings.Development.json` (local only — never committed)

```jsonc
{
  "ConnectionStrings": {
    // Pick the one that matches your SQL Server setup:
    "DefaultConnection": "Server=(localdb)\\MSSQLLocalDB;Database=NeoLeadgeDeployment;Trusted_Connection=True;TrustServerCertificate=True;"
    // "DefaultConnection": "Server=.\\SQLEXPRESS;Database=NeoLeadgeDeployment;Trusted_Connection=True;TrustServerCertificate=True;"
    // "DefaultConnection": "Server=localhost;Database=NeoLeadgeDeployment;Trusted_Connection=True;TrustServerCertificate=True;"
  }
}
```

### Frontend `config.json` (`web/Front/customapp/public/config.json`)

```json
{
  "GLB_API_URL":   "http://localhost:5122",
  "GLB_ELISE_URL": "https://your-elise-instance"
}
```

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ASPNETCORE_ENVIRONMENT` | `Development` | Controls which `appsettings.*.json` is loaded |
| `ASPNETCORE_URLS` | `http://localhost:5122` | API binding address |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Browser / Elise iframe                                      │
│  Vue 3 · Pinia · NeoLibrary · http://localhost:5173          │
└───────────────────────────┬──────────────────────────────────┘
                            │  HTTP + Authorization: Bearer {JWT}
┌───────────────────────────▼──────────────────────────────────┐
│  ASP.NET Core 8 API · http://localhost:5122                  │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  15 Controllers  (routing, auth, request/response)      │ │
│  └────────────────────────┬────────────────────────────────┘ │
│                           │                                  │
│  ┌────────────────────────▼────────────────────────────────┐ │
│  │  9 Services  (business logic, validation, result<T>)    │ │
│  └────────────────────────┬────────────────────────────────┘ │
│                           │                                  │
│  ┌────────────────────────▼────────────────────────────────┐ │
│  │  5 Repositories  (EF Core queries, eager loading)       │ │
│  └────────────────────────┬────────────────────────────────┘ │
│                           │                                  │
│  ┌────────────────────────▼────────────────────────────────┐ │
│  │  SQL Server / LocalDB  (10 tables, soft delete)         │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### Authentication flow

```
1. User submits email + password
2. AuthController checks in-memory lockout (5 failed = 15 min lock)
3. AuthService.ValidateCredentialsAsync → BCrypt.Verify against DB
4. If DB unavailable → fallback to hardcoded TestUsers dict (dev only)
5. GenerateJwt → HS256 signed, 5h expiry
6. Frontend stores JWT in Pinia (not localStorage — session only)
7. All subsequent requests: Authorization: Bearer {token}
```

### Key design patterns

| Pattern | Where | Why |
|---------|-------|-----|
| **Result\<T\>** | All services | Explicit error handling, no exceptions in normal flow |
| **Repository** | 5 repos | Decouples EF Core from business logic, testable |
| **Soft delete** | Projects, Comments, Attachments | Data retention, audit trail |
| **Autofac DI** | `ServiceModule.cs` | `InstancePerLifetimeScope` — one instance per HTTP request |
| **AutoMapper 14** | DTO mapping | Clean separation between domain and API contract |
| **FluentValidation** | All inputs | French error messages, reusable rule sets |
| **Phase gate** | Status transitions | Enforces team approval before advancing stages |

### Database schema (10 tables)

```
AppUsers ──────────────────────────────── Projects
    │                                        │
    │  (ProjectManagerId, CreatedByAdmin)     │
    │                                        ├── ProjectFields
    │                                        │       └── ProjectFieldValues
    │                                        ├── ProjectActivities
    │                                        ├── ProjectValidations
    │                                        ├── ProjectComments (self-FK for threading)
    │                                        └── ProjectAttachments

ProjectTemplates
    └── ProjectTemplateFields
```

---

## API Reference

> Full interactive docs at `http://localhost:5122/swagger`

All endpoints except `/auth/login` require: `Authorization: Bearer {token}`

### Authentication

| Method | Route | Body | Returns |
|--------|-------|------|---------|
| `POST` | `/auth/login` | `{ email, password }` | `{ jwt, mustChangePassword }` |
| `POST` | `/auth/change-password` | `{ currentPassword, newPassword }` | `200` or `400` |

### Projects — Admin (`/admin/project`)

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/admin/project` | All projects (summary list) |
| `GET` | `/admin/project/{id}` | Full project detail + field values |
| `GET` | `/admin/project/by-status/{status}` | Filter by status |
| `GET` | `/admin/project/manager/{managerId}` | Filter by PM |
| `POST` | `/admin/project` | Create project (auto-seeds 6 static fields) |
| `PUT` | `/admin/project/{id}` | Update metadata |
| `DELETE` | `/admin/project/{id}` | Soft-delete |
| `POST` | `/admin/project/{id}/assign-manager` | Assign PM |
| `POST` | `/admin/project/{id}/status` | Transition status |
| `PATCH` | `/admin/project/{id}/archive` | Archive project |
| `POST` | `/admin/project/{id}/duplicate` | Clone with new name |
| `POST` | `/admin/project/{id}/fields` | Add custom field |
| `DELETE` | `/admin/project/{id}/fields/{fieldId}` | Remove field |
| `PATCH` | `/admin/project/{id}/toggle-manager-fields` | Allow/deny PM custom fields |
| `GET` | `/admin/project/{id}/activity` | Activity feed |
| `POST` | `/admin/project/bulk-archive` | Archive multiple |
| `POST` | `/admin/project/bulk-status` | Status update for multiple |
| `POST` | `/admin/project/bulk-assign-manager` | Assign PM to multiple |

### Project Manager (`/pm`)

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/pm/projects` | My assigned projects |
| `GET` | `/pm/projects/{id}` | Project detail |
| `PATCH` | `/pm/projects/{id}/field-values` | Save questionnaire answers |
| `POST` | `/pm/projects/{id}/fields` | Add custom field (if allowed) |
| `GET` | `/pm/projects/{id}/validations` | List phase validations |
| `POST` | `/pm/projects/{id}/validations` | Submit approval/rejection |
| `GET` | `/pm/projects/{id}/activity` | Activity feed (own projects only) |

### Users — Admin (`/admin/AppUser`)

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/admin/AppUser` | All active users |
| `GET` | `/admin/AppUser/{id}` | User by ID |
| `GET` | `/admin/AppUser/by-role/{role}` | Filter by role |
| `POST` | `/admin/AppUser` | Create user |
| `PUT` | `/admin/AppUser/{id}` | Update user |
| `DELETE` | `/admin/AppUser/{id}` | Deactivate (soft delete) |
| `POST` | `/admin/AppUser/{id}/reset-password` | Reset to temp password |
| `POST` | `/admin/AppUser/{id}/reactivate` | Reactivate deactivated user |

### User Profile (`/api/userprofile`)

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/userprofile` | My profile |
| `PUT` | `/api/userprofile` | Update profile |
| `POST` | `/api/userprofile/avatar` | Upload avatar (base64) |
| `GET` | `/api/userprofile/preferences` | My preferences |
| `PUT` | `/api/userprofile/preferences` | Update preferences |

### Comments (`/api/projects/{id}/comments`)

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/projects/{id}/comments` | All comments |
| `POST` | `/api/projects/{id}/comments` | Post comment |
| `POST` | `/api/projects/{id}/comments/{commentId}/reply` | Reply to comment |
| `PUT` | `/api/projects/{id}/comments/{commentId}` | Edit comment |
| `DELETE` | `/api/projects/{id}/comments/{commentId}` | Soft-delete comment |

### Attachments (`/api/projects/{id}/attachments`)

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/projects/{id}/attachments` | List attachments |
| `POST` | `/api/projects/{id}/attachments` | Upload (base64) |
| `PATCH` | `/api/projects/{id}/attachments/{attachmentId}` | Update metadata |
| `DELETE` | `/api/projects/{id}/attachments/{attachmentId}` | Soft-delete |
| `GET` | `/api/projects/{id}/attachments/{attachmentId}/download` | Download file |

### Export (`/api/export`)

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/export/projects/csv` | Download CSV (`?ids=` optional) |
| `GET` | `/api/export/projects/json` | Download JSON |
| `GET` | `/api/export/projects/{id}/report` | Plain-text project report |

### Dashboard (`/api/dashboard`)

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/dashboard/stats` | Totals: active, completed, overdue |
| `GET` | `/api/dashboard/by-status` | Count per status |
| `GET` | `/api/dashboard/workloads` | Project count per PM |
| `GET` | `/api/dashboard/recent-activity` | Latest 10 actions |
| `GET` | `/api/dashboard/overdue` | Projects past end date |

### Templates (`/admin/projecttemplate`)

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/admin/projecttemplate` | All templates |
| `GET` | `/admin/projecttemplate/{id}` | Template detail |
| `POST` | `/admin/projecttemplate` | Create template |
| `DELETE` | `/admin/projecttemplate/{id}` | Delete template |
| `POST` | `/admin/projecttemplate/{id}/apply/{projectId}` | Apply to project |

---

## Roles & Permissions

| Feature | Admin | ProjectManager | Spec/Real/Deploy Teams | Viewer |
|---------|:-----:|:--------------:|:---------------------:|:------:|
| Dashboard & stats | ✅ | — | — | — |
| Create / delete projects | ✅ | — | — | — |
| Manage all users | ✅ | — | — | — |
| Create / apply templates | ✅ | — | — | — |
| Export CSV / JSON | ✅ | — | — | — |
| View assigned projects | ✅ | ✅ | ✅ | ✅ |
| Fill questionnaire | — | ✅ | — | — |
| Add custom fields | — | ✅ *(if allowed)* | — | — |
| Submit phase validation | — | — | ✅ | — |
| Post comments | ✅ | ✅ | ✅ | — |
| Upload attachments | ✅ | ✅ | — | — |
| View activity feed | ✅ | ✅ *(own projects)* | — | — |
| Change own password | ✅ | ✅ | ✅ | ✅ |

---

## Development Guide

### Backend

```bash
cd web/Back

# Start API (http://localhost:5122 + https://localhost:44377)
dotnet run --project Integration.Elise.Api.Template --launch-profile http

# Build only
dotnet build

# Add a new EF migration
dotnet ef migrations add YourMigrationName \
  --project Integration.Elise.Services \
  --startup-project Integration.Elise.Api.Template

# Apply pending migrations
dotnet ef database update \
  --project Integration.Elise.Services \
  --startup-project Integration.Elise.Api.Template

# Roll back last migration
dotnet ef migrations remove \
  --project Integration.Elise.Services \
  --startup-project Integration.Elise.Api.Template
```

### Frontend

```bash
cd web/Front/customapp

npm run dev          # Dev server → http://localhost:5173
npm run build        # Type-check + production build → dist/
npm run type-check   # TypeScript check only (no emit)
npm run lint         # ESLint --fix
npm run format       # Prettier on src/
npm run test:unit    # Vitest unit tests
```

### Adding a new backend service

1. Define interface in `Integration.Elise.Services/Interfaces/IMyService.cs`
2. Implement in `Integration.Elise.Services/Services/MyService.cs`
3. Register in `Integration.Elise.Services/DI/ServiceModule.cs`:
   ```csharp
   builder.RegisterType<MyService>().As<IMyService>().InstancePerLifetimeScope();
   ```
4. Inject via constructor in any controller

### Adding a new frontend view

1. Create `src/views/MyView.vue`
2. Add route in `src/router/index.ts`
3. If it needs state, add to an existing Pinia store or create `src/stores/myStore.ts`

### NeoLibrary component rules

| Component | Critical constraint |
|-----------|-------------------|
| `NeoButton` | No `severity="primary"` — omit for default teal |
| `NeoDatePicker` | `v-model` must be `string \| null`, never a `Date` object |
| `NeoTag` | severity: `"success" \| "info" \| "warning" \| "danger" \| "secondary" \| "contrast"` |
| `useNeoToast()` | Only `.add({ severity, detail, life? })` — no `.success()` shorthand |
| `useNeoConfirm()` | `.require()` returns `void` — use the `accept` callback, not `await` |

---

## Troubleshooting

### SETUP.bat — `.NET 8 not found after install`

winget installed it but the current terminal session hasn't picked up the new PATH.

**Fix:** Close the terminal window and double-click `SETUP.bat` again. The script skips already-installed tools.

---

### SETUP.bat — `NuGet restore failed`

The 6 private Elise packages aren't being found.

**Check:** `web\Back\LocalPackages\` must contain all 6 files:
```
Integration.Elise.Web.Core.2.0.50.1.nupkg
Integration.Elise.EliseSoapServiceFacade.2.0.50.1.nupkg
Integration.Elise.InstanceAccess.2.0.50.1.nupkg
Integration.Core.JsonSettings.2.0.50.1.nupkg
Integration.Core.Utilities.2.0.50.1.nupkg
Integration.Core.Utilities.Services.2.0.50.1.nupkg
```

If any are missing, re-clone the repo — they are committed.

---

### SETUP.bat — `EF migration failed`

Wrong SQL Server instance name in the connection string.

**Fix:** Open `appsettings.Development.json` and try each option:

```
Server=(localdb)\MSSQLLocalDB    ← Visual Studio / VS Build Tools LocalDB
Server=.\SQLEXPRESS              ← SQL Server Express
Server=localhost                 ← Default SQL Server instance
```

Re-run `SETUP.bat` — it skips already-installed tools and retries the migration.

> **Note:** Even if the DB never works, the app runs using hardcoded test users. Login works, but writes (create project, save questionnaire, etc.) will fail.

---

### SETUP.bat — `npm install failed`

**Check:** `deign\components-0.2.123448.tgz` must exist in the repo root. If missing, re-clone.

---

### Backend won't start — `Key not found` or `Value cannot be null`

`appsettings.json` is missing or still has placeholder values.

**Fix:** Make sure the file exists and contains the real secrets (not `REPLACE_WITH_...`). Get the values from your team lead.

---

### Login returns `Email ou mot de passe incorrect`

The database is empty — seeding didn't complete.

**Fix:** Run the backend manually and wait for the seed message:
```bash
cd web\Back
dotnet run --project Integration.Elise.Api.Template --launch-profile http
# Wait until you see: DbSeeder — seeded 5 test users
# Then press Ctrl+C and use LAUNCH.bat normally
```

---

### Frontend shows blank page or `Failed to fetch`

The frontend can't reach the backend.

**Checklist:**
1. Is the backend terminal still open and running?
2. Visit `http://localhost:5122/swagger` — if it loads, the API is fine
3. Open browser DevTools (F12) → Console — look for the exact error
4. Check `web/Front/customapp/public/config.json` — `GLB_API_URL` should be `http://localhost:5122`

---

### Port already in use

```powershell
# Free port 5122 (backend)
Get-Process -Id (Get-NetTCPConnection -LocalPort 5122).OwningProcess | Stop-Process -Force

# Free port 5173 (frontend)
Get-Process -Id (Get-NetTCPConnection -LocalPort 5173).OwningProcess | Stop-Process -Force
```

---

### JWT expired — all API calls return 401

Tokens expire after 5 hours.

**Fix:** Log out and log back in to get a new token.

---

### `dotnet-ef` not found when running migrations manually

```bash
dotnet tool install --global dotnet-ef
# Close and reopen the terminal, then:
dotnet ef --version
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for branch naming, commit format, and pull request guidelines.
