# NeoLeadge — Deployment Manager

Full-stack project management platform for deployment projects. Manage projects, work packages, sprints, Gantt timelines, time tracking, AI-driven cahier des charges, live meetings with AI transcription, and real-time collaboration.

**Live:** https://neoleadge.pythagore-init.com

## Stack

| Layer | Tech |
|-------|------|
| Backend | NestJS 11 (TypeScript) + Prisma 7 + PostgreSQL |
| Frontend | Vue 3 + Vite + Pinia + TypeScript + NeoLibrary (PrimeVue 4) |
| Real-time | Socket.IO — notifications + collaboration namespaces |
| Auth | JWT + role-based access control (4 roles) |
| Transcription | Python FastAPI + faster-whisper + SpeechBrain (optional) |
| Infrastructure | Docker Compose + Caddy reverse proxy + Let's Encrypt |

## Quick Start (local development)

**Prerequisites:** Node 22+, PostgreSQL 16 with the `pgvector` extension (local install or Docker), database `neoleadge`.

```bash
# Backend
cd web/back-nest
cp .env.example .env          # set DATABASE_URL, JWT_SECRET
npm install
npx prisma generate
npm run start:dev             # http://localhost:5122

# Frontend
cd web/Front/customapp
npm install
npm run dev                   # http://localhost:5173

# Seed demo data
cd web/back-nest
npx tsx prisma/seed.ts
npx tsx prisma/seed-openproject.ts
npx tsx prisma/seed-notifications.ts
```

Login: `admin@neoleadge.com` / `Admin@123`

## Project Structure

```
neoleadge/
  web/
    back-nest/              NestJS backend (port 5122)
      src/
        auth/               JWT login, TOTP 2FA
        users/              User CRUD (Admin)
        projects/           Projects + PM endpoints
        work-packages/      Issues/tasks with hierarchy, deps, watchers
        agile/              Boards, columns, sprints, burndown
        gantt/              Gantt timeline + milestones + baselines
        time-tracking/      Time entries
        cahier-des-charges/ AI-generated cahier (SSE streaming) + spec review
        team-planner/       Capacity, assignments, conflicts
        meetings/           Live meeting capture + transcription + agenda + outcomes
        ai/                 AI: transcript analysis, backlog, assignment, embeddings
        analytics/          Dashboard metrics (cached 15min)
        automation/         Workflow rule engine
        collaboration/      WebSocket real-time collab
        notifications/      In-app notifications + socket push
        search/             Global search (projects, WPs, users)
        health/             /health endpoint
        prisma/             Global Prisma client (@prisma/adapter-pg)
      prisma/
        schema.prisma           PostgreSQL schema (single source of truth)
        migrations/             Tracked Prisma migrations (migrate deploy)
        seed.ts                 Core demo data (users, projects, fields)
        seed-openproject.ts     WPs, sprints, milestones, time, meeting extras
        seed-notifications.ts   Demo notifications
      Dockerfile              Multi-stage prod build
    Front/customapp/        Vue 3 SPA
      src/
        views/              25 page components
        components/         Admin, PM, common, shared UI
        stores/             18 Pinia stores
        composables/        Socket.IO, keyboard shortcuts, dark mode
        layouts/            AppShell, Sidebar, Topbar, role layouts
        router/             49 named routes with role guards
        lib/                API client, JWT helpers, date formatters
      Dockerfile            Vite build + nginx serve
      nginx.prod.conf       SPA + API proxy + Socket.IO
    Transcription/          Python FastAPI (optional, port 8000)
  deploy/neoleadge/         Production deployment config
    docker-compose.prod.yml 3-container stack (Postgres + NestJS + nginx)
    Caddyfile               TLS reverse proxy for both apps
    .env.prod.example       Environment template
    README.md               Deploy runbook
  .github/workflows/ci.yml  Build + lint + test + 9 Playwright smoke harnesses
```

## Features (25 pages)

### Admin
- Dashboard with analytics (phase velocity, bottleneck, deadline risk, workload)
- Project CRUD with soft-delete + trash/restore
- User management (create, edit, deactivate, password reset)
- Templates for project field presets
- System status + audit log
- Team planner (capacity heatmap, assignment conflicts)

