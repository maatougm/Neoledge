# NeoLeadge — Deployment Manager

Full-stack project management platform for deployment projects. Manage projects, work packages, sprints, Gantt timelines, budgets, time tracking, wiki documentation, meetings with AI transcription, and real-time collaboration.

**Live:** https://neoleadge.pythagore-init.com

## Stack

| Layer | Tech |
|-------|------|
| Backend | NestJS 11 (TypeScript) + Prisma 7 + PostgreSQL |
| Frontend | Vue 3 + Vite + Pinia + TypeScript + NeoLibrary (PrimeVue 4) |
| Real-time | Socket.IO — notifications + collaboration namespaces |
| Auth | JWT + role-based access control (6 roles) |
| Transcription | Python FastAPI + faster-whisper + SpeechBrain (optional) |
| Infrastructure | Docker Compose + Caddy reverse proxy + Let's Encrypt |

## Quick Start (local development)

**Prerequisites:** Node 22+, XAMPP MySQL on port 3306, database `NeoLeadgeDeployment`.

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
        budgeting/          Project budgets + line items
        time-tracking/      Time entries + hourly rates
        wiki/               Per-project wiki with revisions
        portfolio/          Portfolio grouping + versions
        team-planner/       Capacity, assignments, conflicts
        meetings/           Audio transcription + agenda + outcomes
        ai/                 OpenAI / Gemini transcript analysis
        analytics/          Dashboard metrics (cached 15min)
        automation/         Workflow rule engine
        collaboration/      WebSocket real-time collab
        notifications/      In-app notifications + socket push
        search/             Global search (projects, WPs, wiki, users)
        health/             /health endpoint
        prisma/             Global DB client (MariaDB + Postgres)
      prisma/
        schema.prisma           MariaDB schema (local dev)
        schema.postgres.prisma  PostgreSQL schema (production)
        seed.ts                 Core demo data (users, projects, fields)
        seed-openproject.ts     WPs, sprints, milestones, time, budget, wiki
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
- Portfolio management (group projects, roadmap view)
- Team planner (capacity heatmap, assignment conflicts)

### Project Manager
- Project list + overview with tile grid
- Work Packages — split-panel list/detail, create/edit/delete, custom fields, watchers, dependencies
- Gantt — timeline with zoom, milestones, baseline capture + drift comparison
- Kanban Board — drag-drop cards between columns, real-time sync across users
- Backlog — unassigned WPs + sprint drag-drop assignment
- Sprint Board — sprint selector, metadata, burndown chart (ideal vs remaining)
- Wiki — page tree, markdown editing, search, revision history + restore
- Budget — summary cards, line items, burn report
- Time Tracking — log entries, weekly grid, project summary by user/activity
- Members — project team roster
- Activity — project timeline feed
- Meetings — audio upload, AI transcription (faster-whisper), speaker diarization, AI analysis (action items + decisions), agenda + attendees + outcomes
- Automation — rule builder (trigger events, conditions, actions), execution logs
- My Tasks — cross-project assigned work packages
- Team Planner — capacity + assignment view

### Team Members (Spec/Realiz/Deploy/Viewer)
- Project list (read-only or role-scoped)
- Project detail with questionnaire
- Validation submission

### Public
- Login with quick-access demo buttons + TOTP 2FA support

## Roles

| Role | Access |
|------|--------|
| Admin | Full access to all modules + system management |
| ProjectManager | Own projects + all project modules + team planner |
| SpecificationTeam | Assigned projects (read) + specification validation |
| RealizationTeam | Assigned projects (read) + realization validation |
| DeploymentTeam | Assigned projects (read) + deployment validation |
| Viewer | Read-only project access |

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
- `GET/POST /pm/projects/:id/wiki/pages` — wiki CRUD
- `GET/PUT /pm/projects/:id/budget` — budget management
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
| Jest (backend) | 66 specs |

## Database

- **Local dev:** MySQL via XAMPP, port 3306, `NeoLeadgeDeployment`
- **Production:** PostgreSQL 16 (Docker), `neoleadge`
- **ORM:** Prisma 7 with adapter pattern — auto-detects MariaDB or Postgres from `DATABASE_URL`
- **Schema:** 44 tables covering users, projects, work packages, sprints, boards, milestones, budgets, time entries, wiki, portfolios, notifications, audit logs, and more

## Environment Variables

```env
DATABASE_URL=mysql://root:@127.0.0.1:3306/NeoLeadgeDeployment  # or postgresql://...
JWT_SECRET=your-secret
JWT_EXPIRES_IN=7d
AI_ENABLED=false
AI_PROVIDER=openai
OPENAI_API_KEY=
GEMINI_API_KEY=
TRANSCRIPTION_URL=http://localhost:8000
```

## License

Proprietary. All rights reserved.
