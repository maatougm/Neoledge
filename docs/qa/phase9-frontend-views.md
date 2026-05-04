# Phase 9 — Frontend Views QA Fix Summary

**Date:** 2026-04-20  
**Build status:** GREEN (type-check + vite build pass, zero errors)

---

## Fixes applied

### PM Views

| # | File | Fix |
|---|------|-----|
| 1 | `SprintBoardView.vue` | Added `onUnmounted(() => { chartInstance?.destroy(); chartInstance = null })` to prevent Chart.js ResizeObserver leak on unmount. |
| 2 | `GanttView.vue` | Added `onUnmounted` to remove `mousemove`/`mouseup` listeners registered on `window` during drag. Prevents stale drag handler after navigation. |
| 3 | `GanttView.vue` | `totalWidth` now derived from `headerCols.value.length * colWidth.value` instead of hardcoded 30-day month constant, fixing timeline/column-count drift at `zoom=month`. |
| 4 | `WorkPackagesView.vue` | Bulk status update converted from `Promise.all` → `Promise.allSettled`; toast now reports `N mis à jour, M échec(s)` instead of silently swallowing partial failures. `clearSelection()` + `load()` always called after. |
| 5 | `KanbanBoardView.vue` | Removed duplicate `onMounted(load)`. Consolidated into a single `onMounted(async () => { collab.joinProject(props.id); await load() })`. |
| 6 | `PMProjectsPage.vue` + `pmStore.ts` | `closeDetail()` no longer mutates `store.currentProject` directly. New `clearCurrent()` store action added; `closeDetail` calls `store.clearCurrent()`. |
| 7 | `BacklogView.vue` | `onDrop()` now uses `wpStore.moveCard()` instead of calling `api.patch()` directly. Removed direct `api` import. |
| 8 | `GanttView.vue` | Removed `acceptClass: 'p-button-danger'` from `useNeoConfirm.require(...)`. |
| 9 | `WikiView.vue` | Removed `acceptClass: 'p-button-danger'` from `useNeoConfirm.require(...)`. |
| 10 | `BudgetView.vue` | Removed `acceptClass: 'p-button-danger'` from `useNeoConfirm.require(...)`. Also removed from `WorkPackageDetail.vue`. |
| 11 | `BudgetView.vue` | `load()` no longer auto-upserts an empty budget on first visit. Budget is only created on explicit user action (clicking "Modifier budget" → save). |
| 12 | `WikiView.vue` | Slug-watch race condition fixed with a generation counter (`_fetchGen`). Stale responses are discarded when a newer slug navigation has fired. |
| 13 | `TeamPlannerView.vue` | Added `fromDate <= toDate` validation before fetch. Shows a warning toast when inverted. Added `useNeoToast()` import. |

### Notification / Layout

| # | File | Fix |
|---|------|-----|
| 14 | `NotificationPanel.vue` | `handleItemClick` for `ProjectManager` role now navigates to `{ name: 'pm-project-detail', params: { id: ... } }` (path param) instead of deprecated `{ name: 'pm-projects', query: { projectId: ... } }`. Team role likewise uses `team-project-detail`. |

### Router / Other Views

| # | File | Fix |
|---|------|-----|
| 15 | `router/index.ts` | Elise `?Guid=` flow now short-circuits when `auth.isAuthenticated` (JWT already present). Added origin validation: rejects JWT if the response URL does not start with the configured `apiUrl` origin. |
| 16 | `lib/jwt.ts` | `isTokenExpired`: missing `exp` claim now returns `true` (treat as expired) instead of `false` (forever-valid). Added JSDoc warning that `decodeJwt` is base64-decode only, not signature verification. |
| 17 | `HomeView.vue` | Fixed `/admin/project` (singular, 404) → `/admin/projects` (plural) in both `loadPendingValidations` and `loadMilestones`. |
| 18 | `CustomActionView.vue` | `postMessage` target origin changed from hardcoded `'*'` to `new URL(app.apiUrl).origin`, falling back to `'*'` with a console warning if `apiUrl` is not set. |
| 19 | `types/user.types.ts` | `UserRole` widened to `KnownUserRole \| (string & {})` to accept custom roles from `/auth/me` without casting. Added `getUserRoleLabel(role)` helper that falls back to the raw value for unknown roles. `USER_ROLE_LABELS` typed as `Record<string, string \| undefined>` to satisfy all call sites. |
| 20 | `types/index.d.ts` | Fixed typo `aomalies` → `anomalies` in `ResponseModel` interface. |

### Incidental fixes (required for green build)

| File | Fix |
|------|-----|
| `pmStore.ts` | Added `computed` import; added `projects` as a `computed<ProjectSummary[]>` derived from `projectsView` / `myProjects` / `teamProjects`, exported in return — restores the public `store.projects` API that all consumers depend on. Added `clearCurrent()` action. |
| `MeetingExtrasTabs.vue` | `newOutcome.type` typed as `'Decision' \| 'Action' \| 'Note' \| 'Risk'` instead of `string` to match the store action signature. |

---

## Skipped (per instructions)

- Dev auto-login in router (`router/index.ts:375-381`) — user explicitly requested to keep as-is.
- `quickAccounts` in `LoginView.vue` — user explicitly requested to keep as-is.
- `NeoTag severity="warn"` in `BudgetView.vue` — kept as-is per instruction (`"warn"` is the correct NeoLibrary value, not `"warning"`).

---

## Files changed

- `web/Front/customapp/src/views/SprintBoardView.vue`
- `web/Front/customapp/src/views/GanttView.vue`
- `web/Front/customapp/src/views/WorkPackagesView.vue`
- `web/Front/customapp/src/views/KanbanBoardView.vue`
- `web/Front/customapp/src/views/PMProjectsPage.vue`
- `web/Front/customapp/src/views/BacklogView.vue`
- `web/Front/customapp/src/views/BudgetView.vue`
- `web/Front/customapp/src/views/WikiView.vue`
- `web/Front/customapp/src/views/TeamPlannerView.vue`
- `web/Front/customapp/src/views/HomeView.vue`
- `web/Front/customapp/src/views/CustomActionView.vue`
- `web/Front/customapp/src/layouts/NotificationPanel.vue`
- `web/Front/customapp/src/router/index.ts`
- `web/Front/customapp/src/lib/jwt.ts`
- `web/Front/customapp/src/stores/pmStore.ts`
- `web/Front/customapp/src/types/user.types.ts`
- `web/Front/customapp/src/types/index.d.ts`
- `web/Front/customapp/src/components/workpackages/WorkPackageDetail.vue`
- `web/Front/customapp/src/components/meetings/MeetingExtrasTabs.vue`