### Project Manager
- Project list + overview with tile grid
- Work Packages — split-panel list/detail, create/edit/delete, custom fields, watchers, dependencies
- Gantt — timeline with zoom, milestones, baseline capture + drift comparison
- Kanban Board — drag-drop cards between columns, real-time sync across users
- Backlog — unassigned WPs + sprint drag-drop assignment
- Sprint Board — sprint selector, metadata, burndown chart (ideal vs remaining)
- Cahier des Charges — AI-generated spec (SSE streaming) + spec-team review/approval
- Backlog Generator — AI-proposed epics + tasks, drag-drop assignment to members
- Time Tracking — log entries, weekly grid, project summary by user/activity
- Members — project team roster
- Activity — project timeline feed
- Meetings — live capture (browser audio), real-time AI transcription (faster-whisper), speaker diarization, AI analysis (action items + decisions), agenda + attendees + outcomes
- Automation — rule builder (trigger events, conditions, actions), execution logs
- My Tasks — cross-project assigned work packages
- Team Planner — capacity + assignment view

### Team Members (Member / SpecificationTeam)
- Project list (role-scoped)
- Project detail with questionnaire
- SpecificationTeam: cahier review queue + "Mes validations" history

### Public
- Login with quick-access demo buttons + TOTP 2FA support

## Roles

| Role | Access |
|------|--------|
| Admin | Full access to all modules + system management |
| ProjectManager | Own projects + all project modules + team planner |
| SpecificationTeam | Assigned projects + cahier des charges review/validation |
| Member | Assigned projects + task execution (work packages, board, sprints) |

## Real-time Features

- **Notifications** — Socket.IO `/notifications` namespace, JWT room auth, toast + bell counter
- **Collaboration** — Socket.IO `/collaboration` namespace, field focus indicators, presence avatars, live Kanban card-move sync across users

## Production Deployment

Deployed at `https://neoleadge.pythagore-init.com` alongside School Hub (`pythagore-init.com`) on the same VPS with zero interference.

```
neoleadge_postgres    PostgreSQL 16   384 MB limit
neoleadge_server      NestJS          768 MB limit
neoleadge_web         nginx + Vite    128 MB limit
caddy                 TLS terminator  host-level, routes by Host header
```

See `deploy/neoleadge/README.md` for the full deploy + update + rollback runbook.

## API Overview

70+ REST endpoints organized by module. Key routes:

- `POST /auth/login` — JWT authentication
- `GET/POST/PUT /admin/project` — project CRUD
- `GET/POST/PATCH/DELETE /pm/projects/:id/work-packages` — work package CRUD
- `GET /pm/projects/:id/gantt` — Gantt payload
- `GET/POST /pm/projects/:id/boards` — Kanban boards
- `PATCH /pm/projects/:id/boards/:id/cards/:wpId/move` — card drag-drop
- `GET /pm/projects/:id/cahier-des-charges/preview-stream` — AI cahier (SSE)
- `GET /spec/pending-reviews` — spec-team cahier review queue
- `GET/POST /api/time-entries` — time tracking
- `GET /api/analytics/*` — dashboard metrics
- `GET /health` — server health check

Full API documentation available at `/api` (Swagger UI) when the backend is running.

## Testing

9 Playwright smoke harnesses + Jest backend tests:

| Harness | Coverage |
|---------|----------|
| `smoke-test.mjs` | 25 routes + 3 interactive flows |
| `smoke-mutations.mjs` | 8 CRUD operations |
| `smoke-a11y.mjs` | axe-core WCAG 2.1 AA |
| `smoke-darkmode.mjs` | All routes in dark mode |
| `smoke-mobile.mjs` | iPhone SE viewport + overflow detection |
| `smoke-rbac.mjs` | 6 roles x API+UI matrix (85+75 cases) |
| `smoke-public.mjs` | Login, lockout flows |
| `smoke-every-button.mjs` | 48 clickable elements |
| `smoke-collab.mjs` | Two-browser real-time card move |
| Jest (backend) | 1600+ specs (mocked Prisma) |
| Vitest (frontend) | 860+ specs |

## Database

- **Local dev & production:** PostgreSQL 16 + `pgvector` (HNSW) for semantic retrieval
- **ORM:** Prisma 7 via `@prisma/adapter-pg`. Schema changes use tracked migrations (`prisma migrate dev` to create, `prisma migrate deploy` to apply) — never `prisma db push`
- **Schema:** 41 models covering users, projects, work packages, sprints, boards, milestones, time entries, meetings + transcripts, cahier feedback, notifications, audit logs, and embeddings

## Environment Variables

```env
DATABASE_URL=postgresql://neoleadge:<password>@localhost:5432/neoleadge
JWT_SECRET=your-secret-at-least-32-chars
JWT_EXPIRES_IN=8h
AI_ENABLED=false
AI_PROVIDER=zai            # zai (glm-4.5-air) primary; openai fallback
AI_FALLBACK_API_KEY=       # Z.AI key
OPENAI_API_KEY=
TRANSCRIPTION_URL=http://localhost:8000
TRANSCRIPTION_SECRET=
```

## License

Proprietary. All rights reserved.
