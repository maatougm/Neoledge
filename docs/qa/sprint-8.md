# Sprint 8 — Frontend Store-Logout Cleanup

**Objective:** Make every Pinia store reset on logout so leftover data from
one user never leaks into the next session, and stop all polling timers so
they don't keep firing after the JWT is gone.

## Approach

Pinia setup-style stores (`defineStore(id, () => {...})`) don't auto-generate
`$reset`, so a tiny pub/sub bus was introduced:

- `src/stores/logoutBus.ts` (new) — exports `onLogout(fn)`, `offLogout(fn)`,
  `fireLogout()`, `_clearHandlers()` (test-only). Handlers are stored in a
  `Set<ResetFn>`; `fireLogout()` iterates and swallows per-handler errors.
- `authStore.clear()` now calls `fireLogout()` after wiping JWT state, and
  also dispatches a `window` `CustomEvent('auth:logout')` for any non-store
  consumer that wants to react to logout (composables, tests, ad-hoc code).
- Every per-user store defines a module-local `reset()` function and calls
  `onLogout(reset)` at setup time, right before the store's return block.

## Files modified

| File | Change |
|------|--------|
| `src/stores/logoutBus.ts` | **NEW** — pub/sub registry for logout reset handlers |
| `src/stores/authStore.ts` | `clear()` now calls `fireLogout()` + dispatches `'auth:logout'` CustomEvent |
| `src/stores/notificationStore.ts` | `reset()` — stops polling + clears `notifications`, `loading`, `error`. Listener registered. |
| `src/stores/pmStore.ts` | `reset()` — calls `stopAiPolling()` then clears every ref. Listener registered. |
| `src/stores/projectStore.ts` | `reset()` clears projects, currentProject, activities, templates, deletedProjects, loading, error, searchQuery, statusFilter, totalProjects, selectedProjectIds. |
| `src/stores/userStore.ts` | `reset()` clears users, loading, error. |
| `src/stores/templateStore.ts` | `reset()` clears templates, currentTemplate, loading, error. |
| `src/stores/commentStore.ts` | `reset()` clears comments, loading, error. |
| `src/stores/analyticsStore.ts` | `reset()` + per-metric error refs (`phaseVelocityError`, `bottleneckError`, `deadlineRiskError`, `teamWorkloadError`). `fetchAll()` now uses `Promise.allSettled`, logs each rejection via `console.error('[analyticsStore] … failed:', reason)`, and individual `fetch*()` helpers re-throw so they surface to allSettled. |
| `src/stores/workPackageStore.ts` | `reset()` clears items, total, currentWp, customFields, loading, error. |
| `src/stores/agileStore.ts` | `reset()` clears boards, currentBoard, sprints, currentSprint, burndown, loading. |
| `src/stores/ganttStore.ts` | `reset()` clears workPackages, milestones, dependencies, baselines, loading. |
| `src/stores/timeStore.ts` | `reset()` clears myEntries, projectEntries, weekEntries, summary, loading. |
| `src/stores/budgetStore.ts` | `reset()` clears budget, burn, loading. |
| `src/stores/wikiStore.ts` | `reset()` clears tree, currentPage, revisions, loading. |
| `src/stores/portfolioStore.ts` | `reset()` clears portfolios, currentPortfolio, versions, loading. |
| `src/stores/teamPlannerStore.ts` | `reset()` clears assignments, capacity, conflicts, loading. |
| `src/stores/meetingExtrasStore.ts` | `reset()` clears agenda, attendees, outcomes. |
| `src/stores/roleStore.ts` | `reset()` clears roles, catalog, loading, error. |
| `src/stores/savedFiltersStore.ts` | `reset()` clears filters, activeFilter, loading, error. |

All 17 domain stores listed in the sprint plan now register a reset handler.
Each store's returned object additionally exposes `reset` so Vitest specs can
call it directly.

## Polling timers stopped on logout

- **notificationStore** — `pollingTimer` (30 s interval from `startPolling`)
  is cleared in `reset()` via `stopPolling()`.
- **pmStore** — `aiPolling` (5 s AI-results interval from `resumeAiPolling` /
  `triggerAiAnalysis`) is cleared in `reset()` via `stopAiPolling()`.

No other timers were found across the Pinia stores audited in this sprint.

## `useApp.ts` status — RETAINED (flagged)

`src/stores/useApp.ts` has 15+ active references across the codebase and is
not safe to delete as a drive-by change in this sprint:

- Components/views: `components/auth/TotpChallenge.vue`,
  `components/pm/CommentsSection.vue`, `views/AdminView.vue`,
  `views/ProjectManagerView.vue`, `views/CustomActionView.vue`.
- Tests: `stores/__tests__/useApp.spec.ts`,
  `stores/__tests__/pmStore.spec.ts`,
  `stores/__tests__/projectStore.spec.ts`,
  `stores/__tests__/templateStore.spec.ts`,
  `stores/__tests__/userStore.spec.ts`,
  `stores/__tests__/trashStore.spec.ts`,
  `stores/__tests__/bulkActions.spec.ts`,
  `components/__tests__/ActivitySection.spec.ts`,
  `components/__tests__/CommentsSection.spec.ts`,
  `components/__tests__/ValidationTimeline.spec.ts`.

Recommendation (follow-up ticket): migrate each caller to `authStore` /
`configStore` / `api` helpers, update the specs' `vi.mock('../useApp', …)`
hoists, then delete `useApp.ts`. That migration is larger than Sprint 8's
stated scope and would touch test files outside the "logout reset" theme,
so it was deliberately left out here.

## Constraints honored

- `test-login`, `quickAccounts`, `LoginView`, and `authStore.login()` were
  not touched.
- No `$reset` was attempted — each setup-style store has a hand-written
  `reset()` because Pinia setup stores don't generate one automatically.
- Each store's `reset()` mirrors its initial ref values exactly (empty
  arrays/Maps/Sets, `null` for object refs, `false` for booleans, `null`
  for error strings).

## Build status

```
npm run build
✓ built in 10.78s
```

No TypeScript errors, no Vite errors. Only pre-existing chunk-size warning
(neolibrary.js 971 kB) — unrelated to this sprint.

## Tests

No new specs were added in this sprint (scope was the reset plumbing itself).
Recommended follow-up specs:

1. `logoutBus.spec.ts` — register multiple handlers, `fireLogout()` invokes
   all of them, a throwing handler does not block the rest, `_clearHandlers`
   empties the registry.
2. `authStore.clear.spec.ts` — calling `clear()` dispatches `auth:logout`
   and invokes every registered handler.
3. Per-store `reset.spec.ts` — populate each store via its actions, call
   `reset()`, assert all refs are back to initial values (and that polling
   timers are cleared for notification/pm stores).
