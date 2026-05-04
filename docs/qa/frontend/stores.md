# Stores QA — `web/Front/customapp/src/stores/`

Files opened:
- C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\stores\authStore.ts
- C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\stores\configStore.ts
- C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\stores\useApp.ts
- C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\stores\uiStore.ts
- C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\stores\notificationStore.ts
- C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\stores\templateStore.ts
- C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\stores\commentStore.ts
- C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\stores\savedFiltersStore.ts
- C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\stores\pmStore.ts
- C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\stores\analyticsStore.ts
- C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\stores\userStore.ts
- C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\stores\workPackageStore.ts
- C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\stores\agileStore.ts
- C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\stores\ganttStore.ts
- C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\stores\timeStore.ts
- C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\stores\budgetStore.ts
- C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\stores\wikiStore.ts
- C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\stores\portfolioStore.ts
- C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\stores\teamPlannerStore.ts
- C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\stores\meetingExtrasStore.ts
- C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\stores\projectStore.ts
- C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\stores\roleStore.ts
- C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\stores\uiStore.ts (re-opened above)
- C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\lib\api.ts (for cross-reference of interceptor / 401 handling)

Note: `__tests__/` intentionally skipped per instructions.

---

## CRITICAL

### [CRITICAL] Legacy `useApp` store registers global axios interceptors at module import
- File: `web/Front/customapp/src/stores/useApp.ts:8-15`
- Category: auth
- Evidence:
```ts
axios.interceptors.response.use(null, (error) => {
  const url: string = error.config?.url ?? ''
  const isAuthEndpoint = url.includes('/auth/login') || url.includes('/hook/auth')
  if (error.response?.status === 401 && !isAuthEndpoint) {
    router.push({ name: 'login' })
  }
  return Promise.reject(error)
})
```
- Impact: Any file importing `useApp` (even indirectly) patches the GLOBAL `axios` singleton; this fires side effects at module evaluation, stacks multiple handlers if the module is re-evaluated under test, and silently collides with the proper interceptor stack in `src/lib/api.ts`.
- Fix: Move interceptors into an `init()` action or delete the legacy `useApp` store (the code in `src/lib/api.ts` already owns this responsibility).

### [CRITICAL] `useApp` store bypasses `authStore` and maintains its own JWT + apiUrl state
- File: `web/Front/customapp/src/stores/useApp.ts:27-29`, `useApp.ts:105-118`, `useApp.ts:55-61`
- Category: auth
- Evidence:
```ts
const jwt = ref('')
const apiUrl = ref('')
const eliseUrl = ref('')
...
const userRole = computed<string | null>(() => {
  if (!jwt.value) return null
  try {
    const payload = JSON.parse(atob(jwt.value.split('.')[1]))
```
- Impact: Two sources of truth for JWT/apiUrl/role coexist (`authStore` + `useApp`); a login that writes `authStore.jwt` will not update `useApp.jwt`, causing components that read `useApp.userRole` to stay logged-out or stale. Also decodes JWT directly rather than using `@/lib/jwt`.
- Fix: Delete `useApp.ts` or reduce it to thin re-exports that proxy through `authStore` + `configStore`.

### [CRITICAL] `useApp.logout` does not clear localStorage — JWT resurrects on refresh
- File: `web/Front/customapp/src/stores/useApp.ts:73-81`
- Category: auth
- Evidence:
```ts
const logout = async () => {
  jwt.value = ''
  mustChangePassword.value = false
  try {
    await axios.get(apiUrl.value + '/hook/logout')
  } catch {
    // ignore — we've already cleared the local JWT
  }
}
```
- Impact: Unlike `authStore.logout` (which calls `_clearStorage()` via `clear()`), this legacy logout leaves the `nl_jwt` key in `localStorage`, so on next app boot `authStore.init()` re-authenticates the "logged-out" user.
- Fix: Remove this path; route all logouts through `authStore.logout`.

### [CRITICAL] No stores expose a coordinated reset on logout — stale data leaks across sessions
- File: `web/Front/customapp/src/stores/authStore.ts:141-152`, `authStore.ts:161-168`
- Category: data-integrity
- Evidence:
```ts
const logout = async (): Promise<void> => {
  const config = useConfigStore()
  const token = jwt.value
  clear()
  ...
}
...
const clear = (): void => {
  jwt.value = ''
  mustChangePassword.value = false
  globalPermissions.value = new Set()
  projectPermissions.value = new Map()
  assignedRoles.value = []
  _clearStorage()
}
```
- Impact: `authStore.clear()` resets only auth-scoped refs. Every other store (`projectStore.projects`, `pmStore.*`, `userStore.users`, `commentStore.comments`, `notificationStore.notifications`, `wikiStore`, `workPackageStore`, `timeStore`, `budgetStore`, `ganttStore`, `agileStore`, `teamPlannerStore`, `meetingExtrasStore`, `portfolioStore`, `roleStore`, `savedFiltersStore`, `analyticsStore`, `templateStore`, `pmStore.aiPolling`) retains the previous user's in-memory data after logout. If user A logs out and user B logs in on the same tab, they briefly see A's cache. Per-user data like `commentStore.currentUserId` is a JWT-derived computed so it refreshes, but the cached content does not.
- Fix: Add a `$reset` action to every store (or use `store.$reset()` on setup-stores) and invoke them from `authStore.logout` before redirecting.

