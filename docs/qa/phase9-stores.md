# Phase 9 — Store Fixes (Sprint post-8 cleanup)

## Status: COMPLETE — build green ✓

---

## Fixes applied

### 1. `roleStore.ts` — Immutability violations (HIGH)
- `createRole` and `cloneRole`: replaced `.push(resp.data)` with `roles.value = [...roles.value, resp.data]`
- `updateRole`: replaced index assignment `roles.value[idx] = resp.data` with `roles.value = roles.value.map(r => r.id === id ? resp.data : r)`
- All 7 actions (`createRole`, `updateRole`, `deleteRole`, `cloneRole`, `assignRole`, `unassign`, `listUserAssignments`) now have try/catch that sets `error.value` and re-throws so callers see failures

### 2. `workPackageStore.ts` — Silent catch blocks (HIGH)
- Added local `_errMsg(err)` helper
- All 10 actions with `catch {}` now populate `error.value` and log to `console.error('[workPackageStore] ...')`
- `createCustomField`, `deleteCustomField`, `upsertCustomValues`: added try/catch wrapping (were bare awaits with no error handling)

### 3. `agileStore.ts` / `ganttStore.ts` / `budgetStore.ts` / `wikiStore.ts` / `portfolioStore.ts` / `teamPlannerStore.ts` / `timeStore.ts` / `meetingExtrasStore.ts` — No error state (HIGH)
- Added `error = ref<string | null>(null)` to each store
- Added local `_errMsg(err)` helper to each
- Wrapped every action in try/catch: sets `error.value`, logs `console.error('[<storeName>] <action>', err)`, and re-throws for callers
- Exposed `error` in each store's return object
- Cleared `error.value` in each store's `reset()` function
- `agileStore`: removed unused `UserSummary` import
- `teamPlannerStore`: extracted `ConflictRow` named type (replaces `typeof conflicts.value` implicit type)
- `agileStore.fetchBurndown`: typed response as `{ sprint: Sprint; days: {...}[] }` (drops implicit `any` cast)
- `meetingExtrasStore.addOutcome`: narrowed `type` param from `string` to `Outcome['type']`

### 4. `pmStore.ts` — `(e as any)` cast in `uploadMeeting` (HIGH)
- Replaced `(e as any)?.response?.data?.message` with `e instanceof Error ? e.message : String(e)`

### 5. `pmStore.ts` — `aiPolling` reactive ref (MEDIUM)
- Changed `const aiPolling = ref<ReturnType<typeof setInterval> | null>(null)` to `let _aiPolling: ReturnType<typeof setInterval> | null = null`
- Updated `stopAiPolling`, `resumeAiPolling`, `triggerAiAnalysis` to use the non-reactive `_aiPolling`
- Eliminates unnecessary Vue reactivity updates on every timer id change

### 6. `pmStore.ts` — `fetchMyProjects` / `fetchTeamProjects` shared ref race condition (HIGH)
- Split `const projects = ref<ProjectSummary[]>([])` into `myProjects` and `teamProjects`
- Added `projectsView = ref<'mine' | 'team'>('mine')` to track which list was last populated
- `fetchMyProjects` writes `myProjects` and sets `projectsView = 'mine'`
- `fetchTeamProjects` writes `teamProjects` and sets `projectsView = 'team'`
- `reset()` clears both refs + resets `projectsView`
- Exposed `myProjects`, `teamProjects`, `projectsView` in return (removed legacy `projects` alias)
- Updated 3 consumer views:
  - `ProjectManagerView.vue`: `store.projects` → `store.myProjects`
  - `TeamMemberView.vue`: `store.projects` → `store.teamProjects`
  - `PMProjectsPage.vue`: `store.projects` → `store.myProjects`

### 7. `commentStore.ts` — Duplicated JWT decode (HIGH)
- Replaced custom JWT decode in `currentUserId` computed with `computed(() => useAuthStore().userId)`
- Eliminated the inline `atob` / JSON.parse path that could drift from `authStore`

### 8. `projectStore.ts` — `searchProjects` race + stale filter refs (HIGH)
- Added `let _searchAbort: AbortController | null = null`
- `searchProjects`: aborts previous in-flight request before starting a new one
- Moved `searchQuery.value` / `statusFilter.value` assignment to **after** successful fetch (previously before the request)
- On network failure or abort, reverts `searchQuery` / `statusFilter` to their previous values so the UI list and filter bar stay consistent
- Handles axios `CanceledError` (aborted requests silently ignored — not treated as errors)
- `reset()` aborts any pending request and nulls `_searchAbort`

---

## Issues deferred (not in scope for this sprint)

The following items from `stores.md` remain open per the original constraint (minimal-diff, sprint 8 already closed items excluded):

| Severity | Issue | Reason deferred |
|----------|-------|----------------|
| CRITICAL | `useApp.ts` — parallel auth store, global axios intercept | Requires broader refactor; 15+ live refs per sprint 8 decision |
| CRITICAL | Logout `$reset` on all stores | Partially addressed (each store already has `reset()` + `onLogout`); full coordinated reset requires authStore surgery |
| CRITICAL | `notificationStore` / `pmStore` polling timers not stopped on logout | Already fixed in Sprint 8 |
| MEDIUM | `uiStore` localStorage user-keying | Out of scope |
| LOW | Inline type consolidation into `@/types/*.types.ts` | Out of scope |

---

## Build result

```
✓ built in 6.96s  (0 errors, pre-existing CSS warnings only)
```
