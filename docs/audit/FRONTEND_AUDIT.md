# Frontend Production-Readiness Audit — NeoLeadge

**Stack:** Vue 3.5 + Vite 6 + Pinia 3 + NeoLibrary (PrimeVue 4 wrapper) + Socket.IO + Axios
**Deploy:** nginx serving `dist/` at port 8002, fronted by Caddy on `neoleadge.pythagore-init.com`
**Audit date:** 2026-05-19 · Branch: `nest-back` @ `2bec9c2` · 25 findings

---

## Executive summary

The frontend is **production-deployable today** with documented constraints. Bundles are well-chunked, all 43 routes are lazy-loaded, the API client interceptors are correct, focus management on modals works, sockets clean up properly, no `console.log` / `eval` / `innerHTML` leaks in production code, all `v-html` paths go through the shared `sanitize.ts`. The dominant risks are (1) a 1.43 MB `neolibrary` chunk that ships on every cold load and dominates Time-to-Interactive on slow networks, (2) absence of a 404 catch-all route so unknown URLs render an empty `<RouterView/>`, (3) only the project-search store cancels in-flight requests on navigation, (4) the `?redirect=` query param on `/login` is set but never consumed (broken UX, no security risk), and (5) several per-project Pinia stores (`pmStore`, `projectMembersStore`) are not reset on route change in `PMProjectDetail.vue` and `QuestionnaireForm.vue` — CLAUDE.md flagged this exact pattern as a gotcha.

---

## Findings