### [CRITICAL] `pmStore.aiPolling` and `notificationStore.pollingTimer` leak on logout / SPA navigation
- File: `web/Front/customapp/src/stores/pmStore.ts:31`, `pmStore.ts:205-210`, `pmStore.ts:239-242`; `notificationStore.ts:21`, `notificationStore.ts:91-104`
- Category: perf
- Evidence:
```ts
const aiPolling = ref<ReturnType<typeof setInterval> | null>(null)
...
const resumeAiPolling = (projectId: string, meetingId: string) => {
  stopAiPolling()
  aiPolling.value = setInterval(() => {
    void fetchAiResults(projectId, meetingId)
  }, 5000)
}
```
```ts
let pollingTimer: ReturnType<typeof setInterval> | null = null
...
const startPolling = (): void => {
  if (pollingTimer !== null) return
  fetchNotifications()
  pollingTimer = setInterval(() => {
    fetchUnreadCount()
  }, POLL_INTERVAL_MS)
}
```
- Impact: `authStore.logout()` does not call `stopPolling()` or `stopAiPolling()`, so a logged-out user keeps hitting `/notifications` every 30s and `/ai-results` every 5s — each request now 401s, triggering the interceptor's `router.push({ name: 'login' })` in a loop.
- Fix: Wire `notificationStore.stopPolling()` and `pmStore.stopAiPolling()` into `authStore.logout()` (or via the proposed global reset hook).

### [CRITICAL] `analyticsStore.fetchAll` aggregates parallel errors incorrectly — final `error.value` is non-deterministic
- File: `web/Front/customapp/src/stores/analyticsStore.ts:54-106`
- Category: error-handling
- Evidence:
```ts
const fetchAll = async (): Promise<void> => {
  loading.value = true
  error.value = null
  try {
    await Promise.all([
      fetchPhaseVelocity(),
      fetchBottleneck(),
      fetchDeadlineRisk(),
      fetchTeamWorkload(),
    ])
  } finally {
    loading.value = false
  }
}
```
- Impact: Each child fetch swallows its own error into `error.value`; when they race under `Promise.all`, the "last writer wins" message depends on network latency. Furthermore, none of the children rethrow, so `Promise.all` never rejects, and `fetchAll` always resolves successfully even if all four failed.
- Fix: Use `Promise.allSettled`, collect per-field errors, and expose them as `{ phaseVelocityError, bottleneckError, ... }` or an array so the UI can render per-widget failures.

---

## HIGH

### [HIGH] `roleStore.createRole`, `cloneRole`, `updateRole` mutate the roles array with `.push` / index assignment
- File: `web/Front/customapp/src/stores/roleStore.ts:55-57`, `roleStore.ts:64-67`, `roleStore.ts:77`
- Category: logic
- Evidence:
```ts
const resp = await api.post<RoleSummary>('/admin/roles', input)
roles.value.push(resp.data)
return resp.data
...
const resp = await api.patch<RoleSummary>(`/admin/roles/${id}`, input)
const idx = roles.value.findIndex((r) => r.id === id)
if (idx >= 0) roles.value[idx] = resp.data
...
roles.value.push(resp.data)
```
- Impact: Violates the mutation ban in `CLAUDE.md` (immutability rule). Works fine with Pinia reactive proxies but breaks the project's own "NEVER mutate existing" rule and is inconsistent with every other store (which uses spread).
- Fix: Replace with `roles.value = [...roles.value, resp.data]` and `roles.value = roles.value.map(r => r.id === id ? resp.data : r)`.

### [HIGH] `roleStore` actions (`createRole`, `updateRole`, `deleteRole`, `cloneRole`, `assignRole`, `unassign`, `listUserAssignments`) have no try/catch — rejections bubble unhandled if callers forget
- File: `web/Front/customapp/src/stores/roleStore.ts:50-98`
- Category: error-handling
- Evidence:
```ts
async function createRole(input: {
  name: string
  description?: string
  permissionKeys: string[]
}): Promise<RoleSummary> {
  const resp = await api.post<RoleSummary>('/admin/roles', input)
  roles.value.push(resp.data)
  return resp.data
}
```
- Impact: If the caller doesn't wrap in try/catch, an unhandled promise rejection bubbles to the window; and `error.value` is never set, so the UI has no indicator.
- Fix: Wrap each in try/catch matching the pattern used by `userStore.createUser`, or rethrow after setting `error.value`.

### [HIGH] `workPackageStore.createCustomField`, `deleteCustomField`, `upsertCustomValues` have no try/catch
- File: `web/Front/customapp/src/stores/workPackageStore.ts:132-144`
- Category: error-handling
- Evidence:
```ts
async function createCustomField(projectId: string, name: string, fieldType: string, options?: string): Promise<void> {
  await api.post(`/pm/projects/${projectId}/wp-custom-fields`, { name, fieldType, options })
  await fetchCustomFields(projectId)
}

async function deleteCustomField(projectId: string, id: string): Promise<void> {
  await api.delete(`/pm/projects/${projectId}/wp-custom-fields/${id}`)
  await fetchCustomFields(projectId)
}

async function upsertCustomValues(projectId: string, wpId: string, values: { customFieldId: string; value?: string }[]): Promise<void> {
  await api.put(`/pm/projects/${projectId}/work-packages/${wpId}/custom-values`, { values })
}
```
- Impact: Unhandled rejections if callers forget; no user-visible error state set.
- Fix: Wrap in try/catch like the other methods in this file, or rethrow and rely on the axios interceptor toast.

### [HIGH] `workPackageStore.fetchOne/create/update/remove/moveCard/...` silently swallow errors with empty `catch {}`
- File: `web/Front/customapp/src/stores/workPackageStore.ts:35-43`, `workPackageStore.ts:45-53`, `workPackageStore.ts:55-65`, `workPackageStore.ts:67-76`, `workPackageStore.ts:78-85`, `workPackageStore.ts:87-94`, `workPackageStore.ts:96-103`, `workPackageStore.ts:105-112`, `workPackageStore.ts:114-121`, `workPackageStore.ts:123-130`
- Category: error-handling
- Evidence:
```ts
async function fetchOne(projectId: string, id: string): Promise<WorkPackage | null> {
  try {
    const { data } = await api.get<WorkPackage>(`/pm/projects/${projectId}/work-packages/${id}`)
    currentWp.value = data
    return data
  } catch {
    return null
  }
}
```
- Impact: The `error` ref is never populated in any of these actions (it is declared at line 14 but only written in `fetchAll`). UI has no way to distinguish "not found" from "network failure". The interceptor toast still fires but the local error state stays stale.
- Fix: Populate `error.value` inside each `catch (e: unknown) { error.value = e instanceof Error ? e.message : '...' }` and drop the swallow pattern.

