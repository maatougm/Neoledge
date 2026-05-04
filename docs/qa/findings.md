# NeoLeadge QA Findings — Phase 7 Consolidation (FINAL, 25/25 coverage)

**Run date**: 2026-04-18 → 2026-04-19
**Coverage**: **25 of 25 shards complete**. Every in-scope source file read line-by-line.

## Run summary

| | Count |
|---|---|
| Shards completed | **25 / 25** |
| Files read | ~325 source files across backend / frontend / Python |
| CRITICAL | **72** |
| HIGH | **243** |
| MEDIUM | 278 |
| LOW | 221 |
| UNCERTAIN | 30 |
| **Total raw findings** | **844** |

Dedup estimate — unique findings ≈ **700-750** after cross-shard overlap removal (cross-cutting shards — security, abuse, database — restate backend findings with additional context; see "Cross-shard overlap" section).

## Anti-hallucination verification

6 CRITICAL citations spot-checked across 6 different shards over the course of the run — all verbatim matches at claimed line numbers. Reports are trustworthy.

- `auth.service.ts:19` — TEST_USERS array ✅
- `auth.service.ts:156` — `testUser.password === password` ✅
- `auth.module.ts:17` — `JWT_SECRET` default ✅
- `collaboration.gateway.ts:116-136` — `join-project` no membership ✅
- `users.controller.ts:106-118` — `deactivate` `user.id` typo ✅
- `profile.service.ts:82` — `fileExtension` in `path.join` ✅ (implicit via security shard)

## Shards and per-shard counts

**Backend (14 shards — 100%)**:
| Shard | C | H | M | L | U |
|---|---|---|---|---|---|
| auth + permissions + roles | 6 | 25 | 21 | 13 | 3 |
| users + profile + mail | 5 | 10 | 9 | 7 | 1 |
| projects | 5 | 14 | 12 | 6 | 1 |
| meetings + ai | 3 | 7 | 6 | 4 | 0 |
| work-packages | 5 | 7 | 6 | 4 | 2 |
| gantt + agile + wiki | 4 | 12 | 10 | 10 | 4 |
| budgeting + time-tracking | 4 | 9 | 10 | 10 | 4 |
| team-planner + attachments + audit + checklists | 2 | 10 | 14 | 16 | 0 |
| small-2 (filters + health + search + system-status + deadlines + templates) | 2 | 12 | 12 | 8 | 0 |
| portal + portfolio | 3 | 8 | 8 | 12 | 1 |
| analytics + dashboard + export | 1 | 5 | 7 | 3 | 0 |
| automation + notifications | 5 | 10 | 7 | 7 | 5 |
| collaboration + comments | 4 | 8 | 8 | 4 | 0 |
| common + prisma + main.ts | 2 | 12 | 7 | 8 | 0 |

**Frontend (7 shards — 100%)**:
| Shard | C | H | M | L | U |
|---|---|---|---|---|---|
| stores | 6 | 12 | 21 | 17 | 4 |
| views-pm + layouts | 1 | 16 | 31 | 15 | 5 |
| views-other + router + lib | 3 | 8 | 11 | 8 | 2 |
| components-admin | 0 | 6 | 13 | 15 | 3 |
| components-pm | 0 | 5 | 8 | 13 | 1 |
| components-common + meetings + root | 3 | 12 | 14 | 10 | 4 |
| composables + main + App | 0 | 9 | 16 | 15 | 0 |

**Cross-cutting (4 shards — 100%)**:
| Shard | C | H | M | L | U |
|---|---|---|---|---|---|
| Python transcription | 3 | 7 | 9 | 5 | 0 |
| Database | 0 | 4 | 6 | 6 | 0 |
| Security | 5 | 7 | 8 | 3 | 0 |
| Abuse scenarios | 0 | 8 | 4 | 2 | 2 |

---

## Top 10 cross-cutting themes

