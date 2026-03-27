# NeoLeadge — Deployment Manager

A full-stack deployment project management tool embedded inside the **Elise** document management system (by Archimed) via iframe.

- **Backend** — ASP.NET Core 8 Web API (C#)
- **Frontend** — Vue 3 + TypeScript + NeoLibrary (PrimeVue 4)
- **Database** — SQL Server / LocalDB

---

## Table of Contents

- [What it does](#what-it-does)
- [Quick Start (First Time)](#quick-start-first-time)
- [Daily Launch](#daily-launch)
- [Project Structure](#project-structure)
- [Test Credentials](#test-credentials)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [Architecture](#architecture)
- [API Reference](#api-reference)
- [Roles & Permissions](#roles--permissions)

---

## What it does

NeoLeadge lets teams manage the full lifecycle of Elise deployment projects:

| Who | Can do |
|-----|--------|
| **Admin** | Create projects, manage users, assign PMs, view dashboard, export data |
| **Project Manager** | Fill questionnaires, add custom fields, view activity, upload attachments |
| **Spec / Realization / Deployment Teams** | Submit phase validations, post comments |
| **Viewer** | Read-only access |

Projects move through 7 stages: `Draft → InProgress → SpecificationValidation → Realization → DeploymentValidation → Completed → Archived`

---

## Quick Start (First Time)

### Prerequisites

You need these installed before running the setup script:

| Tool | Minimum Version | Check |
|------|----------------|-------|
| Windows 10 / 11 | 1809+ | — |
| winget | any | `winget --version` |

> **Everything else (.NET 8, Node.js, SQL Server) is installed automatically by the setup script.**

### Steps

**1. Clone the repository**

```bash
git clone https://github.com/YOUR_ORG/neoleadge.git
cd neoleadge
```

**2. Add your secrets to `appsettings.json`**

After cloning, open:
```
web\Back\Integration.Elise.Api.Template\appsettings.json
```

Fill in the values your team lead sent you:

```json
{
  "CustomAction": {
    "APIKey": "← paste here",
    "Jwt": {
      "Key": "← paste here",
      "Issuer": "← paste here",
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

**3. Run the setup script (one time only)**

Double-click **`SETUP.bat`** — or right-click → *Run as administrator* if you hit permission errors.

The script will:
- Install .NET 8 SDK (if missing)
- Install Node.js LTS (if missing)
- Install SQL Server Express (if missing)
- Install the `dotnet-ef` CLI tool
- Restore all NuGet packages (including the 6 private Elise packages bundled in the repo)
- Build the backend
- Create and migrate the database
- Seed test users and sample projects
- Install all npm packages (including NeoLibrary)
- Offer to launch the app immediately

---

## Daily Launch

Double-click **`LAUNCH.bat`**

This opens:
- A terminal window running the **backend** on `http://localhost:5122`
- A terminal window running the **frontend** on `http://localhost:5173`
- Your browser at `http://localhost:5173`

---

## Project Structure

```
neoleadge/
├── SETUP.bat                          ← First-time setup (run once)
├── LAUNCH.bat                         ← Daily launcher
├── CODEBASE_EXPLANATION.md            ← Full codebase documentation
├── deign/
│   └── components-0.2.123448.tgz      ← NeoLibrary UI package (bundled)
└── web/
    ├── Back/
    │   ├── Elise projects templates.sln
    │   ├── NuGet.config               ← Points to LocalPackages/
    │   ├── LocalPackages/             ← 6 private Elise .nupkg files
    │   ├── Integration.Elise.Api.Template/
    │   │   ├── Controllers/           ← 13 REST controllers
    │   │   ├── Middleware/
    │   │   ├── Program.cs
    │   │   ├── appsettings.json           ← NOT in git (you create this)
    │   │   ├── appsettings.example.json   ← Template — safe to read
    │   │   ├── appsettings.Development.json       ← NOT in git
    │   │   └── appsettings.Development.example.json
    │   └── Integration.Elise.Services/
    │       ├── DI/ServiceModule.cs    ← Autofac registrations
    │       ├── Infrastructure/        ← DbContext, DbSeeder, Migrations
    │       ├── Interfaces/            ← Service & repository contracts
    │       ├── Impl/                  ← Repository implementations
    │       ├── Services/              ← Business logic
    │       ├── Models/Domain/         ← 10 EF Core entities
    │       ├── Models/DTOs/           ← Data transfer objects
    │       └── Validators/            ← FluentValidation rules (French)
    └── Front/customapp/
        └── src/
            ├── router/index.ts        ← Auth guard + role routing
            ├── stores/                ← 4 Pinia stores
            ├── views/                 ← 8 page views
            ├── components/            ← 30+ UI components
            ├── composables/           ← Reusable logic hooks
            └── types/                 ← TypeScript type definitions
```

---

## Test Credentials

These are seeded automatically on first run:

| Email | Password | Role | Notes |
|-------|----------|------|-------|
| admin@neoleadge.com | Admin@123 | Admin | Full access |
| pm@neoleadge.com | Pm@123 | ProjectManager | Assigned to projects 1 & 2 |
| pm2@neoleadge.com | Pm2@123 | ProjectManager | Assigned to projects 3 & 4 |
| valid@neoleadge.com | Valid@123 | DeploymentTeam | Can submit validations |
| newuser@neoleadge.com | Temp@123 | Viewer | **Must change password on first login** |

---

## Configuration

### Backend — `appsettings.json`

```jsonc
{
  "CustomAction": {
    "EnableWebHookCheck": false,   // Set true in production
    "CheckLocalIp": false,
    "APIKey": "YOUR_API_KEY",
    "Jwt": {
      "Issuer":   "https://your-elise-url/",
      "Audience": "https://your-elise-url/",
      "Key":      "YOUR_JWT_SECRET_MIN_32_CHARS",
      "Expires":  5                // Token lifetime in hours
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

### Backend — `appsettings.Development.json`

```jsonc
{
  "ConnectionStrings": {
    // LocalDB (comes with Visual Studio — default)
    "DefaultConnection": "Server=(localdb)\\MSSQLLocalDB;Database=NeoLeadgeDeployment;Trusted_Connection=True;TrustServerCertificate=True;"

    // SQL Server Express alternative:
    // "DefaultConnection": "Server=.\\SQLEXPRESS;Database=NeoLeadgeDeployment;Trusted_Connection=True;TrustServerCertificate=True;"
  }
}
```

### Frontend

The frontend reads `config.json` at runtime (served from the backend or a static host):

```json
{
  "GLB_API_URL":   "http://localhost:5122",
  "GLB_ELISE_URL": "https://your-elise-instance"
}
```

---

## Troubleshooting

### SETUP.bat — ".NET 8 SDK not found after install"

winget installed it but the current terminal session doesn't see it yet.

**Fix:** Close the terminal and run `SETUP.bat` again. The PATH is updated in new terminals.

---

### SETUP.bat — "NuGet restore failed"

The 6 private Elise packages weren't found.

**Fix:** Make sure `web\Back\LocalPackages\` contains these files:
```
Integration.Elise.Web.Core.2.0.50.1.nupkg
Integration.Elise.EliseSoapServiceFacade.2.0.50.1.nupkg
Integration.Elise.InstanceAccess.2.0.50.1.nupkg
Integration.Core.JsonSettings.2.0.50.1.nupkg
Integration.Core.Utilities.2.0.50.1.nupkg
Integration.Core.Utilities.Services.2.0.50.1.nupkg
```
If any are missing, contact the team lead to re-share the repo.

---

### SETUP.bat — "DB migration failed"

The most common cause is the wrong SQL Server instance name.

**Fix:** Open `web\Back\Integration.Elise.Api.Template\appsettings.Development.json` and try each connection string until one works:

```
Server=(localdb)\MSSQLLocalDB    ← Visual Studio LocalDB
Server=.\SQLEXPRESS              ← SQL Server Express
Server=localhost                 ← Default SQL Server
Server=.\SQLEXPRESS2019          ← Named instance
```

Then re-run `SETUP.bat` — it will skip already-installed tools and retry the migration.

> **Note:** If the DB never works, the app still runs using hardcoded test credentials. All features work except ones that write to the database (creating projects, saving questionnaires, etc).

---

### SETUP.bat — "npm install failed"

The NeoLibrary package `.tgz` file is missing.

**Fix:** Check that `deign\components-0.2.123448.tgz` exists in the repo root. If it was accidentally deleted, get it from the team lead or re-clone the repo.

---

### Backend won't start — "Key not found" / "Value cannot be null"

The `appsettings.json` file is missing or has placeholder values.

**Fix:** Make sure `appsettings.json` exists and has the real JWT key, API key, and Elise SOAP key (not the `REPLACE_WITH_...` placeholders from the example file). Get the real values from your team lead.

---

### Backend starts but login fails — "Email ou mot de passe incorrect"

The database is empty — seeding didn't run.

**Fix:** Stop the backend, then run:
```bash
cd web\Back
dotnet run --project Integration.Elise.Api.Template --launch-profile http
```
Wait ~15 seconds for the app to start and seed. The console will print `DbSeeder — seeded 5 test users`. Then stop it (Ctrl+C) and use `LAUNCH.bat` normally.

---

### Frontend — blank page or "Failed to fetch"

The frontend can't reach the backend.

**Checklist:**
1. Is the backend running? Check the backend terminal for errors.
2. Open `http://localhost:5122/swagger` — if it loads, the backend is fine.
3. Open browser DevTools (F12) → Network tab → look for failed requests.
4. Make sure both terminals from `LAUNCH.bat` are still open.

---

### Port already in use — "Address already in use: 5122" or "5173"

Another process is using the port.

**Fix (PowerShell):**
```powershell
# Kill whatever is on port 5122 (backend)
Get-Process -Id (Get-NetTCPConnection -LocalPort 5122).OwningProcess | Stop-Process

# Kill whatever is on port 5173 (frontend)
Get-Process -Id (Get-NetTCPConnection -LocalPort 5173).OwningProcess | Stop-Process
```

---

### Login works but data doesn't save — "401 Unauthorized"

Your JWT token has expired (5-hour lifetime).

**Fix:** Log out and log back in to get a fresh token.

---

### "dotnet-ef not found" when running migration manually

**Fix:**
```bash
dotnet tool install --global dotnet-ef
# Then close and reopen the terminal
dotnet ef --version
```

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Elise iframe  (production)                         │
│  Browser       (development at localhost:5173)      │
└──────────────────────┬──────────────────────────────┘
                       │ HTTP + JWT Bearer
┌──────────────────────▼──────────────────────────────┐
│  ASP.NET Core 8 API  (localhost:5122)               │
│                                                     │
│  Controllers (13)  →  Services (9)  →  Repos (5)   │
│                              │                      │
│                    EF Core 8 (SQL Server)           │
│                    10 tables, soft delete           │
└─────────────────────────────────────────────────────┘
```

**Key patterns:**
- **Result\<T\>** — every service returns `Result<T>.Ok(data)` or `Result<T>.Fail("message")` — no exceptions in normal flow
- **Soft delete** — projects, comments, attachments use `IsDeleted` flag, never hard-deleted
- **Autofac DI** — `InstancePerLifetimeScope` (one instance per HTTP request)
- **AutoMapper 14** — entity ↔ DTO mapping via profiles
- **FluentValidation** — all validation rules written in French
- **JWT** — stateless auth, 5-hour tokens, HS256 signed

---

## API Reference

Base URL: `http://localhost:5122`

Interactive docs: `http://localhost:5122/swagger`

### Auth

| Method | Route | Body | Description |
|--------|-------|------|-------------|
| POST | `/auth/login` | `{ email, password }` | Login, returns JWT |
| POST | `/auth/change-password` | `{ currentPassword, newPassword }` | Change password |

### Projects (Admin)

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/admin/project` | List all projects |
| GET | `/admin/project/{id}` | Project detail with fields |
| POST | `/admin/project` | Create project |
| PUT | `/admin/project/{id}` | Update project |
| DELETE | `/admin/project/{id}` | Soft-delete project |
| POST | `/admin/project/{id}/assign-manager` | Assign project manager |
| POST | `/admin/project/{id}/status` | Update status |
| POST | `/admin/project/{id}/duplicate` | Duplicate project |
| POST | `/admin/project/bulk-archive` | Archive multiple |
| POST | `/admin/project/bulk-status` | Update status for multiple |

### Project Manager

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/pm/projects` | My assigned projects |
| PATCH | `/pm/projects/{id}/field-values` | Save questionnaire answers |
| POST | `/pm/projects/{id}/fields` | Add custom field |
| GET | `/pm/projects/{id}/validations` | List validations |
| POST | `/pm/projects/{id}/validations` | Submit validation |
| GET | `/pm/projects/{id}/activity` | Activity feed |

### Users (Admin)

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/admin/AppUser` | List all users |
| POST | `/admin/AppUser` | Create user |
| PUT | `/admin/AppUser/{id}` | Update user |
| DELETE | `/admin/AppUser/{id}` | Deactivate user |
| POST | `/admin/AppUser/{id}/reset-password` | Reset to temp password |

### Export

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/export/projects/csv` | Download CSV (`?ids=...` optional) |
| GET | `/api/export/projects/json` | Download JSON |
| GET | `/api/export/projects/{id}/report` | Plain-text project report |

### Dashboard

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/dashboard/stats` | Overall statistics |
| GET | `/api/dashboard/workloads` | PM project counts |
| GET | `/api/dashboard/recent-activity` | Latest 10 actions |
| GET | `/api/dashboard/overdue` | Projects past end date |

---

## Roles & Permissions

| Feature | Admin | ProjectManager | Spec/Real/Deploy Team | Viewer |
|---------|:-----:|:--------------:|:---------------------:|:------:|
| View dashboard | ✅ | — | — | — |
| Create / delete projects | ✅ | — | — | — |
| Manage users | ✅ | — | — | — |
| Create templates | ✅ | — | — | — |
| Export data | ✅ | — | — | — |
| View assigned projects | ✅ | ✅ | ✅ | ✅ |
| Fill questionnaire | — | ✅ | — | — |
| Add custom fields | — | ✅ (if allowed) | — | — |
| Submit phase validation | — | — | ✅ | — |
| Post comments | ✅ | ✅ | ✅ | — |
| Upload attachments | ✅ | ✅ | — | — |

---

## Development Commands

### Backend

```bash
cd web/Back

# Run
dotnet run --project Integration.Elise.Api.Template --launch-profile http

# Build only
dotnet build

# Add a new migration
dotnet ef migrations add MigrationName \
  --project Integration.Elise.Services \
  --startup-project Integration.Elise.Api.Template

# Apply migrations
dotnet ef database update \
  --project Integration.Elise.Services \
  --startup-project Integration.Elise.Api.Template
```

### Frontend

```bash
cd web/Front/customapp

npm run dev          # Dev server at http://localhost:5173
npm run build        # Production build → dist/
npm run type-check   # TypeScript check only
npm run lint         # ESLint fix
npm run test:unit    # Vitest unit tests
```

---

## Notes for New Developers

- **Never commit `appsettings.json` or `appsettings.Development.json`** — they contain secrets and are in `.gitignore`.
- **NeoLibrary component constraints** — `NeoButton` has no `severity="primary"`. `NeoDatePicker` v-model must be `string | null`, not a `Date`. See `CODEBASE_EXPLANATION.md` for the full list.
- **Password rules** — minimum 8 characters, 1 uppercase letter, 1 digit. Enforced both in the validator and the service layer.
- **Logs** are written to `C:\ProgramData\Archimed\logs\` — two rolling daily files (app log + SOAP log).
- **The app works without a database** — it falls back to hardcoded test users if SQL Server is unreachable. Useful for pure frontend work.