### [HIGH] `agileStore`, `ganttStore`, `budgetStore`, `wikiStore`, `portfolioStore`, `teamPlannerStore`, `timeStore`, `meetingExtrasStore` have no `error` state and no try/catch
- File: `web/Front/customapp/src/stores/agileStore.ts:40-119`, `ganttStore.ts:26-84`, `budgetStore.ts:40-92`, `wikiStore.ts:36-93`, `portfolioStore.ts:29-81`, `teamPlannerStore.ts:20-54`, `timeStore.ts:31-88`, `meetingExtrasStore.ts:41-113`
- Category: error-handling
- Evidence (sample from `agileStore.ts:48-56`):
```ts
async function fetchBoards(projectId: string) {
  loading.value = true
  try {
    const { data } = await api.get<Board[]>(`/pm/projects/${projectId}/boards`)
    boards.value = data
  } finally {
    loading.value = false
  }
}
```
- Impact: Errors bubble up as uncaught promise rejections if the caller doesn't await+try/catch; stores have no way to surface state to the UI. The shared axios interceptor toasts the error but local state is not rolled back.
- Fix: Add an `error` ref to each store and consistently catch+set error OR rethrow after setting state, matching the pattern in `userStore`/`projectStore`.

### [HIGH] `pmStore.uploadMeeting` uses `any` cast to read axios error
- File: `web/Front/customapp/src/stores/pmStore.ts:178-181`
- Category: types
- Evidence:
```ts
} catch (e: unknown) {
  const axiosMsg = (e as any)?.response?.data?.message
  error.value = axiosMsg ?? (e instanceof Error ? e.message : "Erreur lors de l'envoi de l'enregistrement.")
  return false
}
```
- Impact: Violates the TypeScript `any` prohibition in `~/.claude/rules/typescript/coding-style.md`. The rest of `projectStore.ts` already has a helper (`extractApiError`) that does this safely with `axios.isAxiosError`.
- Fix: Reuse `extractApiError` (extract to `src/lib/apiError.ts`) or narrow with `axios.isAxiosError(e)`.

### [HIGH] `commentStore.currentUserId` decodes JWT directly instead of using `authStore.userId`
- File: `web/Front/customapp/src/stores/commentStore.ts:39-48`
- Category: auth
- Evidence:
```ts
const currentUserId = computed<string | null>(() => {
  const jwt = useAuthStore().jwt
  if (!jwt) return null
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1]))
    return payload['sub'] ?? null
  } catch {
    return null
  }
})
```
- Impact: Re-implements `@/lib/jwt.getUserId` that `authStore.userId` already exposes. Creates two decode paths that can drift (e.g. different claim keys, different error swallowing).
- Fix: `const currentUserId = computed(() => useAuthStore().userId)`.

### [HIGH] `useApp.userRole` decodes JWT directly (same issue as above, in the legacy store)
- File: `web/Front/customapp/src/stores/useApp.ts:105-118`
- Category: auth
- Evidence:
```ts
const userRole = computed<string | null>(() => {
  if (!jwt.value) return null
  try {
    const payload = JSON.parse(atob(jwt.value.split('.')[1]))
    return (
      payload['http://schemas.microsoft.com/ws/2008/06/identity/claims/role'] ??
      payload['role'] ??
      null
    )
  } catch {
    return null
  }
})
```
- Impact: Decodes a legacy .NET role claim. In the current NestJS backend, tokens won't contain that claim, so any component relying on `useApp.userRole` today returns `null` — a silent auth break for stale consumers.
- Fix: Delete `useApp` (see CRITICAL above) or route through `authStore.userRole`.

### [HIGH] `pmStore.fetchMyProjects` and `pmStore.fetchTeamProjects` share the same `projects` ref — race condition
- File: `web/Front/customapp/src/stores/pmStore.ts:40-64`
- Category: logic
- Evidence:
```ts
const fetchMyProjects = async () => {
  ...
  projects.value = [...data]
}
const fetchTeamProjects = async () => {
  ...
  projects.value = [...data]
}
```
- Impact: If a component concurrently calls both (e.g. to show two lists), whichever finishes last clobbers the other. There's no request-id / AbortController.
- Fix: Split into `myProjects` and `teamProjects` refs, or accept a `scope` param and tag the returned state.

### [HIGH] `projectStore.searchProjects` sets `searchQuery`/`statusFilter` BEFORE the request — stays stale on failure
- File: `web/Front/customapp/src/stores/projectStore.ts:89-117`
- Category: data-integrity
- Evidence:
```ts
const searchProjects = async (params: {...}) => {
  loading.value = true
  error.value = null
  searchQuery.value = params.search ?? ''
  statusFilter.value = params.status ?? ''
  try {
    ...
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Erreur lors de la recherche des projets.'
  } finally {
    loading.value = false
  }
}
```
- Impact: On network failure, the UI shows the new search query in the search box while the `projects` list still reflects the previous query — user sees a mismatched state.
- Fix: Update `searchQuery` / `statusFilter` only inside the `try` block AFTER successful fetch (or revert on catch).

