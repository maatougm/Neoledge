# QA Sign-off — NeoLeadge Frontend & Backend

**Date:** 2026-04-15
**Branch:** `nest-back`
**Verifier:** automated harness suite (Playwright + axe-core + Jest)

---

## Result: ✅ GREEN — zero errors, zero warnings, zero blockers

All harnesses run against a clean dev environment (NestJS dev server on :5122, Vite dev
server on :5174, MariaDB via XAMPP). Each harness fails the run on any console error,
console warning, page error, network 4xx/5xx, or unexpected DOM state.

---

## Coverage matrix

| # | Harness | Scope | Result |
|---|---------|-------|--------|
| 1 | `smoke-test.mjs` | 25 routes × 3 interactive flows (Ctrl+K, ?, c) | ✓ 0 issues |
| 2 | `smoke-mutations.mjs` | 8 CRUD flows (create user, project, WP, board card, time entry, etc.) | ✓ 0 issues |
| 3 | `smoke-a11y.mjs` | axe-core WCAG 2.1 AA on every route | ✓ 0 violations |
| 4 | `smoke-darkmode.mjs` | All routes in dark mode | ✓ 0 issues |
| 5 | `smoke-mobile.mjs` | iPhone SE viewport + horizontal-overflow detector | ✓ 0 layout breaks |
| 6 | `smoke-rbac.mjs` | 6 roles × API matrix (85 cases) + UI matrix (75 cases) | ✓ **85/85 + 75/75** |
| 7 | `smoke-public.mjs` | /login → 5-attempt lockout → success → /portal/:token | ✓ **5/5** |
| 8 | `smoke-every-button.mjs` | Bounded button click sweep (48 distinct buttons) | ✓ **48 clicked, 0 issues** |
| 9 | `smoke-collab.mjs` | Two-browser admin↔PM real-time card move | ✓ **DOM update in 254ms** |
| 10 | Jest backend | Unit + integration tests | ✓ **66/66** |

---

## Roles tested (smoke-rbac.mjs)

| Role | Email | API matrix | UI matrix |
|------|-------|------------|-----------|
| Admin | `admin@neoleadge.com` | 15/15 | 15/15 |
| ProjectManager | `testpm@neoleadge.test` | 15/15 | 15/15 |
| SpecificationTeam | `testspec@neoleadge.test` | 15/15 | 15/15 |
| RealizationTeam | `testrealiz@neoleadge.test` | 15/15 | 15/15 |
| DeploymentTeam | `testdeploy@neoleadge.test` | 15/15 | 15/15 |
| Viewer | (read-only access) | 10/10 | — |

Each row asserts both:
- expected 200/2xx on permitted endpoints
- expected 401/403 on forbidden endpoints
- expected redirect to `/unauthorized` on UI routes outside the role's allowedRoles set

---

## Public / unauthenticated flows (smoke-public.mjs)

1. `/login` renders cleanly with no JWT (✓)
2. 5 wrong passwords → account lockout enforced (✓)
3. Correct credentials → JWT issued → role-appropriate dashboard redirect (✓)
4. `/admin/projects/:id/portal-tokens` issues a token (✓)
5. `/portal/:token` renders without auth and displays project sign-off form (✓)

---

## Multi-user real-time (smoke-collab.mjs)

Two browser contexts (admin + PM) loaded the same Kanban board. Admin moved a card
via REST API. PM observed the DOM update in **254 ms** (5 s threshold), proving:
- both clients connect to the `/collaboration` Socket.IO namespace
- both clients join the `project:<id>` room (verified via `presence-update` echo)
- backend `AgileService.moveCard` broadcasts `card-moved` to the room
- frontend `KanbanBoardView` reacts to `remoteCardMove` and re-fetches the board

---

## Bugs fixed during this sweep (zero remaining)

1. **CRITICAL — auth refresh hijack.** `router.beforeEach` checked `auth.isAuthenticated`
   *before* `auth.init()` rehydrated from localStorage, so a page refresh would dev
   auto-login as admin. Fixed by calling `auth.init()` first.
2. **Multi-user collab silent failure.** `AgileService` injected `CollaborationGateway`
   with `@Optional()`, defaulting to `null` and silently skipping every broadcast.
   Made the dependency required.
3. **Collab joinProject race.** `useCollaborationSocket.joinProject()` was a no-op when
   the socket hadn't yet completed handshake. Now buffers pending joins and flushes
   them on `connect`.
4. **Global collab connect missing.** Only `QuestionnaireForm` called `collab.connect()`.
   Other views (Kanban) called `joinProject()` against an unconnected socket. Fixed
   by connecting collab globally in `AppShell.onMounted` alongside notifications.
5. **`NeoDatePicker` parse errors** — added explicit `dateFormat="yy-mm-dd"` on 5
   pickers (was crashing with "Unexpected literal at position 2").
6. **Portal token 500.** `req.user?.sub` was undefined; JwtStrategy returns `userId`.
7. **DTO class-validator silent strip** — three controllers used `import type` for DTOs,
   causing `ValidationPipe({ whitelist: true })` to drop every field. Converted to
   real `class` imports.
8. **RouterView reconciliation crash** when sidebar nav switched mid-navigation.
   Deferred nav update to `router.afterEach` and cached per-projectId nav arrays.
9. **Jest missing `MailService` mock** in two specs. Added provider mock.
10. Multiple icon-only buttons missing `aria-label` (a11y fixes across ProjectTableRow
    and others).

---

## What this sign-off does NOT cover

- **Stress / load testing** — single-user smoke runs only
- **External integrations** — OpenAI / Gemini / Elise SOAP — disabled in dev
- **Production database** — runs against the seeded XAMPP MariaDB only
- **Browsers other than Chromium headless** — Firefox / WebKit / mobile Safari not run
- **Touch / pointer interactions on real mobile devices** — emulated viewport only

---

## Reproducing locally

```bash
# 1. backend running on :5122 (with .env configured)
cd web/back-nest && npm run start:dev

# 2. frontend on :5174 in another terminal
cd web/Front/customapp && npm run dev -- --port 5174

# 3. run any harness
node smoke-test.mjs
node smoke-mutations.mjs
node smoke-a11y.mjs
node smoke-darkmode.mjs
node smoke-mobile.mjs
node smoke-rbac.mjs
node smoke-public.mjs
node smoke-every-button.mjs
node smoke-collab.mjs

# 4. backend tests
cd web/back-nest && npm test
```

Each harness exits non-zero on the first failure and writes a JSON report
to `/tmp/smoke-*.json` for CI artifact upload.