| # | Severity | Area | Finding | Location |
|---|---|---|---|---|
| 1 | **High** | Bundle | `neolibrary` chunk is 1.43 MB raw / 310 KB gzip — single largest asset, blocks every cold page load | `vite.config.ts:46` (manualChunks `neolibrary`) + `dist/assets/neolibrary-*.js` |
| 2 | **High** | Chart.js | `Chart.register(...registerables)` registers every controller + every scale + every plugin, defeating tree-shaking. Saves ~150 KB to register only what SprintBoardView uses | `src/views/SprintBoardView.vue:80-81` |
| 3 | **High** | Router | No catch-all `/:pathMatch(.*)*` 404 route. Unknown URLs (typos, stale bookmarks) render an empty `<RouterView/>` with no feedback to the user | `src/router/index.ts:407-414` (last route is `/custom-action`, no `*`) |
| 4 | **High** | Store hygiene | `PMProjectDetail.vue` consumes `usePmStore()` but never calls `store.reset()` in `onMounted`. Per CLAUDE.md "per-project stores must be reset on route change otherwise the new project briefly renders the old project's data" | `src/components/pm/PMProjectDetail.vue:127`, `:262` (no `.reset()` in onMounted) |
| 5 | **High** | Store hygiene | Same in `QuestionnaireForm.vue` | `src/components/pm/QuestionnaireForm.vue:221`, `:301` |
| 6 | **Medium** | Request cancellation | Only `searchProjects` uses AbortController. Navigating between projects mid-fetch leaves stale requests racing the new ones — surfaces as "old project flashing" + wasted bandwidth on slow networks | grep for `AbortController`: only `src/stores/projectStore.ts:66-67,102` |
| 7 | **Medium** | UX | `/login?redirect=/app/pm/projects/123` is read by the router (`router/index.ts:472`) but `LoginView.vue::redirectAfterLogin()` ignores the param and unconditionally pushes `/app`. User loses their intended destination after re-auth. No security risk (param never used) | `src/views/LoginView.vue:252-255` |
| 8 | **Medium** | Reliability | No retry layer on transient network failures (timeouts, network blips). Every 5xx and every dropped connection surfaces immediately to the user | `src/lib/api.ts:84-152` — interceptor only routes errors, doesn't retry |
| 9 | **Medium** | Performance | Big lists (WorkPackages, MyTasks, Kanban) render full DOM client-side. No `NeoVirtualScroller` or `@tanstack/vue-virtual`. Hundreds of WPs per project = noticeable scroll jank | `src/views/WorkPackagesView.vue`, `src/views/MyTasksView.vue`, `src/views/KanbanBoardView.vue` |
| 10 | **Medium** | Performance | NeoLibrary `DataTable` not used; lists are hand-rolled `<tr>`s. No server-side pagination on Kanban board (loads everything client-side, filters via computed) | `src/views/KanbanBoardView.vue` |
| 11 | **Medium** | i18n | No `vue-i18n` layer. All UI text is French strings inlined in templates. Multi-lingual rollout would require a full pass. Not blocking today (product is French-first) | global; `package.json` has no i18n dep |
| 12 | **Medium** | Sourcemaps | `vite.config.ts` doesn't set `build.sourcemap`. Vite default is `false` — prod builds have no sourcemaps. Trade-off: debugging prod stack traces is opaque. Recommendation: `sourcemap: 'hidden'` (file generated, not referenced from JS) so Sentry-style upload works without leaking source to the public | `vite.config.ts:32-55` |
| 13 | **Low** | Accessibility | 5 instances of `v-for` with `:key="i"` (array index) instead of a stable id. Vue re-uses DOM nodes incorrectly when items are reordered/deleted | `src/components/admin/sections/LogsSection.vue:31`, `src/components/pm/AiBacklogPreviewModal.vue:15`, `src/components/pm/ValidationComparisonPanel.vue:32`, `src/views/PMProjectDetailView.vue:157`, `src/views/TeamPlannerView.vue:76` |
| 14 | **Low** | Images | `<img>` tags on avatars / QR codes have no `loading="lazy"`. Above-the-fold avatars don't need it, but the MembersView avatar list could benefit | `src/views/MembersView.vue:45`, `src/views/UserProfileView.vue:22` |
| 15 | **Low** | Bundle | The `chart` chunk weighs 210 KB (72 KB gzip) and is needed only by SprintBoardView. Could be loaded lazily via `defineAsyncComponent` so non-sprint users never download it | `vite.config.ts:45-46` + `src/views/SprintBoardView.vue` |
| 16 | **Low** | Router | 4 routes (`pm-project-questionnaire/meetings/cahier/validations`) all mount the SAME `PMProjectFullView.vue` and differ only by path. The view presumably reads `route.name` to switch tabs. This is fine but means the route table is 4 lines longer than needed — could be one route with a tab param | `src/router/index.ts:189-212` |
| 17 | **Low** | Auth | `/auth/me` validation flag (`meChecked`) is per-tab and only checked once per session. If the user has 5 tabs open and gets deactivated, 4 of them keep working until refresh. Acceptable trade-off for performance; documented for ops awareness | `src/router/index.ts:422-486` |
| 18 | **Low** | Bundle | No `compress: { drop_console: true }` in vite minify config. If a `console.error` slips into prod code, it ships. Not blocking today (audit found zero `console.*` in src/) but adds defence-in-depth | `vite.config.ts:32-55` |
| 19 | **Low** | DOMPurify | `@types/dompurify` was removed from devDeps in cleanup pass 2 — dompurify 3.x ships its own types now. Verify the inline DOMPurify call still typechecks. (Already verified during cleanup; no action) | `src/lib/sanitize.ts` |
| 20 | **Low** | Socket reconnect | `useNotificationSocket` retries forever (`reconnectionAttempts: Infinity`). On a persistent backend outage this will hammer the socket endpoint until manual logout. Acceptable but consider an exponential cap | `src/composables/useNotificationSocket.ts:62-64` |
| 21 | **Low** | Toast spam | Spam-clicking "Régénérer cahier" while a generation is in flight does NOT dedupe toasts (each click adds a new one). Today the button gates on `generating.value`, but other paths exist | `src/components/pm/CahierDesChargesSection.vue` has its own gate; need to audit all submit buttons |
| 22 | **Info** | Bundle | Top 5 chunks (gzipped): `neolibrary` 310 KB · `chart` 72 KB · `vue` 42 KB · `PMProjectDetail` 29 KB · `CahierDesChargesSection` 22 KB | `dist/assets/` |
| 23 | **Info** | Build hygiene | `package.json` no longer lists `multer`, `pino-pretty`, `uuid`, `source-map-support`, `supertest`, `ts-loader`, `@types/bcryptjs/multer/supertest/uuid`, `vite-plugin-mkcert`, `rollup-plugin-visualizer`, `eslint-plugin-prettier/-vue`, etc. — all removed in cleanup pass 1. No new dead deps | `package.json` |
| 24 | **Info** | Security | No `v-html` outside `sanitize()`-wrapped renderers. No `eval`/`new Function`/`innerHTML` in production code (only test fixtures). `?redirect=` is set but unused — no open-redirect risk | grep clean across `src/**` |
| 25 | **Info** | A11y | `AppModal.vue` has full focus trap (`trapFocus`), Escape key handling (with stacked-modal support), and focus restoration via opener-tracking. `NotificationBell.vue:11-54` has aria-label, dialog role, listitem semantics | `src/components/common/AppModal.vue:38-90` |