### [HIGH] `projectStore.searchProjects` has a race — concurrent calls clobber latest
- File: `web/Front/customapp/src/stores/projectStore.ts:89-117`
- Category: logic
- Evidence:
```ts
const { data } = await api.get<{ items: ProjectSummary[]; total: number }>(url)
...
projects.value = [...items]
```
- Impact: Typing fast in a search box triggers multiple fetches; responses may arrive out-of-order and the older, slower response overwrites the newer one.
- Fix: Track a request token (monotonic counter or AbortController) and discard stale responses.

### [HIGH] `pmStore.renameSpeaker` updates `currentTranscript` state but does not update `meetings` summary list
- File: `web/Front/customapp/src/stores/pmStore.ts:248-272`
- Category: data-integrity
- Evidence:
```ts
if (currentTranscript.value?.id === meetingId) {
  currentTranscript.value = {
    ...currentTranscript.value,
    segments: currentTranscript.value.segments.map((s) =>
      s.speaker === oldName ? { ...s, speaker: newName } : s,
    ),
  }
}
```
- Impact: If the backend mutates speaker metadata on the summary (e.g. `speakerCount`, participant list), the summary in `meetings[]` goes stale; user sees old speaker names in the list.
- Fix: Either refetch `meetings` after rename or include an updated summary in the API response.

---

## MEDIUM

### [MEDIUM] `pmStore.triggerAiAnalysis` doesn't call `fetchAiResults` immediately after kick-off
- File: `web/Front/customapp/src/stores/pmStore.ts:227-246`
- Category: UX
- Evidence:
```ts
await api.post(`/pm/projects/${projectId}/meetings/${meetingId}/ai-analyze`)
aiResults.value = {
  aiStatus: 'processing',
  ...
}
stopAiPolling()
aiPolling.value = setInterval(() => {
  void fetchAiResults(projectId, meetingId)
}, 5000)
```
- Impact: User waits 5s before the first poll tick, even though the backend might have moved to `completed` quickly.
- Fix: Add `void fetchAiResults(projectId, meetingId)` immediately before the `setInterval`.

### [MEDIUM] `pmStore.fetchAutomationRules/Logs` parses envelope `{ success, data }` but `createAutomationRule` etc. assume same envelope — inconsistent with other endpoints
- File: `web/Front/customapp/src/stores/pmStore.ts:276-341`
- Category: types
- Evidence:
```ts
const { data } = await api.get<{ success: boolean; data: AutomationRule[] }>(
  `/pm/projects/${projectId}/automation/rules`,
)
automationRules.value = [...(data.data ?? [])]
```
- Impact: Rest of the backend returns raw payloads (per the other endpoints in this same file using `api.get<ProjectSummary[]>`); if automation routes are ever normalised, these stores break silently because `data.data` becomes `undefined`.
- Fix: Align backend response shape with other endpoints, or document the envelope in shared types.

### [MEDIUM] `pmStore.fetchAutomationRules`, `fetchAutomationLogs`, `fetchActivity`, `fetchMeetings` swallow errors by not populating `error.value` consistently
- File: `web/Front/customapp/src/stores/pmStore.ts:136-154`, `pmStore.ts:276-341`
- Category: error-handling
- Evidence:
```ts
const fetchActivity = async (projectId: string) => {
  try {
    const { data } = await api.get<ProjectActivity[]>(`/pm/projects/${projectId}/activity`)
    activities.value = [...data]
  } catch {
    activities.value = []
  }
}

const fetchMeetings = async (projectId: string) => {
  try {
    const { data } = await api.get<MeetingTranscriptSummary[]>(
      `/pm/projects/${projectId}/meetings`,
    )
    meetings.value = [...data]
  } catch {
    meetings.value = []
  }
}
```
- Impact: User can't distinguish "no meetings" from "network error fetching meetings" — both yield an empty list with no toast (interceptor does toast, but local state is ambiguous). Inconsistent with `fetchAutomationRules` which DOES set `error.value`.
- Fix: Pick one policy — set `error.value` everywhere and let UI decide, or consistently fallback silently with a separate flag.

### [MEDIUM] `notificationStore.fetchUnreadCount` compares count to read-only badge — drift when server creates notifications but tab is inactive
- File: `web/Front/customapp/src/stores/notificationStore.ts:42-52`
- Category: data-integrity
- Evidence:
```ts
const fetchUnreadCount = async (): Promise<void> => {
  try {
    const { data } = await api.get<{ count: number }>('/notifications/unread-count')
    // Sync read status: if server count is lower, refresh the full list
    if (data.count !== unreadCount.value) {
      await fetchNotifications()
    }
  } catch {
    // Silent — polling should not surface errors to the user
  }
}
```
- Impact: Comment says "if server count is lower" but the check is `!==` — which is correct, but misleading. More importantly: silent `catch {}` hides long-running outages from the user.
- Fix: Update comment, or add a separate `pollingError` flag so the UI can show a subtle "offline" indicator after N consecutive failures.

### [MEDIUM] `authStore.fetchMe` silently swallows non-401 errors
- File: `web/Front/customapp/src/stores/authStore.ts:175-196`
- Category: error-handling
- Evidence:
```ts
} catch (err) {
  if (axios.isAxiosError(err) && err.response?.status === 401) {
    clear()
  }
  return null
}
```
- Impact: On 500 or network error, `globalPermissions` / `projectPermissions` keep stale values but the caller only sees `null`. The UI has no way to distinguish "permissions unknown, assume none" from "session invalid, redirect".
- Fix: Expose an `error` ref on `authStore` or return `{ status: 'ok'|'unauthorized'|'failed' }`.

### [MEDIUM] `authStore.logout` makes its backend call AFTER clearing local state — race with other tabs / callers
- File: `web/Front/customapp/src/stores/authStore.ts:141-152`
- Category: logic
- Evidence:
```ts
const logout = async (): Promise<void> => {
  const config = useConfigStore()
  const token = jwt.value
  clear()
  try {
    await axios.get(config.apiUrl + '/hook/logout', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
  } catch {
    // Ignore — local state is already cleared
  }
}
```
- Impact: If the `/hook/logout` call takes 10s to fail, the UI already redirected to /login but the server-side session isn't revoked until much later. Reasonable trade-off, but any caller that `await`s `logout()` expecting "logged out server-side" is wrong.
- Fix: Document this behavior in the JSDoc, or await the backend call first when possible.