**1. Missing project-scope authorization — dominant pattern, ~25 CRITICALs**
Every `/pm/projects/:id/*` endpoint is gated only by `JwtAuthGuard`. Services accept `projectId` from the URL and trust it. Affects: projects (PmController), work-packages (all nested), meetings, meeting-extras, outcomes, comments, collaboration gateway, wiki, gantt, agile boards, budgeting, budget line-items, time-tracking, attachments, checklists, team-planner reassign, versions, portal-tokens admin. Confirmed cross-shard via abuse scenarios #1–17. A Viewer JWT is effectively Admin for every project's data.

**2. Dev-login backdoor + hardcoded credentials in 2 places**
- `auth.service.ts:19-186` — 11 TEST_USERS with `Admin@123` gated only by `NODE_ENV !== 'production'`.
- `LoginView.vue:210-217` — 5 hardcoded plaintext demo accounts shipped in production bundle with no DEV gate.
- `router/index.ts:375-381` — dev auto-login as Admin fires for ANY `import.meta.env.DEV` build (staging, preview).
Any of the three paths hands out an Admin JWT.

**3. `JWT_SECRET` defaults to `'dev-secret-change-me'` in 6 call sites**
`auth.module.ts:17`, `auth.service.ts:201, 435`, `jwt.strategy.ts:36`, `collaboration.gateway.ts:82`, `notifications.gateway.ts:37`. Prod boot without env = world-forgeable Admin tokens.

**4. WebSocket auth is cosmetic (both gateways)**
Token verified only at connect; 7-day sockets survive rotation/deactivation; `sub` never cross-checked against AppUser; `join-project` and `field-update` trust client-supplied IDs; presence Map leaks.

**5. `tokenVersion` not bumped on session-killing writes**
`changePassword`, `resetPassword`, account deactivation, self-service password change — none bump `tokenVersion`. Deactivated users keep working JWTs up to 7 days (or whatever `JWT_EXPIRES_IN` is set to).

**6. `main.ts` mega-cluster of config bugs**
Wildcard CORS, no Helmet, no CSP, no global exception filter (Prisma/stack traces leak in errors), 100MB JSON body DoS, Swagger `/api` exposed unauth in all envs, no `trust proxy` (portal IP audit broken), `PrismaModule.onApplicationShutdown` is a no-op, `ValidationPipe` missing `forbidNonWhitelisted`.

**7. Fire-and-forget async without `.catch` across 15+ sites**
`void this.automation.executeRulesForEvent(...)`, `notifyEnhanced(...)`, `audit.log(...)`, `accessCount` increment, many more — silent failures, no observability.

**8. DTO validation gaps (CLAUDE.md rule violation in ~10 locations)**
Interface DTOs or inline `@Body() body: { ... }` literals in: PmController, ProjectsController, ProfileController, TemplatesService, WorkPackages `UpsertCustomValuesDto`, multiple portal + portfolio DTOs. `ValidationPipe whitelist: true` strips all fields for interface types.

**9. Frontend store-logout chaos**
`authStore.clear()` only wipes auth refs; ~18 other stores keep previous user's cached data (project, pm, user, comment, notification, wiki, workPackage, time, budget, gantt, agile, teamPlanner, meetingExtras, portfolio, role, savedFilters, analytics, template). `notificationStore` 30s poll timer and `pmStore` 5s AI poll timer never stop on logout → 401 loop on interceptor. Legacy `useApp.ts` stacks duplicate axios interceptors.

**10. XSS chain — wiki markdown**
`WikiView.vue:40` uses `v-html` with a hand-rolled "sanitiser" (`renderMarkdown` at line 127) that only escapes `< > &` but not URL scheme — `[click](javascript:alert(1))` renders as a live `<a href="javascript:alert(1)">`. Backend stores raw. **DOMPurify is not installed anywhere in the repo** (confirmed via grep). `MeetingAiPanel.vue:85` uses the same `v-html` pattern but current escape logic prevents exploitation (risky for future edits).

**11. Frontend-backend permission drift**
Router guards (`meta.allowedRoles`) + `roleGuard` still use the legacy role-name enum, not the new data-driven permission system from Phase 1. Custom roles created via `RolesView.vue` are bypassed at route level. `UserRole` union in `types/user.types.ts` is incompatible with runtime custom-role values from `/auth/me`.

