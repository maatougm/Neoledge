# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

**NeoLeadge** is a full-stack project-management platform for IT deployment projects. The product centres on an AI-driven workflow:

```
Admin creates project + assigns PM
  → PM picks team via ProjectMember (with custom labels)
  → PM fills questionnaire (ProjectField + ProjectFieldValue)
  → PM uploads meetings (transcribed + AI-analysed)
  → AI generates Cahier des Charges (saved as JSON in Project.aiOutput)
  → SpecificationTeam approves/rejects (CahierFeedback)
  → PM generates AI backlog (Epics + Tasks)
  → PM drag-drops tasks onto team members → bulk-assign
  → Team executes via Work Packages, Kanban, Gantt, Sprints
```

**Stack:**
- `web/back-nest/` — NestJS 11 (TypeScript) + Prisma 7 + PostgreSQL — port 5122
- `web/Front/customapp/` — Vue 3 + Vite + Pinia + NeoLibrary (PrimeVue 4) — port 5173 (dev) / 8002 (prod via nginx)
- `web/Transcription/` — Python FastAPI + faster-whisper + SpeechBrain — port 8000
- Real-time: Socket.IO on `/notifications` and `/collaboration` namespaces
- Deployment: Docker Compose + Caddy + Let's Encrypt at `https://neoleadge.pythagore-init.com`
- Legacy `web/Back/` (.NET / SQL Server) kept for reference, not in active development

**Authoritative DB reference:** `docs/DATABASE_SCHEMA.md` (44 models, ER diagrams, cascade rules, JSON columns).

---

## Common commands

### Backend (`web/back-nest/`)

```bash
npm install
npm run start:dev         # watch mode → http://localhost:5122
npm run build             # production build
npx tsc --noEmit          # type-check only
npx prisma generate       # regenerate client after schema.prisma edit
npx prisma migrate dev    # create a new tracked migration in dev
npx prisma migrate deploy # apply pending migrations (used in prod entrypoint)
```

### Frontend (`web/Front/customapp/`)

```bash
npm install
npm run dev               # http://localhost:5173
npm run build             # → dist/
npm run lint
npx vue-tsc --noEmit      # type-check only
```

### Tests (Playwright E2E in `scripts/`)

```bash
node scripts/e2e-multi-role-bug-hunt.mjs    # full multi-role workflow test against the live test server
node scripts/e2e-pm-deep-verify.mjs         # interactive component test (members modal, drag-drop, ...)
node scripts/e2e-pm-tabs-screenshot.mjs     # PM tab visibility check
```

The scripts use the Playwright already installed under `web/Front/customapp/node_modules/playwright`. They target the live test server `https://neoleadge.pythagore-init.com` and capture screenshots to `scripts/e2e-*-shots/`.

### Deploy to test server

```bash
ssh -i ~/.ssh/id_ed25519 root@187.77.70.67 \
  'cd /root/neoleadge && git fetch origin nest-back && git reset --hard origin/nest-back \
   && cd /root/neoleadge/deploy/neoleadge \
   && docker compose -f docker-compose.prod.yml --env-file .env.prod build server web'
```

Then on the server: kill the running container PIDs (`kill -9 <pid>`), `docker rm -f`, then `docker compose ... up -d server web`. AppArmor blocks `docker stop` so the kill-then-rm pattern is required. `prisma migrate deploy` runs in the container entrypoint — no manual step needed.

### Environment variables

Backend `.env`:
```env
DATABASE_URL=postgresql://neoleadge:<password>@localhost:5432/neoleadge
JWT_SECRET=<32+ chars>
JWT_EXPIRES_IN=8h
TRANSCRIPTION_URL=http://localhost:8000
TRANSCRIPTION_SECRET=<shared secret for the FastAPI service>
AI_PROVIDER=openai          # openai | gemini
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...
CAHIER_AI_MODEL=gpt-4o-mini
CORS_ORIGINS=http://localhost:5173,https://neoleadge.pythagore-init.com
```

`AI_FALLBACK_API_KEY` (Z.AI) is optional — used as a fallback for transcription and cahier when the primary provider fails.

---

## Architecture

### Backend patterns

**Result pattern (mandatory).** All service methods return `Result.ok(data)` or `Result.fail(message)` from `src/common/result.ts`. Controllers map `Result` to HTTP exceptions (`BadRequestException`, `ConflictException`, `NotFoundException`). Never throw from a service — return a Result.

**DTOs are classes, never interfaces.** When used with `@Body()`, NestJS's `ValidationPipe` (whitelist:true) reads class metadata via reflect-metadata. `import type` or `interface` declarations erase at runtime, so all fields are stripped silently. Always `class CreateXDto { @IsString() field!: string }` and import normally.

**Module registration.** Every module is registered in `src/app.module.ts` `imports`. `PrismaModule` is `@Global()` — never re-import it.