### [MEDIUM] `configStore.fetchConfig` throws on missing/bad config.json — no error ref, no caller recovery
- File: `web/Front/customapp/src/stores/configStore.ts:20-29`
- Category: error-handling
- Evidence:
```ts
const fetchConfig = async (): Promise<void> => {
  if (apiUrl.value) return
  const { data } = await axios.get<{ GLB_API_URL: string; GLB_ELISE_URL: string }>(
    import.meta.env.BASE_URL + 'config.json?_=' + Date.now(),
  )
  apiUrl.value = (data.GLB_API_URL as string).replace(/\/+$/, '')
  eliseUrl.value = data.GLB_ELISE_URL ?? ''
}
```
- Impact: If `config.json` returns 404 or malformed JSON, this rejects at app boot with no `error` state; the app just sees `apiUrl === ''` and every subsequent `api.*` call hits the dev server root.
- Fix: Catch, set an `error` ref, and render a fatal-config banner so the user knows the app is misconfigured.

### [MEDIUM] `configStore.fetchConfig` casts `GLB_API_URL` with `as string` despite already being typed
- File: `web/Front/customapp/src/stores/configStore.ts:27`
- Category: types
- Evidence:
```ts
apiUrl.value = (data.GLB_API_URL as string).replace(/\/+$/, '')
```
- Impact: Redundant type escape — the generic already types `data.GLB_API_URL` as `string`. Trivial but fails the "no type escapes" rule.
- Fix: `apiUrl.value = data.GLB_API_URL.replace(/\/+$/, '')`.

### [MEDIUM] `savedFiltersStore.activeFilter` is not cleared on logout — stale filter leaks across sessions
- File: `web/Front/customapp/src/stores/savedFiltersStore.ts:13-17`, `savedFiltersStore.ts:99-105`
- Category: data-integrity
- Evidence:
```ts
const filters = ref<SavedFilter[]>([])
const activeFilter = ref<SavedFilter | null>(null)
...
const applyFilter = (filter: SavedFilter): void => {
  activeFilter.value = { ...filter }
}
const clearActiveFilter = (): void => {
  activeFilter.value = null
}
```
- Impact: User A's active filter persists to user B after logout. Related to the CRITICAL logout-reset issue.
- Fix: Hook into global logout reset.

### [MEDIUM] `uiStore.init` parses localStorage without validating the shape — crashes on tampered storage
- File: `web/Front/customapp/src/stores/uiStore.ts:29-43`
- Category: validation
- Evidence:
```ts
try {
  const rawRecents = localStorage.getItem(STORAGE_KEY_RECENTS)
  if (rawRecents) recentProjects.value = JSON.parse(rawRecents) as RecentProject[]
} catch { recentProjects.value = [] }
```
- Impact: If localStorage is modified externally (e.g. another tab, user DevTools), `recentProjects.value` becomes an arbitrary structure (e.g. `{ foo: 'bar' }`), and downstream code that assumes `.filter()` / `.id` fails.
- Fix: Use a zod schema (`import { z } from 'zod'`) to validate, falling back to `[]` on validation failure. The rule `common/coding-style.md` requires schema validation at system boundaries.

### [MEDIUM] `uiStore` writes to `localStorage` at every single action — unkeyed to user ID
- File: `web/Front/customapp/src/stores/uiStore.ts:58-76`
- Category: data-integrity
- Evidence:
```ts
localStorage.setItem(STORAGE_KEY_RECENTS, JSON.stringify(next))
...
localStorage.setItem(STORAGE_KEY_PINNED_PROJS, JSON.stringify(next))
```
- Impact: User A and user B on the same device (same browser profile) share recent-projects and pinned lists. User B sees A's recent projects (and the IDs might be inaccessible to B, leading to 403s when they click them).
- Fix: Key the localStorage by `authStore.userId` (e.g. `nl_recent_projects_${userId}`) or clear on logout.

### [MEDIUM] `projectStore.computeProgress` re-evaluates `project.fieldValues.find` inside `.filter` — O(n²)
- File: `web/Front/customapp/src/stores/projectStore.ts:42-50`
- Category: perf
- Evidence:
```ts
const filled = requiredFields.filter((f) => {
  const val = project.fieldValues.find((v) => v.projectFieldId === f.id)
  return val?.value !== null && val?.value !== undefined && val.value.trim() !== ''
})
```
- Impact: Acceptable for small projects (~10 fields) but scales quadratically. Mostly a nit.
- Fix: Pre-build a `Map<fieldId, value>` once, then `filter` is O(n).

### [MEDIUM] `pmStore.aiPolling` stored in a reactive `ref` — exposes interval handle to components, which can break it
- File: `web/Front/customapp/src/stores/pmStore.ts:31`
- Category: types
- Evidence:
```ts
const aiPolling = ref<ReturnType<typeof setInterval> | null>(null)
```
- Impact: Unlike `notificationStore.pollingTimer` which is a module-private `let`, `aiPolling` is a full Pinia ref. It is NOT returned in the store's return object (safe), but it's still reactive, causing unnecessary rerenders whenever the timer id changes.
- Fix: Use `let aiPolling: ReturnType<typeof setInterval> | null = null` (module-private like `notificationStore.ts:21`).