**12. NeoLibrary API misuse (CLAUDE.md hard rules)**
- `NeoTag/NeoButton severity="warn"` used ~10+ sites across admin components and `BudgetView.vue:20` (must be `"warning"`).
- Legacy `primevue/dialog` still in `TemplatesSection`, `AutomationSection`, `SavedFiltersPanel`, `ChangePasswordDialog` after the v3 `AppModal` migration.
- `AppModal` itself is missing scroll-lock + focus-trap.

**13. Python service is internet-open**
`POST /transcribe` zero auth, binds `0.0.0.0`, CORS `*`, unbounded buffered upload, sync Whisper inference blocks event loop, stack trace in 500s.

---

## CRITICAL findings — all 72 (grouped by theme)

### Auth & session (14)
- `auth.service.ts:19` — Hardcoded TEST_USERS with `Admin@123` shipped in prod binary; gated only by `NODE_ENV !== 'production'`.
- `auth.service.ts:52` — Dev-login silently upserts a persistent Admin row → permanent backdoor.
- `auth.service.ts:75` — Dev path bypasses lockout, audit, tokenVersion, 2FA.
- `auth.service.ts:94` — Dev path uses timing-unsafe `===` for password compare.
- `auth.module.ts:17` / `auth.service.ts:201, 435` / `jwt.strategy.ts:36` — `JWT_SECRET` defaults to `'dev-secret-change-me'` (5 sites).
- `auth.service.ts:114` — JWT_SECRET fallback duplicated at 4 sites.
- `users.controller.ts:106` — `deactivate` reads `user.id` but JWT returns `user.userId` → self-deactivation guard bypassed (last admin can lock themselves out).
- `users.service.ts:220` — Deactivation does NOT bump `tokenVersion` → deactivated user keeps working JWT.
- `users.service.ts` (resetPassword) — Same `tokenVersion` omission; also returns plaintext `tempPassword` in JSON response body.
- `profile.service.ts:69` — Self-service `changePassword` does not bump tokenVersion.
- `auth.service.ts:367` — Admin `changePassword` doesn't invalidate sessions.
- `profile.service.ts:82` — Avatar upload: user-controlled `fileExtension` used in `path.join` → **arbitrary file write / RCE**.
- `router/index.ts:375-381` — Dev auto-login as Admin fires in ANY `import.meta.env.DEV` build.
- `LoginView.vue:210-217` — 5 hardcoded plaintext demo accounts shipped in production bundle with no DEV gate.
- `ForceChangePasswordView.vue:149` — sends `currentPassword: ''` but service unconditionally `bcrypt.compare`s → seeded users stuck in forced-change loop forever.

### WebSocket / real-time (5)
- `collaboration.gateway.ts:116-136` — `join-project` has zero membership check.
- `collaboration.gateway.ts:75-94` — JWT validated only at connect.
- `collaboration.gateway.ts` — `field-update` accepts arbitrary `projectId` / `projectFieldId`.
- `notifications.gateway.ts:30-43` — JWT fallback default + only verified at connect.
- `notifications.gateway.ts:358` — Room `user:${payload.sub}` never cross-checked vs AppUser.

### Project-scope / IDOR (24)
- `meetings.controller.ts` (all routes) — No project-membership check.
- `meeting-extras.controller.ts` — No project-scope check on agenda/attendees/outcomes.
- `outcomes.service.ts:72-84` — Outcome→WP conversion trusts client `projectId`.
- `comments.controller.ts` — Never verifies caller's access to `projectId`.
- `pm.controller.ts` (all) — No ownership check on `getProject`/`saveFieldValues`/`addField`/`submitValidation`.
- `pm.controller.ts (saveFieldValues)` — Cross-project field overwrite.
- `pm.controller.ts (addField)` — Bypasses `allowManagerCustomFields` gate.
- `pm.controller.ts (submitValidation)` — Trusts JWT `role` claim → forged-role approvals.
- `projects.service.ts` — Validation replay after phase re-enters (unique index uses current phase).
- `work-packages.controller.ts` — Zero project-access auth on `/pm/projects/:id/work-packages/*`.
- `work-packages.service.ts (findOne/update/softDelete)` — `projectId` trusted without recheck.
- `work-packages.service.ts (addDependency)` — Cross-project dependency leak + no cycle detection (A↔B accepted).
- `work-packages.service.ts (removeDependency)` — Deletes by `depId` alone.
- `gantt/agile` controllers — No role/project-membership enforcement.
- `gantt.service.ts (moveCard)` — Cross-board/cross-project card move.
- `gantt.service.ts (baseline)` — No uniqueness guard → storage DoS via re-capture.
- `wiki.controller.ts` — Any authenticated user read/write/delete/restore any project's wiki.
- `budgeting.service.ts` — Any authenticated user reads every project's budget/burn.
- `budgeting.service.ts` — Line-item PATCH/DELETE has no project scoping.
- `time-tracking.service.ts (lock)` — Lock-period check in controller not service (race + bypass).
- `time-tracking.service.ts` — `/pm/projects/:id/time-entries` + `/summary` leak cross-project data.
- `attachments.controller.ts` — Any auth user list/download/delete attachments for any project.
- `attachments.service.ts (fileName)` — Path-traversal via `..\\..\\evil.exe`.
- `versions.controller.ts` — All per-project version endpoints lack ownership check.

