# NeoLeadge — Deployment Manager

> Full-stack deployment project management platform. Manage users, projects, meetings, AI-powered analysis, real-time collaboration, and client sign-offs.

**Backend** — NestJS (TypeScript) · Prisma 7 · MySQL  
**Frontend** — Vue 3 · TypeScript · NeoLibrary (PrimeVue 4)  
**Transcription** — Python FastAPI · faster-whisper · SpeechBrain  
**Auth** — JWT Bearer · Role-based access control (6 roles)  
**Real-time** — Socket.IO (notifications + collaboration)

---

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [Features](#features)
- [API Reference](#api-reference)
- [Roles & Permissions](#roles--permissions)
- [Configuration](#configuration)
- [Development Guide](#development-guide)
- [Troubleshooting](#troubleshooting)

---

## Overview

NeoLeadge manages the full lifecycle of deployment projects — from initial specification through delivery and client sign-off — with multi-team collaboration, AI meeting analysis, and automated workflows.

```
Draft → InProgress → SpecificationValidation → Realization → DeploymentValidation → Completed
```

---

## Quick Start

### Prerequisites

- [Node.js 18+](https://nodejs.org/)
- [Python 3.10+](https://www.python.org/)
- [XAMPP](https://www.apachefriends.org/) (MySQL on port 3306)

### 1 — Clone

```bash
git clone https://github.com/maatougm/Neoledge.git
cd Neoledge
git checkout nest-back
```

### 2 — Database

Start XAMPP and ensure MySQL is running on port 3306, then:

```bash
C:/xampp/mysql/bin/mysql.exe -u root -h 127.0.0.1 -P 3306 -e "CREATE DATABASE IF NOT EXISTS NeoLeadgeDeployment;"
```

### 3 — Backend (NestJS)

```bash
cd web/back-nest
npm install
cp .env.example .env      # then fill in your values
npx prisma generate
npm run start:dev
# → http://localhost:5122
```

### 4 — Frontend (Vue 3)

```bash
cd web/Front/customapp
npm install
npm run dev
# → http://localhost:5173
```

### 5 — Transcription service (optional — needed for meeting upload)

```bash
cd web/Transcription
pip install -r requirements.txt
uvicorn app:app --port 8000
```

---

## Project Structure

```
Neoledge/
├── README.md
├── CLAUDE.md                    ← Developer reference (architecture, patterns, constraints)
├── CODEBASE_EXPLANATION.md      ← Deep-dive architecture doc
│
└── web/
    ├── back-nest/               ← NestJS backend (ACTIVE)
    │   ├── prisma/
    │   │   └── schema.prisma    ← Database schema (Prisma)
    │   ├── src/
    │   │   ├── app.module.ts    ← Module registry
    │   │   ├── auth/            ← JWT login
    │   │   ├── users/           ← User management
    │   │   ├── projects/        ← Project CRUD, validations, field values
    │   │   ├── meetings/        ← Audio transcription, transcript management
    │   │   ├── ai/              ← AI transcript analysis (OpenAI / Gemini)
    │   │   ├── analytics/       ← Dashboard metrics with caching
    │   │   ├── automation/      ← Workflow rule engine
    │   │   ├── collaboration/   ← Real-time WebSocket field editing
    │   │   ├── portal/          ← Public client sign-off portal
    │   │   ├── notifications/   ← Real-time notification delivery
    │   │   ├── prisma/          ← Global DB client (MariaDB adapter)
    │   │   └── common/          ← Guards, result pattern, utilities
    │   └── .env                 ← Environment variables (not committed)
    │
    ├── Front/customapp/         ← Vue 3 frontend
    │   └── src/
    │       ├── router/          ← Auth guard + role-based routing
    │       ├── stores/          ← Pinia stores (auth, projects, pm, analytics, ...)
    │       ├── views/           ← Page-level components (Admin, PM, Team, Portal)
    │       ├── components/      ← UI components
    │       │   ├── admin/       ← Admin sections, analytics, portal token manager
    │       │   ├── pm/          ← PM questionnaire, meetings, AI panel, automation
    │       │   ├── common/      ← Presence avatars, shared UI
    │       │   └── shared/      ← Reusable base components
    │       ├── composables/     ← useCollaborationSocket, useNotificationSocket, ...
    │       ├── layouts/         ← AppShell, AdminLayout, PmLayout, TeamLayout
    │       └── types/           ← TypeScript interfaces
    │
    ├── Transcription/           ← Python transcription service
    │   ├── app.py               ← FastAPI app
    │   ├── transcriber.py       ← faster-whisper + SpeechBrain pipeline
    │   └── models/              ← SpeechBrain ECAPA model weights
    │
    └── Back/                    ← ASP.NET Core 8 (LEGACY — standby)
```

---

## Features

### Project Management
- 7-stage workflow with enforced phase gates
- Dynamic questionnaires — Static, Dynamic, and Custom field types
- Team validations — each phase requires explicit approval before advancing
- Activity audit feed — every action logged per project
- File attachments, threaded comments, project templates

### Real-time Collaboration
- Live field editing with presence indicators — see who is editing which field
- Colored avatar circles showing active users per project
- Debounced field updates broadcast via WebSocket (`/collaboration` namespace)

### AI Meeting Assistant
- Upload audio recordings → automatic transcription (faster-whisper)
- Speaker diarization (SpeechBrain ECAPA)
- AI analysis via OpenAI GPT-4o-mini or Google Gemini 1.5 Flash
- Extracts: meeting summary (markdown), action items with assignees, key decisions and risks
- Results available via polling or immediate if already processed

### Advanced Analytics (Admin)
- Phase velocity — completion rates per phase
- Bottleneck heatmap — identify process blockers
- Deadline risk scores — projects at risk with days remaining
- Team workload distribution
- 15-minute server-side cache for performance

### Workflow Automation Engine
- Rule builder: choose trigger event + action type + optional condition
- Trigger events: `status_changed`, `validation_submitted`, `field_updated`, `deadline_approaching`
- Actions: `send_notification` (push to user), `update_field` (auto-populate field value)
- Execution logs with success/failed/skipped status per rule

### Client Portal
- Generate shareable token links for clients (configurable expiry)
- Public view of project fields and phase progress — no login required
- Clients submit approval or rejection with optional comment
- Admin can revoke tokens and view access count

### Notifications
- Real-time push via Socket.IO (`/notifications` namespace)
- Triggered by automation rules, project events, and validations

---

## API Reference

All endpoints except `/auth/login`, `GET /portal/:token`, and `POST /portal/:token/signoff` require: `Authorization: Bearer {token}`

### Auth
| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/auth/login` | `{ email, password }` → `{ access_token }` |

### Projects — PM
| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/pm/projects` | My assigned projects |
| `GET` | `/pm/team-projects` | Team projects |
| `GET` | `/pm/projects/:id` | Project detail + validations |
| `PATCH` | `/pm/projects/:id/field-values` | Save questionnaire |
| `POST` | `/pm/projects/:id/fields` | Add custom field |
| `POST` | `/pm/projects/:id/validations` | Submit phase validation |
| `GET` | `/pm/projects/:id/activity` | Activity feed |

### Projects — Admin
| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/admin/projects` | All projects |
| `POST` | `/admin/projects` | Create project |
| `PATCH` | `/admin/projects/:id/status` | Update status |
| `POST` | `/admin/projects/:id/assign-manager` | Assign PM |

### Meetings
| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/pm/projects/:id/meetings/upload` | Upload audio (multipart) |
| `GET` | `/pm/projects/:id/meetings` | List meetings |
| `GET` | `/pm/projects/:id/meetings/:meetingId` | Transcript detail |
| `DELETE` | `/pm/projects/:id/meetings/:meetingId` | Delete |
| `PATCH` | `/pm/projects/:id/meetings/:meetingId/rename-speaker` | Rename speaker |
| `POST` | `/pm/projects/:id/meetings/:meetingId/ai-analyze` | Trigger AI analysis |
| `GET` | `/pm/projects/:id/meetings/:meetingId/ai-results` | Get AI results |

### Analytics (Admin)
| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/analytics/phase-velocity` | Phase completion rates |
| `GET` | `/api/analytics/bottleneck` | Bottleneck heatmap |
| `GET` | `/api/analytics/deadline-risk` | At-risk projects |
| `GET` | `/api/analytics/team-workload` | Team utilization |

### Automation
| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/pm/projects/:id/automation/rules` | List rules |
| `POST` | `/pm/projects/:id/automation/rules` | Create rule |
| `PATCH` | `/pm/projects/:id/automation/rules/:ruleId` | Update rule |
| `DELETE` | `/pm/projects/:id/automation/rules/:ruleId` | Delete rule |
| `PATCH` | `/pm/projects/:id/automation/rules/:ruleId/toggle` | Enable/disable |
| `GET` | `/pm/projects/:id/automation/logs` | Execution logs |

### Client Portal
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/admin/projects/:id/portal-tokens` | JWT | Generate token |
| `GET` | `/admin/projects/:id/portal-tokens` | JWT | List tokens |
| `DELETE` | `/admin/portal-tokens/:id` | JWT | Revoke token |
| `GET` | `/portal/:token` | None | Public project view |
| `POST` | `/portal/:token/signoff` | None | Client sign-off |

---

## Roles & Permissions

| Feature | Admin | ProjectManager | Spec/Real/Deploy Teams | Viewer |
|---------|:-----:|:--------------:|:---------------------:|:------:|
| Dashboard & analytics | ✅ | — | — | — |
| Create / manage projects | ✅ | — | — | — |
| Manage users | ✅ | — | — | — |
| Generate portal tokens | ✅ | — | — | — |
| View assigned projects | ✅ | ✅ | ✅ | ✅ |
| Fill questionnaire | — | ✅ | — | — |
| Add custom fields | — | ✅ *(if allowed)* | — | — |
| Upload meeting recordings | — | ✅ | — | — |
| Trigger AI analysis | — | ✅ | — | — |
| Manage automation rules | ✅ | ✅ *(own projects)* | — | — |
| Submit phase validation | — | — | ✅ | — |
| Post comments | ✅ | ✅ | ✅ | — |

---

## Configuration

### `web/back-nest/.env`

```env
DATABASE_URL=mysql://root:@127.0.0.1:3306/NeoLeadgeDeployment
JWT_SECRET=your-secret-min-32-chars
JWT_EXPIRES_IN=7d
TRANSCRIPTION_URL=http://localhost:8000

# AI Meeting Assistant
AI_ENABLED=true
AI_PROVIDER=openai          # openai | gemini
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...
```

### `web/Front/customapp/public/config.json`

```json
{
  "GLB_API_URL": "http://localhost:5122",
  "GLB_ELISE_URL": "https://your-elise-instance"
}
```

---

## Development Guide

### Backend

```bash
cd web/back-nest

npm run start:dev     # watch mode
npm run build         # production build
npm run lint          # ESLint

# After editing prisma/schema.prisma:
npx prisma generate

# Schema changes on existing DB — use raw SQL, NOT prisma db push:
C:/xampp/mysql/bin/mysql.exe -u root -h 127.0.0.1 -P 3306 NeoLeadgeDeployment -e "ALTER TABLE ..."
```

### Frontend

```bash
cd web/Front/customapp

npm run dev           # http://localhost:5173
npm run build         # production build
npm run lint          # ESLint --fix
npm run format        # Prettier
npm run test:unit     # Vitest
```

### Adding a new NestJS module

1. Create `src/<module>/<module>.service.ts` — use `PrismaService`, return `Result.ok()` / `Result.fail()`
2. Create `src/<module>/<module>.controller.ts` — `@UseGuards(JwtAuthGuard)`, map results to HTTP
3. Create `src/<module>/<module>.module.ts`
4. Add to `imports` in `src/app.module.ts`

---

## Troubleshooting

### `prisma db push` / `prisma migrate` fails

Known issue — FK index drift on the existing DB. Use raw SQL for schema changes:
```bash
C:/xampp/mysql/bin/mysql.exe -u root -h 127.0.0.1 -P 3306 NeoLeadgeDeployment -e "ALTER TABLE ..."
npx prisma generate
```

### Frontend shows blank page or `Failed to fetch`

1. Check backend is running: `http://localhost:5122`
2. Check `public/config.json` — `GLB_API_URL` must be `http://localhost:5122`
3. Open DevTools (F12) → Network for the specific error

### Meeting upload does nothing / 500 error

The transcription service is not running. Start it:
```bash
cd web/Transcription && uvicorn app:app --port 8000
```

### AI analysis stays in "processing" forever

- Check `AI_ENABLED=true` in `.env`
- Check `OPENAI_API_KEY` or `GEMINI_API_KEY` is set and valid
- Check NestJS logs for API errors from the provider

### Port already in use

```bash
# Windows — free a port (example: 5122)
netstat -ano | findstr :5122
taskkill //F //PID <PID>
```

---

## Legacy

`web/Back/` contains the original ASP.NET Core 8 backend built for Elise CustomAction integration. It is **not in active development** and has been superseded by the NestJS backend. Kept for reference only.