### [MEDIUM] `teamPlannerStore` imports `WorkPackage, UserSummary` but never uses `UserSummary` as import? Actually it does — but `agileStore.ts:6` imports `WorkPackage, UserSummary` and never uses `UserSummary`
- File: `web/Front/customapp/src/stores/agileStore.ts:6`
- Category: types
- Evidence:
```ts
import type { WorkPackage, UserSummary } from '@/types/work-package.types'
```
- Impact: Dead import — `UserSummary` is never referenced in the file. Lint warning noise.
- Fix: Remove unused import.

### [MEDIUM] `agileStore.fetchBurndown` uses implicit any via response cast
- File: `web/Front/customapp/src/stores/agileStore.ts:109-112`
- Category: types
- Evidence:
```ts
async function fetchBurndown(projectId: string, sprintId: string) {
  const { data } = await api.get(`/pm/projects/${projectId}/sprints/${sprintId}/burndown`)
  burndown.value = data as typeof burndown.value
}
```
- Impact: Uses `api.get` without a generic type, then an `as` cast. Loses type safety at the network boundary.
- Fix: `api.get<{ sprint: Sprint; days: {...}[] }>(...)` and drop the cast.

### [MEDIUM] `ganttStore.compareBaseline` and `teamPlannerStore.fetchConflicts` return `unknown` / `any` implicitly
- File: `web/Front/customapp/src/stores/ganttStore.ts:74-77`, `teamPlannerStore.ts:44-47`
- Category: types
- Evidence:
```ts
async function compareBaseline(projectId: string, snapshotName: string) {
  const { data } = await api.get(`/pm/projects/${projectId}/baselines/${snapshotName}/compare`)
  return data
}
```
- Impact: Caller gets `any`; no compile-time guarantees for drift-report shape.
- Fix: Declare a `BaselineCompare` interface and pass as generic.

### [MEDIUM] `workPackageStore.fetchAll` assigns non-spread — violates immutability convention in this codebase
- File: `web/Front/customapp/src/stores/workPackageStore.ts:26-27`
- Category: logic
- Evidence:
```ts
items.value = data.items
total.value = data.total
```
- Impact: The rest of the project uses `items.value = [...data]` to hint immutability. `data.items` is a fresh array from axios, so functionally safe, but inconsistent with project convention.
- Fix: `items.value = [...data.items]` (or make the convention official).

### [MEDIUM] `ganttStore.fetchGantt`, `agileStore.fetchBoards`, `wikiStore.fetchTree`, `portfolioStore.fetchAll`, `budgetStore.fetchBudget`, `timeStore.*` — same "assign raw response" pattern
- File: `web/Front/customapp/src/stores/ganttStore.ts:37-39`, `agileStore.ts:52`, `wikiStore.ts:46`, `portfolioStore.ts:39`, `budgetStore.ts:49`, `timeStore.ts:45/56/79`
- Category: logic
- Evidence (sample):
```ts
workPackages.value = data.workPackages
milestones.value = data.milestones
dependencies.value = data.dependencies
```
- Impact: Same as above — works because axios returns fresh arrays, but inconsistent with project's explicit immutability idiom.
- Fix: Spread on assignment.