**Auth guard stack.**
- `JwtAuthGuard` — verifies the JWT; pinned to HS256 in both signing (`auth.module.ts`) and verification (`jwt.strategy.ts`) for defence-in-depth.
- `ProjectAccessGuard` + `@ProjectAccess('paramName')` — applied to every project-scoped controller. **For non-Admin users it does NOT accept global `UserRoleAssignment` (projectId=null) as proof of access** — they must have a project-scoped assignment, be the project's PM, or be in `ProjectMember`. This closes the IDOR where any user with a leaked global role could read every project.
- `PermissionsGuard` + `@RequirePermission('wp.create')` — fine-grained permission keys catalogued in `src/permissions/permission-keys.ts`.

**Notification scoping.** `NotificationsService.notify()` and `notifyEnhanced()` both verify the target user is a project member (PM, scoped UserRoleAssignment, or `ProjectMember`) before persisting. This prevents cross-project notification spam.

**Real-time gateways.** Socket.IO on `/notifications` (per-user inbox push) and `/collaboration` (presence + field-focus during questionnaire editing). Both authenticate via `client.handshake.auth.token`. The collaboration presence Map is in-process — incompatible with multi-instance scaling (PM2 cluster, etc.).

### Database

**Engine:** PostgreSQL 16, Prisma 7. Production runs via `@prisma/adapter-pg` in the Docker stack.

**Migrations.** All schema changes use tracked Prisma migrations under `prisma/migrations/<timestamp>_<name>/migration.sql`. `npx prisma migrate deploy` runs in the prod container entrypoint. The legacy raw `.sql` files at `prisma/migration-*.sql` (with `mysql-legacy` suffix or sprint names) are historical artefacts from the MySQL era — do not apply them; they're kept only for traceability.

**Soft-delete.** Opt-in per table via `isDeleted Boolean`. Active on: `Project`, `WorkPackage`, `ProjectComment`, `WorkPackageComment`, `ProjectAttachment`, `WorkPackageAttachment`. There's no global Prisma middleware — every read on a soft-deletable model must include `isDeleted: false` in its `where` clause explicitly.

**Cascade policy.** See `docs/DATABASE_SCHEMA.md §16` for the full table. Briefly: `CASCADE` for hard children (transcript segments, dependencies, custom values, notifications), `SetNull` for history rows that should survive (`CahierFeedback.user`, `Notification.actor`, `WorkPackage.assignee/parent`), `NoAction` for integrity-critical FKs (`Project.projectManager`, `WorkPackage.author`, `TimeEntry.user`).

**JSON columns.** `Project.aiOutput` (the saved cahier), `AppUser.preferences`, `AutomationRule.actionConfig`. All `JSON.parse` on these columns must be in a try/catch — corrupt rows must not crash the endpoint.

### AI integration

The `src/ai/` module has two distinct features that share providers:

1. **Meeting transcript analysis** — `AiService.analyzeTranscript(transcriptId)` is fire-and-forget after meeting upload. Sets `aiStatus = 'processing'` (concurrency guard), builds the prompt from `TranscriptSegment` rows, calls the provider (OpenAI / Gemini), persists `MeetingActionItem` + `MeetingDecision` rows in a transaction, sets `aiStatus = 'completed'`. Frontend polls `/ai-results` every 5s until terminal state.

2. **AI Backlog generator** — `BacklogService.preview(projectId)` reads questionnaire answers (only fields with `isBacklogDriver = true`), the saved cahier (`Project.aiOutput`), and recent meeting summaries; returns a sanitized `{ epics: [{ title, priority, estimatedHours, children: [task...] }] }` JSON without writing to DB. PM edits in the UI; `accept()` writes `WorkPackage` rows in a transaction with `aiGeneratedFrom` set for traceability. Has an in-memory 30s cooldown per project to prevent burning API calls.

**Cahier des charges generation** lives in `src/cahier-des-charges/`. Pulls questionnaire + meetings + past `CahierFeedback` rejections into a TOON-formatted prompt (~50% smaller than verbose key:value), produces a 9-key JSON, persists into `Project.aiOutput` with a `savedAt` timestamp. Re-saving resets the review queue (any `CahierFeedback` older than `savedAt` is ignored). PM **cannot** self-approve — `saveFeedback()` rejects when `userId === project.projectManagerId` (400).

**Provider fallback.** Z.AI configured via `AI_FALLBACK_API_KEY` is used when the primary provider fails (network, 5xx). All AI fetch calls have explicit `AbortSignal.timeout()`. Fire-and-forget invocations chain `.catch((e) => logger.error(...))` to prevent unhandled rejections.

### Frontend patterns

**NeoLibrary constraints (will silently break in prod if violated):**