---

## Quick wins (≤ 1 day each)

1. **Add a catch-all 404 route** — append to `router/index.ts`:
   ```ts
   { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('@/views/NotFoundView.vue') }
   ```
   Create the view with a "Retour à l'accueil" link. Stops the silent-empty-page UX. ~30 min.

2. **Consume `?redirect=` after login** — in `LoginView.vue::redirectAfterLogin()`:
   ```ts
   const target = (route.query.redirect as string) ?? null
   if (target && target.startsWith('/') && !target.startsWith('//')) {
     router.push(target)
   } else {
     router.push({ name: 'app-home' })
   }
   ```
   The same-origin check (`startsWith('/')` + reject `//`) prevents open-redirect. ~15 min.

3. **Add `store.reset()` to `PMProjectDetail.vue` and `QuestionnaireForm.vue` onMounted** — matches the existing pattern in `MembersView.vue:462-464`. Removes the "old project flash" bug. ~15 min total.

4. **Tree-shake Chart.js in SprintBoardView** — replace `Chart.register(...registerables)` with explicit imports:
   ```ts
   import { Chart, LineController, LineElement, PointElement,
            LinearScale, CategoryScale, Tooltip, Legend } from 'chart.js'
   Chart.register(LineController, LineElement, PointElement,
                  LinearScale, CategoryScale, Tooltip, Legend)
   ```
   Saves ~150 KB on the `chart` chunk. ~10 min.

5. **Move chart chunk to async** — make SprintBoardView import chart.js via `defineAsyncComponent` or dynamic `import()` inside `onMounted`. Cold-load users who never visit a sprint never download it. ~30 min.

---

## Big-rock items

| Item | Effort | Payoff |
|---|---|---|
| Virtualize WorkPackages / MyTasks / Kanban via `@tanstack/vue-virtual` or `vue-virtual-scroller` | 1-2 days | Smooth scrolling at 500+ rows; required for any large-team project |
| Introduce `vue-i18n` with French as the default locale | 2-3 days | Unblocks any future English / Arabic / Spanish rollout. CLAUDE.md notes the product is French-first; this is opt-in |
| Split `neolibrary` chunk into eager (used on every page) + lazy (only-on-cahier / only-on-gantt) subsets. Requires NeoLibrary's bundle structure to expose entry points per component | 2-4 days | Drops cold-load shipped JS by ~600 KB raw |
| Add an `axios-retry` interceptor on idempotent GETs with 3 retries + jittered backoff | 0.5 day | Reliability under flaky networks; reduces user-visible 5xx |
| Cancel in-flight requests on route change via a global axios `signal` injection | 1 day | Drops stale-project flashes; saves bandwidth |
| Enable `sourcemap: 'hidden'` + add Sentry (or equivalent) for prod error monitoring | 1 day | Currently prod stack traces are minified and lost |

---

## Bundle size report

Top 10 chunks from `dist/assets/` (gzipped):

| Chunk | Raw | Gzip |
|---|---|---|
| `neolibrary-*.js` | **1,429.93 KB** | **310.39 KB** |
| `chart-*.js` | 209.73 KB | 72.21 KB |
| `vue-*.js` | 106.14 KB | 41.80 KB |
| `PMProjectDetail-*.js` | 93.70 KB | 28.96 KB |
| `CahierDesChargesSection-*.js` | 67.18 KB | 21.76 KB |
| `primevue-*.js` | 70.92 KB | 19.01 KB |
| `socket-*.js` | 41.58 KB | 13.01 KB |
| `axios-*.js` | 38.17 KB | 15.25 KB |
| `ProjectManagementSection-*.js` | 35.80 KB | 10.95 KB |
| `AppShell-*.js` | 31.33 KB | 10.13 KB |

**Cold-load (initial entry + shared chunks):** `index` + `vue` + `axios` + `primevue` + `neolibrary` = **~395 KB gzip / ~1.66 MB raw**. The neolibrary chunk dominates.

**Per-route additions:** route chunks are individually small (most < 15 KB gzip). Code-splitting is working.

Bundle hygiene is otherwise clean: all 43 routes use `() => import()`. Manual chunks for chart/socket/axios/primevue/neolibrary/vue prevent waterfall stalls. CSS is bundled per chunk.