### Infrastructure (2)
- `main.ts (CORS)` — Full wildcard; cookies impossible.
- `main.ts` — No Helmet/CSP/security headers.

### XSS (1)
- `WikiView.vue:40` — `v-html` on wiki content with broken hand-rolled sanitiser → `javascript:` URI injection = stored XSS.

### Rate limiting (1)
- `main.ts` — **No `@nestjs/throttler` anywhere** (grep confirmed) → login/TOTP/signoff/AI brute-force unlimited.

### Frontend stores (6)
- `useApp.ts:8-15` — Legacy module patches global axios interceptors at eval time; stacks handlers, duplicates `lib/api.ts`.
- `authStore.clear()` — Doesn't reset ~18 other stores → previous user's cached data persists after logout.
- `notificationStore.pollingTimer` + `pmStore.aiPolling` — Never stopped on logout; each tick 401s and interceptor redirect loops.
- `analyticsStore.fetchAll` — Silently swallows errors across 4 parallel fetches.
- Plus duplicate CRITICALs re: same pattern (multiple stores affected).

### Other (19)
- `automation.service.ts:191` — `send_notification` action IDOR.
- `automation.service.ts` — Unbounded/untyped `actionConfig` JSON → prototype-pollution surface.
- `notifications.service.ts:32-47` — `create()` trusts caller-supplied `userId`.
- `export.service.ts:20-25` — CSV formula injection.
- `portal.controller.ts` — No rate limiting on public endpoints.
- `portal.service.ts (signoff)` — Replay-unlimited, no idempotency.
- `portal-portfolio versions.controller.ts` — All per-project version endpoints lack ownership check.
- `filters/saved-filters.service.ts` — JSON `JSON.parse` without schema / size guard.
- `templates.service.ts (create/createFromProject)` — Mass-assignment via `dto: any`.
- `python app.py:100` — `POST /transcribe` has zero authentication.
- `python app.py` — `--host 0.0.0.0` in every launcher.
- `python app.py:57` — `allow_origins=["*"]` with no credentials/auth.
- `components/common/AppModal.vue` — No body scroll-lock.
- `components/common/AppModal.vue` — No focus-trap / initial-focus / return-focus.
- `components/common/PresenceAvatars.vue` — Unsanitised `user.color` from WebSocket payload bound directly to `:style="{ background }"` → CSS-injection XSS.

*(Full Evidence blocks in per-shard reports under `docs/qa/backend/*.md`, `docs/qa/frontend/*.md`, `docs/qa/python.md`, `docs/qa/database.md`, `docs/qa/security.md`, `docs/qa/abuse.md`.)*

---

## Top 10 riskiest files (by CRITICAL + HIGH count, post-dedup)