| Component | Constraint |
|---|---|
| `NeoButton` | `severity="primary"` does NOT exist — omit severity for default teal. Allowed: `secondary` / `danger` / `warning` |
| `NeoTag` | severity union uses `warn` (not `warning`!) — Vue tsc catches this in dev but Docker build is stricter |
| `useNeoToast()` | Only `.add({ severity, summary?, detail, life? })` — there is NO `.success()` / `.error()` shortcut |
| `useNeoConfirm().require()` | Returns void — pass an `accept` callback, do NOT `await` it |
| `NeoDatePicker` | v-model is `string \| string[] \| null` — never bind to a `Date` object |
| `NeoDialog` | Deprecated — use `AppModal` from `@/components/common/AppModal.vue` (Teleport-based) |
| All NeoLibrary components | MUST be explicitly imported (`import { NeoButton } from '@neolibrary/components'`) — there is no auto-registration. Missing imports render as empty `<neobutton>` tags silently. |

**Axios error handling.** `lib/api.ts` interceptor auto-toasts only on 5xx. 4xx responses (validation errors, conflicts, not-found) are expected business responses and the calling component is responsible for displaying them. Components that want a generic 4xx toast use `extractErrorMessage(err)` exported from the same file.

**Pinia store reset on route change.** Per-project stores (`projectMembersStore`, `pmStore`, etc.) must be reset when the user navigates between projects, otherwise the new project briefly renders the old project's data. Each `MembersView`-style component calls `store.reset()` as the first line of `onMounted`.

**Sidebar nav transitions.** `AppShell.vue` switches between role-based nav and per-project nav when entering `/app/pm/projects/:id/*`. The switch happens in `router.afterEach`, NOT in a computed — mutating `navSections` during navigation crashes `RouterView` mid-reconciliation. Per-project navs are LRU-cached in a `Map` (max 50 entries) keyed by `role:projectId`.

**Drag-and-drop assignment** uses native HTML5 events (`dragstart`/`dragover`/`drop`/`dragend`). The `dragend` reset is mandatory — without it `draggingWpId` leaks if the drop is cancelled (Esc, drop outside columns) and the next legitimate drop assigns the wrong WP.

### Removed features (don't reintroduce by accident)

The following modules + schema models were deliberately removed and should not come back:

- **Budgeting** (`ProjectBudget`, `BudgetLineItem`) — module deleted, tables dropped via migration `20260504020000`.
- **Hourly rates** (`HourlyRate`) — only consumed by the deleted budget module; controller, service methods, DTOs, model all gone.
- **Wiki** (`WikiPage`, `WikiRevision`) — module deleted, tables dropped via migration `20260504030000`. `entityType` union no longer includes `'wiki_page'`. Search service no longer indexes wiki content.
- **Handovers + RACI** (`Handover`, `HandoverCriterion`, `ActivityRaci`) — never had controllers; tables dropped along with the orphan-table migration.
- **Auto-login in dev** — `router/index.ts` previously auto-logged-in admin in `import.meta.env.DEV`; removed because the credentials would leak if DEV was ever true in a prod build.

### Active per-project routes

Under `/app/pm/projects/:id/*`:
- `` (overview), `/questionnaire`, `/meetings`, `/cahier`, `/validations`
- `/workpackages`, `/gantt`, `/board`, `/backlogs`, `/sprint`
- `/backlog-generator`, `/assign-tasks` (the AI backlog flow)
- `/members`, `/time`, `/activity`

Templates ("Modèles" / form-model) live under PM at `/app/pm/templates`, not admin.

---

## Critical gotchas

- **Never run `prisma db push`** — it doesn't reconcile FK index drift well. Use `prisma migrate dev` to create a tracked migration; `migrate deploy` applies it.
- **DTOs as classes, not interfaces.** Always.
- **Project-scoped routes need `ProjectAccessGuard` + `@ProjectAccess('paramName')`** — without both, non-Admin users with a global role assignment get IDOR access to every project.
- **PM self-approval on cahier is blocked at the service.** Don't reintroduce a "self-approve" path in the controller layer — it bypasses the spec-team review flow.
- **`HourlyRate`-style orphan removal pattern.** When deleting a feature: remove backend controller + service methods + DTOs + module registration first, then schema model + Project/AppUser back-relations, then write a `DROP TABLE` migration. Run `npx prisma generate` and re-typecheck before committing.
- **Audio uploads.** Never set `Content-Type: multipart/form-data` manually on axios — pass `FormData` and let axios set the boundary.
- **Frontend `vue-tsc` diverges from local `tsc`** in Docker. The build will fail on `severity="warning"` instead of `"warn"` on `NeoTag`. Always run `npx vue-tsc --noEmit` before pushing.
- **Container restart on prod uses kill-then-rm.** AppArmor blocks `docker stop`. Get the container PID via `docker inspect -f "{{.State.Pid}}"`, `kill -9` it, `docker rm -f`, then `docker compose up -d`.