### [MEDIUM] `pmStore.toggleAutomationRule` uses `{ ...data.data }` which shallow-copies without deep-cloning nested properties
- File: `web/Front/customapp/src/stores/pmStore.ts:303-318`
- Category: logic
- Evidence:
```ts
automationRules.value = automationRules.value.map((r) =>
  r.id === ruleId ? { ...data.data } : r,
)
```
- Impact: `AutomationRule` may contain nested JSON (`actionConfig`); the spread copies it by reference. If another caller mutates it, the UI shows stale data. In practice axios gives a fresh object per response so this is usually fine — noting for completeness.
- Fix: Prefer `data.data` directly (it's already a fresh object), or document that server responses are treated as frozen.

### [MEDIUM] `userStore.fetchAll` handles two different response shapes at the same endpoint
- File: `web/Front/customapp/src/stores/userStore.ts:29-41`
- Category: types
- Evidence:
```ts
const { data } = await api.get<{ items: UserResponse[]; total: number } | UserResponse[]>('/admin/appuser')
const items = Array.isArray(data) ? data : (data.items ?? [])
users.value = [...items]
```
- Impact: The union type suggests the backend response has drifted over time; the fallback is a code smell that hides a real schema-stability bug.
- Fix: Pin the backend contract to one shape (prefer `{ items, total }`).

### [MEDIUM] `projectStore.fetchAll` / `searchProjects` same pattern
- File: `web/Front/customapp/src/stores/projectStore.ts:74-87`, `projectStore.ts:89-117`
- Category: types
- Evidence:
```ts
const { data } = await api.get<{ items: ProjectSummary[]; total: number }>('/admin/project')
const items = Array.isArray(data) ? data : (data.items ?? [])
```
- Impact: Runtime shape check against an array even though the generic says it's an object — the type lies. If backend returns an object without `items`, it silently resolves to `[]`.
- Fix: Align backend + frontend type; drop the `Array.isArray` fallback.

---

## LOW

### [LOW] `authStore` exposes `globalPermissions`, `projectPermissions`, `assignedRoles` as writable refs in return
- File: `web/Front/customapp/src/stores/authStore.ts:198-220`
- Category: types
- Evidence:
```ts
return {
  ...
  globalPermissions,
  projectPermissions,
  assignedRoles,
  ...
}
```
- Impact: Any component can overwrite `authStore.globalPermissions = new Set()`, bypassing the `fetchMe` / `clear` lifecycle. Comment line 199 says "expose as readonly-ish" but that's not enforced.
- Fix: Wrap in `readonly()` or expose through computed getters.

### [LOW] `notificationStore.fetchNotifications` error message overwritten on every call
- File: `web/Front/customapp/src/stores/notificationStore.ts:28-40`
- Category: UX
- Evidence:
```ts
const fetchNotifications = async (): Promise<void> => {
  loading.value = true
  error.value = null
  ...
}
```
- Impact: Clears `error` on each call. If `fetchNotifications` succeeds, a previous `markAsRead` error from a different action is also cleared — single shared error ref conflates unrelated failures. Minor; most stores have this.
- Fix: Separate `fetchError` / `mutationError` refs, or use an array of errors keyed by action.

### [LOW] `configStore` has no `reset()` and `apiUrl`/`eliseUrl` are read as bare refs
- File: `web/Front/customapp/src/stores/configStore.ts:31-35`
- Category: data-integrity
- Evidence:
```ts
return {
  apiUrl,
  eliseUrl,
  fetchConfig,
}
```
- Impact: Config shouldn't change after boot, but nothing guards against accidental writes from consumers.
- Fix: Return `readonly(apiUrl)` or computed.

### [LOW] `timeStore.update`'s `payload: Partial<TimeEntry>` accepts server-owned fields like `id`, `createdAt`
- File: `web/Front/customapp/src/stores/timeStore.ts:65-70`
- Category: validation
- Evidence:
```ts
async function update(id: string, payload: Partial<TimeEntry>) {
  const { data } = await api.patch<TimeEntry>(`/api/time-entries/${id}`, payload)
```
- Impact: Callers can accidentally send `id`, `createdAt`, `lockedAt` etc. in the PATCH body; if the backend doesn't strip them, a caller could overwrite e.g. `createdAt`.
- Fix: Define a narrow `UpdateTimeEntryPayload` type with only editable fields.

### [LOW] `ganttStore.updateMilestone` accepts `Partial<Milestone>` — same server-field leak
- File: `web/Front/customapp/src/stores/ganttStore.ts:51-56`
- Category: validation
- Evidence:
```ts
async function updateMilestone(projectId: string, id: string, payload: Partial<Milestone>) {
```
- Impact: Same as above.
- Fix: Narrow DTO.

### [LOW] `portfolioStore.updateVersion` accepts `Partial<Version>` — same
- File: `web/Front/customapp/src/stores/portfolioStore.ts:73-78`
- Category: validation
- Evidence:
```ts
async function updateVersion(projectId: string, id: string, payload: Partial<Version>) {
```
- Fix: Narrow DTO.

### [LOW] `budgetStore.updateLineItem` accepts `Partial<BudgetLineItem>` — same
- File: `web/Front/customapp/src/stores/budgetStore.ts:67-77`
- Category: validation
- Fix: Narrow DTO.

### [LOW] `meetingExtrasStore.addOutcome` accepts `payload: { type: string; ... }` — accepts any string for `type` but server expects a union
- File: `web/Front/customapp/src/stores/meetingExtrasStore.ts:93-96`
- Category: validation
- Evidence:
```ts
async function addOutcome(projectId: string, meetingId: string, payload: { type: string; description: string; ownerId?: string; dueDate?: string }) {
```
- Impact: `Outcome.type` is `'Decision' | 'Action' | 'Note' | 'Risk'` but the payload accepts any string.
- Fix: `payload: { type: Outcome['type']; ... }`.

### [LOW] `meetingExtrasStore.convertToWp` returns `data` typed as `any` (no generic on `api.post`)
- File: `web/Front/customapp/src/stores/meetingExtrasStore.ts:101-105`
- Category: types
- Evidence:
```ts
async function convertToWp(projectId: string, meetingId: string, id: string) {
  const { data } = await api.post(`${base(projectId, meetingId)}/outcomes/${id}/convert-to-wp`)
  await fetchOutcomes(projectId, meetingId)
  return data
}
```
- Fix: Pass `api.post<WorkPackage>(...)` and annotate return.

### [LOW] `notificationStore` re-exports type via `export type { Notification }` — correct, but also returned from store; UI consumers should prefer the type import
- File: `web/Front/customapp/src/stores/notificationStore.ts:10-11`
- Category: types
- Evidence:
```ts
export type { Notification }
```
- Impact: Fine, just an observation. No action.

### [LOW] `useApp.fetchApiUrl` doesn't trim trailing slashes on `eliseUrl`
- File: `web/Front/customapp/src/stores/useApp.ts:33-37`
- Category: data-integrity
- Evidence:
```ts
apiUrl.value = (data.GLB_API_URL as string).replace(/\/+$/, '')
eliseUrl.value = data.GLB_ELISE_URL
```
- Impact: `eliseUrl` may have a trailing slash that appends double-slashes in later URL composition.
- Fix: Apply the same `.replace(/\/+$/, '')` transform (or delete `useApp` entirely).

### [LOW] `useApp.storeGuidDevMode`, `getSample`, `updateSample` have pointless `try/catch { throw error }`
- File: `web/Front/customapp/src/stores/useApp.ts:83-99`, `useApp.ts:127-147`
- Category: error-handling
- Evidence:
```ts
try {
  await axios.post(...)
} catch (error) {
  throw error
}
```
- Impact: No-op wrapper. Dead code.
- Fix: Remove the try/catch.

### [LOW] `teamPlannerStore.fetchConflicts` types response as `typeof conflicts.value`
- File: `web/Front/customapp/src/stores/teamPlannerStore.ts:44-47`
- Category: types
- Evidence:
```ts
const { data } = await api.get<typeof conflicts.value>(`/pm/team-planner/conflicts?from=${from}&to=${to}`)
conflicts.value = data
```
- Impact: Clever but brittle — refactoring `conflicts` breaks the generic silently.
- Fix: Extract a named interface `ConflictRow`.

### [LOW] `pmStore.resumeAiPolling` and `triggerAiAnalysis` duplicate `setInterval` logic
- File: `web/Front/customapp/src/stores/pmStore.ts:205-210`, `pmStore.ts:239-242`
- Category: logic
- Evidence: Both build the same interval.
- Impact: Drift risk if one is changed.
- Fix: Extract a private `_startPolling(projectId, meetingId)` helper.

### [LOW] `projectStore.extractApiError` defined mid-file (before `import type`)
- File: `web/Front/customapp/src/stores/projectStore.ts:10-20`
- Category: logic
- Evidence:
```ts
import axios from 'axios'
import api from '@/lib/api'

function extractApiError(e: unknown, fallback: string): string {
  ...
}
import type {
  ProjectSummary,
  ...
} from '@/types/project.types'
```
- Impact: Imports split around a function declaration is non-standard and confuses bundler-ordering readers.
- Fix: Move all imports to the top, extract helper to `src/lib/apiError.ts` for reuse (see HIGH issue on `pmStore.uploadMeeting`).

### [LOW] `commentStore` declares inline types (`Comment`, `CommentUser`) rather than using `@/types/*.types`
- File: `web/Front/customapp/src/stores/commentStore.ts:12-29`
- Category: types
- Evidence:
```ts
export interface CommentUser {...}
export interface Comment {...}
```
- Impact: Other stores use `@/types/*.types` (see `pmStore.ts` imports). Divergent style.
- Fix: Move types to `@/types/comment.types.ts`.

### [LOW] `analyticsStore`, `ganttStore`, `agileStore`, `budgetStore`, `wikiStore`, `portfolioStore`, `teamPlannerStore`, `meetingExtrasStore`, `timeStore`, `roleStore` all declare inline interfaces — same divergence
- File: multiple
- Category: types
- Fix: Consolidate under `@/types/*.types.ts` per file-organization rule ("organize by feature/domain").

---

## UNCERTAIN

### [UNCERTAIN] Whether `useApp` store is still consumed anywhere in the app
- File: `web/Front/customapp/src/stores/useApp.ts`
- Category: logic
- Evidence: Existence of this file as an entire legacy store. Cannot confirm usage without grepping Vue files.
- Impact: If nothing references it, it's 167 lines of dead code that still pollutes global axios at import time. If something does, the CRITICAL issues above are live bugs.
- What would confirm: `grep -r "from '@/stores/useApp'" web/Front/customapp/src` — if zero matches, delete the file.

### [UNCERTAIN] Whether `workPackageStore.update` preserves `currentWp` watchers / dependencies / custom values after PATCH
- File: `web/Front/customapp/src/stores/workPackageStore.ts:55-65`
- Category: data-integrity
- Evidence:
```ts
const { data } = await api.patch<WorkPackage>(`/pm/projects/${projectId}/work-packages/${id}`, payload)
...
if (currentWp.value?.id === id) currentWp.value = { ...currentWp.value, ...data }
```
- Impact: Uses `{ ...currentWp.value, ...data }` which means fields in `data` overwrite `currentWp.value`. If the PATCH response doesn't include `watchers`/`dependencies`/`customValues` (which `fetchOne` does), those fields get replaced by `undefined` depending on the server response shape.
- What would confirm: Backend code for `PATCH /pm/projects/:id/work-packages/:wpId` — does it return the full include (watchers/dependencies/customValues) or just the base WP? If just base, drop the spread and refetch instead.

### [UNCERTAIN] Whether `notificationStore.startPolling`'s immediate `fetchNotifications()` handles the case where the user is not yet authenticated
- File: `web/Front/customapp/src/stores/notificationStore.ts:91-97`
- Category: auth
- Evidence:
```ts
const startPolling = (): void => {
  if (pollingTimer !== null) return
  fetchNotifications()
  pollingTimer = setInterval(() => {
    fetchUnreadCount()
  }, POLL_INTERVAL_MS)
}
```
- Impact: If called before `authStore.jwt` is set, it hits `/notifications` without auth — 401 triggers the redirect interceptor.
- What would confirm: Caller site — is `startPolling()` called inside a watcher that runs `if (auth.isAuthenticated)` or only after login? The CLAUDE.md says "wired in all 3 layout views" but doesn't confirm auth gate.

### [UNCERTAIN] Whether the `mustChangePassword` flag on `authStore` is respected across page reloads
- File: `web/Front/customapp/src/stores/authStore.ts:24`, `authStore.ts:78-87`
- Category: auth
- Evidence:
```ts
const mustChangePassword = ref<boolean>(false)
...
const init = (): void => {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored) {
    if (isTokenExpired(stored)) {
      _clearStorage()
      return
    }
    jwt.value = stored
  }
}
```
- Impact: `init()` restores only `jwt`, not `mustChangePassword`. After a page refresh post-login, the user escapes the must-change gate.
- What would confirm: Check the JWT payload — if `mustChangePassword` is a claim inside the token, a derived computed from `jwt.value` would fix this; otherwise, persist the flag to localStorage.

---

## Summary of cross-cutting issues

1. **Logout reset is missing** on almost every store — user B sees user A's data until they manually refresh. (CRITICAL)
2. **`useApp.ts` is a legacy parallel auth store** that patches global axios at import time and duplicates JWT/apiUrl/role state. Should be deleted. (CRITICAL)
3. **Polling timers (`notificationStore`, `pmStore.aiPolling`) are not stopped on logout** — 401 loops and wasted bandwidth. (CRITICAL)
4. **Error handling is inconsistent** — some stores set `error.value`, some silently return `null`, some have no `error` ref at all, some throw unhandled. (HIGH)
5. **Race conditions on `pmStore.fetchMyProjects`/`fetchTeamProjects`** (same ref), and `projectStore.searchProjects` (no AbortController). (HIGH)
6. **Immutability convention is inconsistent** — most stores spread, `roleStore` uses `.push`/index assignment. (HIGH)
7. **Many stores declare inline types** instead of using `@/types/*.types.ts` per project convention. (LOW)
8. **`uiStore` persists recents to unkeyed localStorage** — leaks between users sharing a browser. (MEDIUM)