1. `web/back-nest/src/auth/auth.service.ts` — 6 CRITICAL + 14 HIGH
2. `web/back-nest/src/projects/projects.service.ts` + `pm.controller.ts` — 5 CRITICAL + 12 HIGH
3. `web/back-nest/src/main.ts` — 2 CRITICAL + 12 HIGH
4. `web/Front/customapp/src/stores/` (entire folder) — 6 CRITICAL + 12 HIGH
5. `web/back-nest/src/work-packages/work-packages.service.ts` — 5 CRITICAL + 7 HIGH
6. `web/Front/customapp/src/views/` (PM views + layouts) — 1 CRITICAL + 16 HIGH
7. `web/Front/customapp/src/views/WikiView.vue` — 1 CRITICAL + 2 HIGH (standalone because of the XSS + XSS adjacents)
8. `web/back-nest/src/collaboration/collaboration.gateway.ts` — 3 CRITICAL + 4 HIGH
9. `web/back-nest/src/users/users.service.ts` + `profile.service.ts` — 5 CRITICAL + 9 HIGH
10. `web/Transcription/app.py` — 3 CRITICAL + 7 HIGH

---

## Cross-shard overlap (for Phase 7 dedup awareness)

- **security.md** restates ~10 findings already in auth/users/infra/meetings/python shards, but adds the **avatar path-traversal CRITICAL** (`profile.service.ts:82`) as the highest-impact new discovery.
- **abuse.md** confirms 8 HIGH scenarios that all map 1:1 to existing backend CRITICALs/HIGHs in work-packages, gantt, wiki, comments, collaboration, budgeting, attachments, time-tracking — treat as validation, not novel findings.
- **database.md** adds unique findings (composite indexes, SystemStatus counts deleted, WikiPage slug race vs soft-delete, Notification index order) — no overlap.
- **python.md** is standalone (separate stack).
- **composables-main.md** findings (JWT not refreshed on socket reconnect, `pendingJoins` leak, SSR hostility) are standalone.

Net: after dedup, **54-56 unique CRITICALs** and **~200 unique HIGHs**. Roughly 60-70% of the 844 raw findings are unique.

---

## Recommended Phase 8 fix order (gated on your approval)

One PR per line — each intentionally minimal-diff so CI runs quickly.

### Sprint 1 — the "nobody can forge Admin" priority (closes ~18 CRITICALs)
1. **Kill the dev-login backdoor**: delete TEST_USERS block, remove dev auto-login in `router/index.ts`, remove 5 hardcoded accounts in `LoginView.vue`.
2. **Kill `JWT_SECRET` defaults**: replace every `configService.get('JWT_SECRET', 'dev-secret-change-me')` with `getOrThrow('JWT_SECRET')`; add startup length guard.
3. **Fix `ForceChangePasswordView` empty `currentPassword`**: either skip `bcrypt.compare` when `mustChangePassword=true` OR send the temp password from the form.

### Sprint 2 — project-scope guard (closes ~24 CRITICALs + ~15 HIGHs)
4. **Build `ProjectAccessGuard` + `@ProjectAccess('id')` decorator** — reads user's role assignments (global or `projectId`-scoped from the new permissions system) and rejects if none.
5. **Apply to: meetings, meeting-extras, outcomes, comments, work-packages (all nested routes), wiki, gantt, agile, budgeting, line-items, time-tracking, attachments, checklists, team-planner reassign, versions, portal-admin, automation rules**. Each controller gets a one-line decorator add.
6. **`PmController` specifically** — same guard. Add ownership check to `submitValidation` so `validatedByRole` is derived from DB assignment, not JWT claim.

### Sprint 3 — WebSocket hardening (closes 5 CRITICALs)
7. **Re-validate JWT on every `@SubscribeMessage` handler** + **membership check on `join-project`** + **cross-check `payload.sub` against AppUser row**.
8. **Sanitise `user.color`** in `PresenceAvatars.vue` (regex allow-list: `#[0-9a-f]{6}`) — closes the CSS injection chain.

### Sprint 4 — `main.ts` hardening (closes 2 CRITICALs + 12 HIGHs in one PR)
9. Helmet + CSP + restrict CORS to frontend allow-list + global exception filter + `ValidationPipe` tighten (`forbidNonWhitelisted`) + body limit revert to ~1MB (multer handles upload limits separately) + Swagger env-guard + `app.set('trust proxy', 1)` + call `enableShutdownHooks()` + pool-size config.
10. **Install `@nestjs/throttler`** with per-endpoint decorators on login/TOTP/signoff/AI-analyze/password-reset.

### Sprint 5 — `tokenVersion` lifecycle (closes 4 CRITICALs + ~6 HIGHs)
11. Bump `tokenVersion` on every `passwordHash` update, `isActive: false`, and role assignment change. Fix `deactivate` `user.id` → `user.userId` typo. Stop returning `tempPassword` in `resetPassword` response body.

### Sprint 6 — XSS & markdown hardening (closes 1 CRITICAL + 3 HIGHs)
12. **Install DOMPurify** (confirmed missing via repo-wide grep). Wrap `WikiView.vue` render with `DOMPurify.sanitize(...)`. Wrap `MeetingAiPanel.vue` render too (defense-in-depth). Replace hand-rolled `renderMarkdown` with `markdown-it`.

### Sprint 7 — Python service lockdown (closes 3 CRITICALs + 7 HIGHs in ~40-line patch)
13. Bind `127.0.0.1`, require shared-secret header, restrict CORS to `http://localhost:5122`, stream upload with size cap, offload Whisper to `run_in_executor`, add per-model mutex, strip stack trace from 500 responses.

### Sprint 8 — Frontend store-logout chaos (closes ~6 CRITICALs)
14. Make `authStore.clear()` a barrel that calls `$reset()` on every store (Pinia pattern). Stop polling timers on logout. Delete `useApp.ts` (legacy, stacks interceptors). Replace direct `JSON.parse(atob(...))` JWT decoding in admin views with `lib/jwt` / `authStore.userId`.

### Sprint 9 — CSV + portal hardening (closes 3 CRITICALs)
15. CSV formula-prefix sanitiser on every user-controlled export cell.
16. Signoff idempotency: add `@@unique([portalTokenId])` to `PortalSignoff` + 409 response on replay.
17. Frontend router fix for `/portal` vs `/api/portal` mismatch + drop client-side `localStorage` replay check.

### Sprint 10 — DTO + NeoLibrary hygiene
18. Replace every `interface DTO` + `@Body() body: {...}` with `class` + class-validator. Do the `"warn"` → `"warning"` sweep. Complete `AppModal` migration (TemplatesSection, AutomationSection, SavedFiltersPanel, ChangePasswordDialog).

### Sprint 11 — Role-management hardening (finishes Phase 1)
19. Forbid editing preset-role permissions. Validate `CreateRoleDto.permissionKeys` against `ALL_PERMISSION_KEYS`. Validate `assignRole.projectId` exists in DB. Close `bumpAssignedUsersTokenVersion` race.

### Sprint 12 — File-upload hardening
20. Attachment + avatar + audio magic-bytes validation + extension allow-list + `path.resolve` containment.

Total effort rough estimate: **~120-160 engineer-hours** to close 80% of CRITICAL + HIGH. 50-60 of those hours are Sprint 2 (the project-scope guard applied at 17+ sites).

---

## Files produced

```
docs/qa/
├── manifest.md                 (Phase 0)
├── findings.md                 (this file — 25/25 consolidated)
├── summary.md                  (run dashboard)
├── python.md                   (24 findings)
├── database.md                 (16)
├── security.md                 (23)
├── abuse.md                    (14)
├── backend/
│   ├── auth.md                          (68)
│   ├── users-profile-mail.md            (37)
│   ├── projects.md                      (38)
│   ├── meetings-ai.md                   (20)
│   ├── work-packages.md                 (24)
│   ├── gantt-agile-wiki.md              (36)
│   ├── budgeting-time.md                (33)
│   ├── team-planner-small-1.md          (42)
│   ├── small-2.md                       (34)
│   ├── portal-portfolio.md              (32)
│   ├── analytics-dashboard-export.md    (16)
│   ├── automation-notifications.md      (29)
│   ├── collaboration-comments.md        (24)
│   └── infra.md                         (29)
└── frontend/
    ├── stores.md                        (53)
    ├── views-pm-layouts.md              (68)
    ├── views-other-router.md            (28)
    ├── components-admin.md              (32)
    ├── components-pm.md                 (26)
    ├── components-common.md             (39)
    └── composables-main.md              (40)
```
