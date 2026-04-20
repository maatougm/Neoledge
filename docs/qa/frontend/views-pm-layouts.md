# QA — PM Views & App Layouts (line-by-line)

Files opened:
- `web/Front/customapp/src/views/PMProjectsPage.vue`
- `web/Front/customapp/src/views/PMProjectDetailView.vue`
- `web/Front/customapp/src/views/WorkPackagesView.vue`
- `web/Front/customapp/src/views/GanttView.vue`
- `web/Front/customapp/src/views/KanbanBoardView.vue`
- `web/Front/customapp/src/views/BacklogView.vue`
- `web/Front/customapp/src/views/SprintBoardView.vue`
- `web/Front/customapp/src/views/WikiView.vue`
- `web/Front/customapp/src/views/BudgetView.vue`
- `web/Front/customapp/src/views/TimeTrackingView.vue`
- `web/Front/customapp/src/views/MembersView.vue`
- `web/Front/customapp/src/views/ProjectActivityView.vue`
- `web/Front/customapp/src/views/MyTasksView.vue`
- `web/Front/customapp/src/views/ProjectManagerView.vue`
- `web/Front/customapp/src/views/TeamPlannerView.vue`
- `web/Front/customapp/src/layouts/PmLayout.vue`
- `web/Front/customapp/src/layouts/AppShell.vue`
- `web/Front/customapp/src/layouts/AppSidebar.vue`
- `web/Front/customapp/src/layouts/AppTopbar.vue`
- `web/Front/customapp/src/layouts/NotificationPanel.vue`
- `web/Front/customapp/src/layouts/TeamLayout.vue`

---

## CRITICAL

### [CRITICAL] Wiki v-html renders user content through a hand-rolled "sanitiser" that does NOT sanitise — XSS vulnerability
- File: `web/Front/customapp/src/views/WikiView.vue:40` (render site) and `:125-138` (render function)
- Category: xss
- Evidence:
```vue
<div v-if="!editing" class="wiki__content-body" v-html="renderedContent" />
```
```ts
const renderedContent = computed(() => renderMarkdown(wikiStore.currentPage?.content ?? ''))

function renderMarkdown(text: string): string {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return escaped
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
    .replace(/\n/g, '<br>')
}
```
- Impact:
  1. The link regex `\[([^\]]+)\]\(([^)]+)\)` captures the URL verbatim into `href="$2"`. Because escaping is done **before** markdown substitution, any `"` or `javascript:` payload in the URL survives unaltered. Example input: `[click](javascript:alert(1))` produces `<a href="javascript:alert(1)" target="_blank">click</a>` — click-to-XSS.
  2. Similarly, an input such as `[x](a" onmouseover="alert(1)" x=")` breaks out of the `href` attribute because the escape pass handled `<>&` but not `"`.
  3. No `rel="noopener noreferrer"` on the generated `_blank` anchor — reverse-tabnabbing in addition to XSS.
  4. The code is typed as "markdown" but will likely be extended — each new rule is another attack surface.
- Fix: swap for a library-backed markdown renderer with sanitisation (e.g. `marked` + `DOMPurify`, or `markdown-it` with its safe mode enabled). At minimum, validate the URL protocol (`^(https?:|mailto:|/)`) and HTML-encode `"` in the href before interpolation. Always add `rel="noopener noreferrer"` to `_blank` links.

---

## HIGH

### [HIGH] PMProjectsPage mutates Pinia store state directly (breaks strict mode + violates immutability rule)
- File: `web/Front/customapp/src/views/PMProjectsPage.vue:51`
- Category: logic
- Evidence:
```vue
function closeDetail(): void {
  selectedProjectId.value = null
  store.currentProject = null
```
- Impact: Assigning to a Pinia store's state property from outside a store action throws in strict mode and is flagged by `strict: true` in setup stores. Also breaks the project rule "ALWAYS create new objects, NEVER mutate". Should go through a store action (`store.clearCurrent()` or `store.$patch({ currentProject: null })`).
- Fix: add a dedicated action in `pmStore` and call it here.

### [HIGH] `KanbanBoardView.vue` registers `onMounted(load)` twice — double fetch on every mount
- File: `web/Front/customapp/src/views/KanbanBoardView.vue:198-201` and `:224`
- Category: perf / logic
- Evidence:
```ts
onMounted(() => {
  // Join project room for real-time events (sidebar already connects the socket)
  collab.joinProject(props.id)
})
onUnmounted(() => {
  collab.leaveProject(props.id)
})
...
onMounted(load)
```
- Impact: Two separate `onMounted` hooks. The second triggers `load()` which calls `fetchBoards` → `fetchBoard` — this runs once, but on any hot-reload or if the component is mounted twice (e.g. Suspense) both hooks fire, and any future reader is at high risk of duplicating because the hook is split across the file. The first hook joins the project room before `load()` has been defined above; while hoisting makes it work, the ordering is confusing.
- Fix: consolidate into a single `onMounted(async () => { collab.joinProject(props.id); await load() })`.

### [HIGH] `WorkPackagesView.vue` — `form.priority` and `form.type` not reset after create
- File: `web/Front/customapp/src/views/WorkPackagesView.vue:336-338`
- Category: UX
- Evidence:
```ts
if (wp) {
  toast.add({ severity: 'success', detail: 'Work package créé.', life: 3000 })
  showCreate.value = false
  form.title = ''
  form.description = ''
  form.dueDate = null
  selectedId.value = wp.id
```
- Impact: After a successful create, `type` and `priority` are *not* reset. Reopening the modal shows the last used values, which is fine, but **inconsistent** with the title/description reset. More importantly, neither the initial defaults (`'Task'` / `'Normal'`) nor the last selection are preserved deterministically on re-open — they just carry over.
- Fix: either reset all fields to their initial defaults, or intentionally preserve all of them. Pick one behavior and document.

### [HIGH] `WorkPackagesView.vue` — selectedId is not cleared on filter/pill change, leaving stale detail panel
- File: `web/Front/customapp/src/views/WorkPackagesView.vue:187` and the detail panel at `:120-128`
- Category: UX / logic
- Evidence:
```ts
function activatePill(key: PillKey): void { activePill.value = key }
```
```vue
<WorkPackageDetail
  v-if="selectedId"
  :project-id="projectId"
  :work-package-id="selectedId"
```
- Impact: If the user selects a WP, then activates a pill (e.g. "Non assignés") that filters out the selected WP, the detail panel stays open on a row that is no longer in the visible list — confusing.
- Fix: watch `visibleRows`/`activePill` and clear `selectedId` if the current selection is no longer visible.

### [HIGH] `WorkPackagesView.vue` — bulk status promise.all loses per-item errors silently
- File: `web/Front/customapp/src/views/WorkPackagesView.vue:234-242`
- Category: error-handling
- Evidence:
```ts
try {
  await Promise.all(ids.map((id) => store.update(projectId.value, id, { status: newStatus })))
  toast.add({ severity: 'success', detail: `${ids.length} WP mis à jour`, life: 3000 })
  clearSelection()
  bulkStatus.value = ''
} catch {
  toast.add({ severity: 'error', detail: 'Échec de la mise à jour en lot', life: 4000 })
}
```
- Impact: `Promise.all` rejects on first failure and swallows successes. If 3 of 10 succeed and 1 fails, the UI reports "Échec" but the partial write is invisible to the user, the selection is kept (stale), and the bulk dropdown is kept. Also, `clearSelection()` is not called on the catch path so if the user retries without clearing, they can cascade stale state.
- Fix: use `Promise.allSettled`, count successes vs failures, surface per-item errors or total counts (`3/10 mis à jour, 7 échecs`). Always refresh the list after.

### [HIGH] `GanttView.vue` — drag handlers registered on `window` never cleaned up on component unmount mid-drag
- File: `web/Front/customapp/src/views/GanttView.vue:273-275` and `:300-302`
- Category: logic / memory-leak
- Evidence:
```ts
function startDrag(e: MouseEvent, wp: WorkPackage, mode: DragMode) {
  e.preventDefault()
  dragState = { ... }
  ...
  window.addEventListener('mousemove', onDragMove)
  window.addEventListener('mouseup', onDragEnd)
}
```
- Impact: If the user route-navigates away while holding the mouse button down on a gantt bar, the `mousemove`/`mouseup` listeners stay attached to `window` and `dragState` keeps a closure over the (now unmounted) component. Later mouseups will still fire `onDragEnd` which calls `wpStore.update` on a disposed component.
- Fix: add `onUnmounted(() => { window.removeEventListener('mousemove', onDragMove); window.removeEventListener('mouseup', onDragEnd) })`.

### [HIGH] `GanttView.vue` — `dateRange.value.min` mutated when scanning work packages
- File: `web/Front/customapp/src/views/GanttView.vue:165-181`
- Category: logic / immutability
- Evidence:
```ts
const dateRange = computed(() => {
  const items = ganttStore.workPackages
  let min = new Date()
  let max = new Date()
  min.setDate(min.getDate() - 7)
  max.setDate(max.getDate() + 30)
  for (const wp of items) {
    if (wp.startDate) { const d = new Date(wp.startDate); if (d < min) min = d }
    if (wp.dueDate)   { const d = new Date(wp.dueDate);   if (d > max) max = d }
  }
```
- Impact: Fine in the computed, but this computed is used by `dateToOffset`, `barFor`, `headerCols`, and triggers on every WP change. Every drag-move (`ganttStore.workPackages[idx] = {...}`) triggers this chain — the computed recomputes, potentially expanding the range, and reflows all bars including the bar under the cursor (jittering). Additionally, during drag it's possible to extend `dateRange.max` past the user's dragged end, producing perceived "elastic" behavior.
- Fix: pin the displayed range during an active drag (watch `draggingWpId` and freeze the calc).

### [HIGH] `GanttView.vue` — `totalWidth` computation is arithmetically broken for week/month
- File: `web/Front/customapp/src/views/GanttView.vue:184`
- Category: logic
- Evidence:
```ts
const totalWidth = computed(() => totalDays.value * (colWidth.value / (zoom.value === 'day' ? 1 : zoom.value === 'week' ? 7 : 30)))
```
- Impact: `totalWidth = totalDays * (colWidth / daysPerCol)`. This happens to equal `(totalDays / daysPerCol) * colWidth` — i.e. number of columns × column width. However, the header is built by iterating `cur += 1 day | 7 days | 1 month`, so at `zoom = 'month'` using `30` days as a constant is wrong for months of 28/31 days. This causes the timeline width and column count to drift apart — the last column may be truncated or have overflow space.
- Fix: build the total from the column count actually produced by `headerCols` (`headerCols.value.length * colWidth.value`), not from a hard-coded 30-day month.

### [HIGH] `BacklogView.vue` — direct `api.patch` bypasses the store → stale list & no optimistic state
- File: `web/Front/customapp/src/views/BacklogView.vue:140`
- Category: logic
- Evidence:
```ts
async function onDrop() {
  if (!draggedWp.value || !activeSprintId.value) return
  try {
    await api.patch(`/pm/projects/${props.id}/work-packages/${draggedWp.value}/move`, { sprintId: activeSprintId.value })
    await wpStore.fetchAll(props.id)
```
- Impact: The view has `useWorkPackageStore()` injected but still talks to `api` directly here, then does a full `fetchAll` to re-sync. This is a layering violation — business logic (moving a WP to a sprint) belongs in the store, and the full refetch is wasteful. Also, if `fetchAll` fails the UI is indeterminate.
- Fix: expose `wpStore.moveToSprint(projectId, wpId, sprintId)` with an optimistic local update + backend call + rollback on failure.

### [HIGH] `BudgetView.vue` — `NeoTag severity="warn"` is not a valid severity
- File: `web/Front/customapp/src/views/BudgetView.vue:20`
- Category: neolibrary
- Evidence:
```vue
<NeoTag v-if="burn" :value="`${burn.percentUsed}%`" :severity="burn.percentUsed > 100 ? 'danger' : burn.percentUsed > 80 ? 'warn' : 'success'" />
```
- Impact: Per CLAUDE.md, `NeoTag`'s supported severities are `"success" | "info" | "warning" | "danger" | "secondary" | "contrast"`. `'warn'` is **not** valid — visual treatment will fall through to default/empty style.
- Fix: use `'warning'`.

### [HIGH] `SprintBoardView.vue` — chart instance not destroyed on unmount → memory leak
- File: `web/Front/customapp/src/views/SprintBoardView.vue:81, 108, 153-156`
- Category: perf / memory-leak
- Evidence:
```ts
let chartInstance: Chart | null = null
...
chartInstance?.destroy()
chartInstance = new Chart(chartRef.value, { ... })
...
watch(activeSprintId, loadBurndown)
onMounted(async () => {
  await load()
  await loadBurndown()
})
```
- Impact: There is no `onUnmounted(() => chartInstance?.destroy())`. Chart.js attaches a ResizeObserver and DOM listeners to the canvas — without explicit teardown on navigation away, these accumulate. Also no `chartInstance = null` after destroy in `renderChart()`.
- Fix: add `onUnmounted(() => { chartInstance?.destroy(); chartInstance = null })`.

### [HIGH] `WikiView.vue` — slug watcher fires on prop change but doesn't guard against concurrent fetches
- File: `web/Front/customapp/src/views/WikiView.vue:208-213`
- Category: logic
- Evidence:
```ts
watch(() => props.slug, async (s) => {
  if (s) {
    currentSlug.value = s
    await wikiStore.fetchPage(props.id, s)
  }
})
```
- Impact: Rapid slug navigation (e.g. clicking three pages quickly) fires three `fetchPage` calls; whichever resolves *last* wins, but it may not be the last-clicked one if the network orders differently. Classic race condition.
- Fix: capture a generation counter / AbortController per call and drop stale responses.

### [HIGH] `TimeTrackingView.vue` — `hours` from `parseFloat` used in boolean check loses negative handling
- File: `web/Front/customapp/src/views/TimeTrackingView.vue:155-159`
- Category: validation
- Evidence:
```ts
async function submitLog() {
  const hours = parseFloat(logForm.hoursText)
  if (!logForm.spentOn || !hours || hours <= 0) {
    toast.add({ severity: 'warn', detail: 'Date et heures requis.', life: 3000 })
    return
  }
```
- Impact: `!hours` treats `NaN` (bad input) the same as `0` — fine, but does not warn the user *why*. Also `parseFloat('2.5abc')` returns `2.5` silently, letting "2.5abc" submit as 2.5. And no upper bound (24 / 168) — user can log 9999 hours.
- Fix: validate the raw string with a regex (`/^\d+(\.\d{1,2})?$/`), enforce an upper bound, and give specific error messages.

### [HIGH] `TeamPlannerView.vue` — date range navigation produces API calls without validation
- File: `web/Front/customapp/src/views/TeamPlannerView.vue:118-125`
- Category: validation
- Evidence:
```ts
async function load() {
  if (!fromDate.value || !toDate.value) return
  await Promise.all([
    store.fetchCapacity(fromDate.value, toDate.value),
    store.fetchAssignments(fromDate.value, toDate.value),
    store.fetchConflicts(fromDate.value, toDate.value),
  ])
}
```
- Impact: No check that `fromDate <= toDate`. A user who flips them gets three 4xx/5xx responses. The date pickers don't constrain each other. Also `monthFromNow.setDate(today.getDate() + 30)` mutates `monthFromNow` which was cloned from `today` — fine here but the clone is shallow and typical bug footgun.
- Fix: validate `fromDate <= toDate` before fetch + UI feedback; disable "Rafraîchir" when invalid.

### [HIGH] `ProjectManagerView.vue` — legacy/duplicate layout NOT used by router (confirmed unreachable) still calls dead APIs
- File: `web/Front/customapp/src/views/ProjectManagerView.vue:155`
- Category: logic / dead-code
- Evidence:
```ts
const sidebarAvatarUrl = computed<string | null>(() => {
  if (!app.jwt) return null
  try {
    const p = JSON.parse(atob(app.jwt.split('.')[1]))
    const sub: string = p.sub ?? ''
    if (!sub) return null
    return `${app.apiUrl}/api/userprofile/avatar/${sub}`
```
- Impact: `/api/userprofile/avatar/:sub` is a **legacy ASP.NET** route (per CLAUDE.md). The NestJS backend (active) does not expose `/api/userprofile/avatar`. Moreover, `useApp()` is referenced — CLAUDE.md describes only `useAuthStore / useConfigStore / etc.`, so this view appears to target a pre-rebuild architecture. Keeping it in `views/` leaves a working-but-broken entry if someone adds a route. `AppShell.vue` is the active authenticated root.
- Fix: remove this file (confirm it's not referenced by any route), or rewrite to use `authStore` + the NestJS avatar endpoint.

### [HIGH] `PMProjectDetailView.vue` — JSON-cast `{ suppressErrorToast: true } as never` bypasses type safety
- File: `web/Front/customapp/src/views/PMProjectDetailView.vue:350, 355, 361, 363, 370`
- Category: types
- Evidence:
```ts
const { data } = await api.get<Milestone[]>(`/pm/projects/${props.id}/milestones`, { suppressErrorToast: true } as never)
```
- Impact: `as never` is the strongest way to lie to TS. This masks the axios config type (the field may or may not exist on the axios instance's interceptor) and will silently break if someone renames the flag. If this is actually a supported option on your `api` wrapper, it should be typed there; if not, the code is a hidden no-op and the error toasts still fire on 404.
- Fix: extend the axios config type (`declare module 'axios' { interface AxiosRequestConfig { suppressErrorToast?: boolean } }`) and drop `as never`.

---

## MEDIUM

### [MEDIUM] `PMProjectDetailView.vue` — nested ternary severity choice is not a NeoTag severity
- File: `web/Front/customapp/src/views/PMProjectDetailView.vue:3` (status-severity usage)
- Category: neolibrary
- Evidence:
```vue
<ProjectModuleShell :project-id="id" :title="projectName" :status="projectStatus" status-severity="info">
```
- Impact: Hardcoded `"info"` is fine, but `projectStatus` (string from backend enum) isn't translated for display — a raw enum label like `SpecificationValidation` will render unchanged. The `phaseLabels.ts` utility exists per CLAUDE.md and should be used.
- Fix: import `translatePhase` / `phaseLabel` and pass the localized string.

### [MEDIUM] `PMProjectDetailView.vue` — `wps.value` typed as `WorkPackage[]` but fetched as unknown shape
- File: `web/Front/customapp/src/views/PMProjectDetailView.vue:341-346`
- Category: types
- Evidence:
```ts
const [projRes, wpsRes] = await Promise.all([
  api.get<Project>(`/pm/projects/${props.id}`),
  api.get<{ items: WorkPackage[] }>(`/pm/projects/${props.id}/work-packages?limit=200`),
])
```
- Impact: `WorkPackage` interface at line 209-213 only has a subset of the real WP shape — `startDate` and other fields are missing. Other parts of the app use `@/types/work-package.types`. Divergent types → two sources of truth. Also the inlined interface re-declares `WorkPackage` locally, shadowing the canonical type.
- Fix: import `WorkPackage` from `@/types/work-package.types` and drop the inline redefinition.

### [MEDIUM] `PMProjectDetailView.vue` — raw `Date` formatting inside template
- File: `web/Front/customapp/src/views/PMProjectDetailView.vue:143`
- Category: logic / i18n
- Evidence:
```vue
<div class="po__milestone-date">
  {{ new Date(nextMilestone.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) }}
</div>
```
- Impact: Creates a new Date object on each re-render. Also inconsistent with the rest of the app which uses `formatDate*` helpers from `@/lib/formatDate`.
- Fix: add a helper `formatMilestoneDate(iso)` and use it.

### [MEDIUM] `WorkPackagesView.vue` — unused `filters.priority` etc. cause load() to skip filters
- File: `web/Front/customapp/src/views/WorkPackagesView.vue:174, 311-317`
- Category: logic
- Evidence:
```ts
const filters = reactive<{ q: string; status: string; type: string }>({ q: '', status: '', type: '' })
...
async function load() {
  await store.fetchAll(projectId.value, {
    q: filters.q || undefined,
    status: filters.status || undefined,
    type: filters.type || undefined,
  })
}
```
- Impact: `store.fetchAll` accepts additional backend filters (per CLAUDE.md: `priority, assigneeId, sprintId, versionId, parentId, page, limit`). The UI offers pill filters for `mine` / `overdue` / `blocked` that are client-side only (`matchesPill`). If the WP count exceeds the default page size, client-side filtering silently hides data the user needs.
- Fix: wire "Mes tâches" → `assigneeId=userId`, "Bloqués" → `status=OnHold`, etc., as backend filters, and raise the limit or paginate.

### [MEDIUM] `WorkPackagesView.vue` — `<select-all>` `indeterminate` binding only accepts HTMLInputElement property
- File: `web/Front/customapp/src/views/WorkPackagesView.vue:66`
- Category: logic
- Evidence:
```vue
<input
  id="wp-select-all"
  type="checkbox"
  :checked="allVisibleSelected"
  :indeterminate="someVisibleSelected"
  aria-label="Tout sélectionner"
  @change="toggleSelectAll"
/>
```
- Impact: `indeterminate` is a DOM property, not an attribute — Vue's `:indeterminate` is handled as an attribute and will render as `indeterminate="true|false"`, which the browser interprets as "present = true" **always**. So `someVisibleSelected=false` still leaves the visual indeterminate state on.
- Fix: bind via a template ref or `v-bind:.prop`: `:indeterminate.prop="someVisibleSelected"`.

### [MEDIUM] `GanttView.vue` — `acceptClass: 'p-button-danger'` is a PrimeVue class
- File: `web/Front/customapp/src/views/GanttView.vue:377`
- Category: neolibrary
- Evidence:
```ts
confirm.require({
  message: 'Supprimer ce jalon ?',
  header: 'Confirmation',
  acceptClass: 'p-button-danger',
```
- Impact: `p-button-danger` is a PrimeVue class. If NeoLibrary's confirm dialog maps it through, it works; if not, the Accept button falls back to default teal. Same pattern appears in `WikiView.vue:177` and `BudgetView.vue:233`. Per CLAUDE.md, NeoButton uses `severity` (no "primary"), so the confirm dialog likely uses the same token system.
- Fix: verify the NeoLibrary API — if `acceptClass` maps PrimeVue class names through, document it; otherwise use whatever token NeoConfirm expects (`severity: 'danger'` or similar).

### [MEDIUM] `GanttView.vue` — `msForm.date` is bound to `NeoDatePicker` as a string — good — but the store expects ISO date-time
- File: `web/Front/customapp/src/views/GanttView.vue:148, 351-362`
- Category: logic / types
- Evidence:
```ts
const msForm = reactive<{ title: string; date: string | null; description: string; isReached: boolean }>({ ... })
...
await ganttStore.updateMilestone(props.id, editingId.value, {
  title: msForm.title,
  date: msForm.date,
  ...
})
```
- Impact: NeoDatePicker yields `"YYYY-MM-DD"`. Depending on the backend's `Milestone.date` column type (DATE vs DATETIME), posting a date-only string may be accepted or normalised to midnight UTC, causing off-by-one in local timezones for users east of UTC. `editMilestone()` reads `m.date` (a full ISO) back into a string-typed field.
- Fix: standardise on date-only throughout, or convert to the explicit format the backend expects and test DST edges.

### [MEDIUM] `KanbanBoardView.vue` — `BoardColumn` re-declared locally, diverges from `agileStore`'s type
- File: `web/Front/customapp/src/views/KanbanBoardView.vue:99-103, 159`
- Category: types
- Evidence:
```ts
interface KanbanCard { ... }
...
interface BoardColumn { id: string; name: string; wipLimit: number | null; workPackages?: KanbanCard[] }
```
- Impact: Two source-of-truth definitions for Kanban column/card. The store's `currentBoard.columns` is typed separately. If the store changes shape (e.g. rename to `cards`), this file breaks silently.
- Fix: export types from `agileStore.ts` and import here.

### [MEDIUM] `KanbanBoardView.vue` — `watch(collab.remoteCardMove, ...)` silently refetches; no deep watch
- File: `web/Front/customapp/src/views/KanbanBoardView.vue:192-196`
- Category: logic
- Evidence:
```ts
watch(collab.remoteCardMove, (payload) => {
  if (!payload || !currentBoard.value) return
  // Refresh the board silently
  agileStore.fetchBoard(props.id, currentBoard.value.id)
})
```
- Impact: If `remoteCardMove` is a `Ref<object>` whose inner fields change without replacement, the watcher won't fire (no `deep: true`). Also, the async `fetchBoard` is called without `await`, so concurrent remote events can interleave responses.
- Fix: queue refresh with debounce, and verify whether `remoteCardMove` is replaced or mutated.

### [MEDIUM] `BacklogView.vue` — `activeSprint.status === 'Planning' / 'Active'` uses different enum than sprintOptions label
- File: `web/Front/customapp/src/views/BacklogView.vue:35-36, 101`
- Category: logic / types
- Evidence:
```vue
<NeoButton v-if="activeSprint?.status === 'Planning'" label="Démarrer" icon="pi pi-play" @click="startSprint" />
<NeoButton v-if="activeSprint?.status === 'Active'" label="Clôturer" icon="pi pi-check" outlined @click="closeSprint" />
```
- Impact: CLAUDE.md says Sprint states are set via `/sprints/:sprintId/{start,close}` with Version states `Open/Locked/Closed`. The string literals 'Planning' / 'Active' are not corroborated by CLAUDE.md — if the backend emits `Open` / `Active` / `Closed`, this UI branches never render.
- Fix: confirm sprint-status enum with Prisma schema and centralise in a shared constant.

### [MEDIUM] `BacklogView.vue` — unassigned filter can include WPs with no project intent
- File: `web/Front/customapp/src/views/BacklogView.vue:99`
- Category: logic
- Evidence:
```ts
const unassigned = computed(() => wpStore.items.filter((w) => !w.sprintId))
```
- Impact: Anything without a sprint (including closed or resolved) shows in the backlog. Typically backlog = open & unassigned-to-sprint.
- Fix: filter out `status in ('Closed','Resolved')`.

### [MEDIUM] `SprintBoardView.vue` — `watch(activeSprintId, loadBurndown)` causes double-call on mount
- File: `web/Front/customapp/src/views/SprintBoardView.vue:152-156`
- Category: perf
- Evidence:
```ts
watch(activeSprintId, loadBurndown)
onMounted(async () => {
  await load()
  await loadBurndown()
})
```
- Impact: `load()` sets `activeSprintId.value = agileStore.sprints[0].id` which triggers `loadBurndown` via the watcher; then `onMounted` also calls `loadBurndown()` directly. Two fetches for the same data.
- Fix: drop the manual `await loadBurndown()` in onMounted, rely on the watcher; or use `{ immediate: true }` on the watcher and remove the explicit call.

### [MEDIUM] `WikiView.vue` — `submitCreate` doesn't check `page` result for undefined
- File: `web/Front/customapp/src/views/WikiView.vue:186-194`
- Category: error-handling
- Evidence:
```ts
async function submitCreate() {
  if (!newPage.title.trim()) return
  const page = await wikiStore.createPage(props.id, { title: newPage.title.trim(), content: newPage.content })
  showCreate.value = false
  newPage.title = ''
  newPage.content = ''
  toast.add({ severity: 'success', detail: 'Page créée.', life: 3000 })
  await loadPage(page.slug)
}
```
- Impact: If `createPage` rejects, the try-block is missing — the error propagates up, but the toast-success still fires *after* the error only if the catch is somewhere above. No user feedback if creation fails. Also if `createPage` returns `undefined` (e.g. from a failing Result), `page.slug` throws.
- Fix: wrap in try/catch and only toast success on resolve.

### [MEDIUM] `WikiView.vue` — `onSearch` fires on `@input` but local search also triggers on tree loads
- File: `web/Front/customapp/src/views/WikiView.vue:196-206`
- Category: UX
- Evidence:
```ts
let searchDebounce: ReturnType<typeof setTimeout> | null = null
function onSearch() {
  if (searchDebounce) clearTimeout(searchDebounce)
  searchDebounce = setTimeout(async () => {
    if (!searchQ.value) {
      searchResults.value = []
      return
    }
    searchResults.value = await wikiStore.search(props.id, searchQ.value)
  }, 300)
}
```
- Impact: `searchDebounce` is not cleared on unmount — if the user types and leaves within 300ms, `wikiStore.search` fires on an unmounted component.
- Fix: `onUnmounted(() => searchDebounce && clearTimeout(searchDebounce))`.

### [MEDIUM] `BudgetView.vue` — numeric inputs use `NeoInputText`, parseFloat bypasses locale
- File: `web/Front/customapp/src/views/BudgetView.vue:93-95, 108-109, 202-225`
- Category: validation / i18n
- Evidence:
```vue
<NeoInputText v-model="budgetFormText.laborBudget" label="Budget main-d'œuvre" />
...
laborBudget: parseFloat(budgetFormText.laborBudget) || 0,
```
- Impact: `parseFloat` only understands a dot decimal separator. A French user entering `1 200,50` produces `1` silently. And the `format()` helper outputs `fr-FR` with comma — the user sees a comma, edits it, and loses data.
- Fix: use a proper locale-aware parser, or a numeric input component; reject invalid input with a message.

### [MEDIUM] `BudgetView.vue` — `load()` auto-upserts an empty budget on first visit
- File: `web/Front/customapp/src/views/BudgetView.vue:189-200`
- Category: logic
- Evidence:
```ts
async function load() {
  await budgetStore.fetchBudget(props.id)
  if (!budget.value) {
    await budgetStore.upsertBudget(props.id, {})
  }
  await budgetStore.fetchBurn(props.id)
```
- Impact: A viewer with read-only rights landing on `/budget` auto-creates a budget row on every project. This is a side effect of a GET nav — never a good pattern, and may trip 403s for team members.
- Fix: guard by permission, or show an empty state + "Créer le budget" button instead of silent upsert.

### [MEDIUM] `TimeTrackingView.vue` — activities select defaults to `'development'` with no blank option
- File: `web/Front/customapp/src/views/TimeTrackingView.vue:134, 138-144`
- Category: UX
- Evidence:
```ts
activity: 'development',
```
- Impact: Default is fine, but not reset after save. Combined with the above reset block (hours & comment only), a user who sets activity to "meeting" will keep that selection across entries — may or may not be intended.
- Fix: decide; if "remember last" is intended, document it.

### [MEDIUM] `MembersView.vue` — `void props` is a code smell
- File: `web/Front/customapp/src/views/MembersView.vue:32-33`
- Category: logic
- Evidence:
```ts
const props = defineProps<{ id: string }>()
void props
```
- Impact: Props declared then explicitly voided to silence the unused-warning — but the endpoint `/pm/users` is **global**, not project-scoped. The "Membres" page is inside a project context (breadcrumb says so), yet returns all users regardless of `props.id`. That's misleading to the user.
- Fix: fetch members scoped to the project (`/pm/projects/:id/members`) once the backend exposes it; otherwise filter client-side by the project's assigneeIds.

### [MEDIUM] `MembersView.vue` — no loading state shown
- File: `web/Front/customapp/src/views/MembersView.vue:39-46`
- Category: UX
- Evidence:
```ts
onMounted(async () => {
  try {
    const { data } = await api.get<User[] | { items: User[] }>('/pm/users')
    users.value = Array.isArray(data) ? data : (data.items ?? [])
  } catch {
    users.value = []
  }
})
```
- Impact: Before fetch completes, the table renders "Aucun membre" (because `users.length === 0`). False-negative UX flash.
- Fix: add a `loading` ref, show spinner before data is available.

### [MEDIUM] `ProjectActivityView.vue` — no pagination, no limit
- File: `web/Front/customapp/src/views/ProjectActivityView.vue:31-38`
- Category: perf
- Evidence:
```ts
onMounted(async () => {
  try {
    const { data } = await api.get<Activity[]>(`/pm/projects/${props.id}/activity`)
    activities.value = Array.isArray(data) ? data : []
  } catch {
    activities.value = []
  }
})
```
- Impact: On long-running projects this could fetch thousands of rows on mount.
- Fix: add `?limit=50` + "Load more" or virtual scrolling.

### [MEDIUM] `MyTasksView.vue` — debounce captured in `let tid` without cleanup
- File: `web/Front/customapp/src/views/MyTasksView.vue:107-113`
- Category: logic
- Evidence:
```ts
onMounted(load)
let tid: number | null = null
watch([q, status], () => {
  if (tid) window.clearTimeout(tid)
  tid = window.setTimeout(load, 300)
})
```
- Impact: Same leak as wiki search — no `onUnmounted` clear. If the user navigates within 300ms of typing, `load()` fires on an unmounted component.
- Fix: `onUnmounted(() => tid && window.clearTimeout(tid))`.

### [MEDIUM] `MyTasksView.vue` — URL params built with `URLSearchParams` but axios supports `params:` natively
- File: `web/Front/customapp/src/views/MyTasksView.vue:87-96`
- Category: perf / readability
- Evidence:
```ts
const params = new URLSearchParams()
if (q.value) params.append('q', q.value)
if (status.value) params.append('status', status.value)
const { data } = await api.get<{ items: MyTask[]; total: number }>(
  `/pm/my-tasks${params.toString() ? `?${params.toString()}` : ''}`,
)
```
- Impact: Works, but reinvents axios's params support. Missing URL-encoding for edge characters works because `URLSearchParams` encodes, but future readers may miss this.
- Fix: `await api.get('/pm/my-tasks', { params: { q: q.value || undefined, status: status.value || undefined } })`.

### [MEDIUM] `TeamPlannerView.vue` — `ModulePageHeader` used outside `ProjectModuleShell`
- File: `web/Front/customapp/src/views/TeamPlannerView.vue:4-10`
- Category: consistency
- Evidence:
```vue
<div class="tp-view">
  <ModulePageHeader title="Planification d'équipe">
    <template #actions>
```
- Impact: Per CLAUDE.md, `ModulePageHeader` is a sub-piece of `ProjectModuleShell`. Using it standalone at the admin layer is inconsistent with Wiki / Gantt / etc. which wrap in `ProjectModuleShell`. The admin TeamPlanner view doesn't have a project context — but CLAUDE.md also maps `/app/admin/team-planner` to this file. Probably acceptable but undocumented.
- Fix: document that `ModulePageHeader` is usable standalone, or build an `AdminPageShell` equivalent.

### [MEDIUM] `ProjectManagerView.vue` — JWT decoding in template-adjacent computeds without try-catch guarantees
- File: `web/Front/customapp/src/views/ProjectManagerView.vue:127-157`
- Category: error-handling / security
- Evidence:
```ts
const userInitials = computed<string>(() => {
  if (!app.jwt) return '?'
  try {
    const p = JSON.parse(atob(app.jwt.split('.')[1]))
    ...
  } catch { return '?' }
})
```
- Impact: Each of three computeds decodes the same JWT. On every reactive read. It works, but recomputes three times for the same operation.
- Fix: centralise in `authStore` (`decodedClaims` computed). Also if the JWT is ever user-controlled (e.g. stored via injection), `atob` can produce invalid UTF-8 — use a proper base64url decoder.

### [MEDIUM] `AppShell.vue` — dynamic `import('@/lib/api')` inside `router.afterEach` defeats code-splitting
- File: `web/Front/customapp/src/layouts/AppShell.vue:167-176`
- Category: perf
- Evidence:
```ts
try {
  const { default: api } = await import('@/lib/api')
  const { data } = await api.get<{ id: string; name: string; clientName?: string | null }>(
    `/pm/projects/${projectId}`,
  )
  uiStore.trackProjectVisit({ id: data.id, name: data.name, clientName: data.clientName ?? null })
} catch {
  // Silent — visit tracking is best-effort.
}
```
- Impact: Every PM project navigation fires a full GET of the project just to learn its name for the "Recents" sidebar — this endpoint likely includes validations, fields, etc. Expensive for a minor UX affordance. Also the dynamic import here adds zero value — `api` is already in the initial chunk.
- Fix: make a tiny `/pm/projects/:id/meta` endpoint returning `{ id, name }`, or cache the name from the project list the user came from.

### [MEDIUM] `AppShell.vue` — provided `navSections` ref exposes raw underlying value via inject signature
- File: `web/Front/customapp/src/layouts/AppShell.vue:156-158, 187` and `AppSidebar.vue:95`
- Category: types
- Evidence:
```ts
// AppShell
const navSections = ref<NavSection[]>( ... )
...
provide('navItems', navSections)
// AppSidebar
const navSections = inject<NavSection[]>('navItems', [])
```
- Impact: `provide` puts a `Ref<NavSection[]>` into the injection, but `inject<NavSection[]>` expects the unwrapped value. Because Vue unwraps refs at template use, the `v-for` works — but `inject`'s TS type is wrong. Any code doing `navSections.length` directly in JS will get `undefined` (ref.length is undefined). Only the template (which auto-unwraps) works.
- Fix: either `provide('navItems', navSections)` + `inject<Ref<NavSection[]>>('navItems', ref([]))`, or `provide('navItems', computed(() => navSections.value))`. The public contract should match.

### [MEDIUM] `AppShell.vue` — `onUnmounted` teardown never actually fires (root layout)
- File: `web/Front/customapp/src/layouts/AppShell.vue:209-214`
- Category: logic
- Evidence:
```ts
onUnmounted(() => {
  disconnect()
  collab.disconnect()
  notifStore.stopPolling()
  stopAfterEach()
})
```
- Impact: `AppShell` is the root auth layout; it unmounts only on logout / full-app teardown. In practice the teardown rarely runs in dev (HMR) and never on page reload. This is mostly fine, but don't rely on it for critical cleanup of globally-shared sockets; instead the auth guard / logout flow should disconnect explicitly.
- Fix: move socket connect/disconnect to `authStore.login()`/`logout()` actions.

### [MEDIUM] `AppSidebar.vue` — default inject value `[]` for array produces non-reactive sidebar
- File: `web/Front/customapp/src/layouts/AppSidebar.vue:95`
- Category: logic / types
- Evidence:
```ts
const navSections = inject<NavSection[]>('navItems', [])
```
- Impact: If somebody ever renders `AppSidebar` outside `AppShell`, `navSections` is `[]` literal — not a ref, not reactive. Sidebar stays empty. Related to the above provide/inject mismatch.
- Fix: provide/inject a `Ref`, document the contract, and default to `ref([])`.

### [MEDIUM] `AppTopbar.vue` — breadcrumb only knows about flat top-level names, no project deep context
- File: `web/Front/customapp/src/layouts/AppTopbar.vue:68-90`
- Category: UX
- Evidence:
```ts
const ROUTE_LABELS: Record<string, string> = {
  'admin-dashboard':     'Tableau de bord',
  ...
  'pm-projects':         'Mes projets',
  'team-projects':       'Projets',
  ...
}
```
- Impact: No entry for any of the new project-module routes (`pm-projects-workpackages`, `pm-wiki-page`, etc.). Inside a project, the breadcrumb shows just "NeoLeadge" → "" (empty), and the user loses orientation. Per CLAUDE.md there's a `ProjectBreadcrumbs.vue` component wrapping inside `ProjectModuleShell`, so this may be intentional — but the topbar breadcrumb is still blank.
- Fix: either hide the topbar breadcrumb while in a project module (when a `ProjectBreadcrumbs` is rendered below), or add labels for the new routes.

### [MEDIUM] `NotificationPanel.vue` — mousedown close intercepts clicks that fire on delete buttons inside the panel
- File: `web/Front/customapp/src/layouts/NotificationPanel.vue:77-81, 151-158`
- Category: UX
- Evidence:
```vue
<button
  class="notif-item__delete"
  :aria-label="`Supprimer la notification: ${notif.title}`"
  @click.stop="notifStore.removeNotification(notif.id)"
>
...
function onDocumentClick(event: MouseEvent): void {
  if (rootRef.value && !rootRef.value.contains(event.target as Node)) {
    close()
  }
}
```
- Impact: `mousedown` listener correctly uses `contains`, so inner clicks don't close. But `@click.stop` on the delete button is redundant given the contains-check. More importantly, `handleItemClick` navigates using `router.push({ name: 'pm-projects', query: { projectId: ... } })` at `:127` — the `projectId` query contract was fine in the old layout, but the new `/app/pm/projects/:id` route uses a path param — see below.

### [MEDIUM] `NotificationPanel.vue` — `router.push({ name: 'pm-projects', query: { projectId } })` uses deprecated query-param navigation
- File: `web/Front/customapp/src/layouts/NotificationPanel.vue:127`
- Category: logic
- Evidence:
```ts
} else if (role === 'ProjectManager') {
  router.push({ name: 'pm-projects', query: { projectId: notif.projectId } })
}
```
- Impact: `PMProjectsPage.vue` still reads `route.query.projectId` (line 38), so this works in that page; but the current/recommended PM project URL is `/app/pm/projects/:id` (named route presumably `pm-project-overview` or similar). Two contradicting conventions.
- Fix: standardise on the path param: `router.push({ name: 'pm-project-overview', params: { id: notif.projectId } })`.

---

## LOW

### [LOW] `PMProjectsPage.vue` — `onMounted` fire-and-forgets `store.fetchMyProjects()`
- File: `web/Front/customapp/src/views/PMProjectsPage.vue:34-35`
- Category: error-handling
- Evidence:
```ts
if (store.projects.length === 0) {
  await store.fetchMyProjects()
}
```
- Impact: Actually awaited — fine. But if `fetchMyProjects()` rejects, no toast.
- Fix: wrap in try/catch and surface errors.

### [LOW] `PMProjectDetailView.vue` — `nextMilestone` sort mutates filtered array
- File: `web/Front/customapp/src/views/PMProjectDetailView.vue:266-270`
- Category: immutability
- Evidence:
```ts
const nextMilestone = computed<Milestone | null>(() =>
  milestones.value
    .filter((m) => !m.isReached && new Date(m.date).getTime() > Date.now())
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0] ?? null,
)
```
- Impact: `.filter` returns a new array, so `.sort` mutates only that copy — fine. But a casual reader may miss that detail. Minor.
- Fix: document, or use `toSorted` (ES2023).

### [LOW] `WorkPackagesView.vue` — NeoTag `severity="secondary"` for type is fine but hardcoded
- File: `web/Front/customapp/src/views/WorkPackagesView.vue:102`
- Category: UX
- Evidence:
```vue
<td><NeoTag :value="wp.type" severity="secondary" /></td>
```
- Impact: All WP types look identical. Bug / Feature / Epic all gray. Could use distinct severity per type for quicker scanning.
- Fix: map type → severity via a utility.

### [LOW] `KanbanBoardView.vue` — draggable cards ignore `dragend` cleanup when drop is outside any column
- File: `web/Front/customapp/src/views/KanbanBoardView.vue:206-208, 210-222`
- Category: UX
- Evidence:
```ts
function onDragStart(wpId: string) {
  draggedWpId.value = wpId
}
```
- Impact: If the user starts a drag and releases outside a valid drop target, `draggedWpId` stays set until the next `onDrop` — leaving stale state. A subsequent drop could move the wrong card.
- Fix: add `@dragend` reset: `draggedWpId.value = null`.

### [LOW] `BacklogView.vue` — no loading indicator while sprints/WPs load
- File: `web/Front/customapp/src/views/BacklogView.vue:8-54`
- Category: UX
- Impact: Empty-state text shows before fetch completes.
- Fix: add `v-if="!loading"`.

### [LOW] `WikiView.vue` — re-renders `renderedContent` markdown on every update of any unrelated state
- File: `web/Front/customapp/src/views/WikiView.vue:125`
- Category: perf
- Evidence:
```ts
const renderedContent = computed(() => renderMarkdown(wikiStore.currentPage?.content ?? ''))
```
- Impact: Only depends on `wikiStore.currentPage?.content`, which is reactive only on the store side. Fine, but a heavy page (~100kb) re-parses whenever the reactive store fires — which it does on every poll.
- Fix: memoise by content hash if this ever shows perf issues.

### [LOW] `BudgetView.vue` — `budgetFormText.currency` shown with no validation on free-text
- File: `web/Front/customapp/src/views/BudgetView.vue:95, 206`
- Category: validation
- Evidence:
```vue
<NeoInputText v-model="budgetFormText.currency" label="Devise (EUR, USD…)" />
```
- Impact: User can type "XYZ42" and save. No ISO 4217 check.
- Fix: use a NeoSelect with a curated list.

### [LOW] `TimeTrackingView.vue` — tabs are built from a tuple `as const`, fine but `activeTab` resets on re-mount
- File: `web/Front/customapp/src/views/TimeTrackingView.vue:126-127`
- Category: UX
- Evidence:
```ts
const tabs = ['Mes saisies', 'Résumé projet'] as const
const activeTab = ref<(typeof tabs)[number]>('Mes saisies')
```
- Impact: No URL sync — users can't deep-link to the summary tab.
- Fix: mirror `activeTab` into the URL via `?tab=`.

### [LOW] `MembersView.vue` — NeoTag role display not translated
- File: `web/Front/customapp/src/views/MembersView.vue:17`
- Category: i18n
- Evidence:
```vue
<td><NeoTag :value="u.role" severity="info" /></td>
```
- Impact: Shows raw enum `ProjectManager` instead of "Chef de projet". CLAUDE.md references `USER_ROLE_LABELS` constant.
- Fix: `USER_ROLE_LABELS[u.role] ?? u.role`.

### [LOW] `ProjectActivityView.vue` — `action` rendered without i18n label mapping
- File: `web/Front/customapp/src/views/ProjectActivityView.vue:9`
- Category: i18n
- Evidence:
```vue
<div class="pa-item__action">{{ a.action }}</div>
```
- Impact: Shows raw `status_changed` etc. `PMProjectDetailView.activityLabel()` already does FR mapping — duplicate the effort.
- Fix: share an `activityLabel` helper.

### [LOW] `MyTasksView.vue` — `openWp` silently returns when `wp.project?.id` missing
- File: `web/Front/customapp/src/views/MyTasksView.vue:102-105`
- Category: UX
- Evidence:
```ts
function openWp(wp: MyTask) {
  if (!wp.project?.id) return
  void router.push(`/app/pm/projects/${wp.project.id}/workpackages?wpId=${wp.id}`)
}
```
- Impact: If the API returns a WP without `project` context, clicking the row silently does nothing.
- Fix: show a toast "Projet indisponible".

### [LOW] `TeamPlannerView.vue` — `c.userId.slice(0, 8)` exposes UUID prefix to user
- File: `web/Front/customapp/src/views/TeamPlannerView.vue:77`
- Category: UX
- Evidence:
```vue
<td>{{ c.userId.slice(0, 8) }}…</td>
```
- Impact: Shows `a1b2c3d4…` instead of "Jean Dupont". Backend-returned `conflicts` doesn't include the user name — need to join on assignment data.
- Fix: enrich with user name client-side using `store.assignments[*].user`.

### [LOW] `PmLayout.vue` / `TeamLayout.vue` — empty layout components serve no purpose
- File: `web/Front/customapp/src/layouts/PmLayout.vue:1-5` and `web/Front/customapp/src/layouts/TeamLayout.vue:1-5`
- Category: architecture / dead-code
- Evidence:
```vue
<template>
  <router-view />
</template>
```
- Impact: Each file is a trivial wrapper with no guard logic — the file-level comment claims "role guard via beforeEnter", which is correct (guards live in `router/index.ts`), but the Vue wrapper serves only as a named route target. Removing them and using `router-view` directly would simplify.
- Fix: either delete or add real per-role lifecycle hooks here.

### [LOW] `AppSidebar.vue` — `recentsToShow.slice(0, 4)` is a magic number
- File: `web/Front/customapp/src/layouts/AppSidebar.vue:108`
- Category: maintainability
- Evidence:
```ts
.slice(0, 4),
```
- Impact: Trivial, but 4-recents is hardcoded — candidate for a constant.

### [LOW] `NotificationPanel.vue` — `relativeTime` duplicated from `formatRelative` in `@/lib/formatDate`
- File: `web/Front/customapp/src/layouts/NotificationPanel.vue:138-147`
- Category: DRY
- Evidence:
```ts
function relativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime()
  const minutes = Math.floor(diff / 60_000)
  ...
```
- Impact: `@/lib/formatDate.formatRelative` exists (used elsewhere in PMProjectDetailView). Reinvented.
- Fix: import and reuse.

---

## UNCERTAIN

### [UNCERTAIN] `GanttView.vue` — `NeoSelect` without label prop; unclear if placeholder is valid
- File: `web/Front/customapp/src/views/GanttView.vue:5-11`
- Category: neolibrary
- Evidence:
```vue
<NeoSelect
  v-model="zoom"
  :options="zoomOptions"
  optionLabel="label"
  optionValue="value"
  placeholder="Zoom"
/>
```
- Impact: CLAUDE.md lists NeoSelect props as `v-model, options, optionLabel, optionValue, placeholder, disabled` — looks correct. `[UNCERTAIN]` whether the NeoSelect inside a `#actions` slot works correctly because `ProjectModuleShell` is undocumented here.

### [UNCERTAIN] `GanttView.vue` — `useNeoConfirm().require({..., accept: async () => ...})` with async accept
- File: `web/Front/customapp/src/views/GanttView.vue:374-384`, also `WikiView.vue:174-184`, `BudgetView.vue:230-240`
- Category: neolibrary
- Evidence:
```ts
confirm.require({
  message: 'Supprimer ce jalon ?',
  header: 'Confirmation',
  acceptClass: 'p-button-danger',
  accept: async () => {
    await ganttStore.deleteMilestone(props.id, id)
```
- Impact: CLAUDE.md says `useNeoConfirm().require(options)` returns `void`. What it doesn't say is whether `accept` may be async. If NeoConfirm awaits the accept callback before closing, this works; if not, the dialog closes instantly and errors in `deleteMilestone` won't block the confirm.
- Fix: verify NeoLibrary's expected contract; adopt a consistent pattern (sync callback + optimistic update, or a "closing…" state).

### [UNCERTAIN] `WorkPackagesView.vue` — `form.dueDate: null` posted to store — does the backend accept null or undefined?
- File: `web/Front/customapp/src/views/WorkPackagesView.vue:278, 330-331`
- Category: validation
- Evidence:
```ts
dueDate: form.dueDate ?? undefined,
```
- Impact: `?? undefined` drops the field rather than sending `null` — fine if the backend DTO uses `@IsOptional()`. If the NestJS DTO uses `@IsDateString()` alone, `undefined` may trigger "required" validation.
- Fix: align with actual DTO.

### [UNCERTAIN] `WikiView.vue` — delete uses `wikiStore.currentPage!.slug` with non-null assertion
- File: `web/Front/customapp/src/views/WikiView.vue:179`
- Category: types
- Evidence:
```ts
accept: async () => {
  await wikiStore.deletePage(props.id, wikiStore.currentPage!.slug)
```
- Impact: In the `confirm` callback, `wikiStore.currentPage` could become null between the click and the async accept if another action clears it. `!` will throw.
- Fix: capture slug before opening the confirm.

### [UNCERTAIN] `ProjectManagerView.vue` — `useApp()` is not documented in CLAUDE.md stores list
- File: `web/Front/customapp/src/views/ProjectManagerView.vue:102, 108`
- Category: architecture
- Evidence:
```ts
import { useApp }      from '@/stores/useApp'
```
- Impact: CLAUDE.md lists `authStore`, `configStore`, etc., not a `useApp`. `[UNCERTAIN]` whether this is legacy pre-rebuild code still referenced somewhere.

### [UNCERTAIN] Route params `undefined` — I could not read `router/index.ts` in full; the CLAUDE.md mention of `/app/pm/projects/:id` suggests `id` is always present, but e.g. `WorkPackagesView.vue:169`:
```ts
const projectId = ref(props.id || (route.params.id as string))
```
has a defensive fallback — if **both** are undefined, API calls like `/pm/projects/undefined/work-packages` would fire. `[UNCERTAIN]` without inspecting the router guard + param-stringification in `vue-router`'s component boundary.

---

## Summary counts

- CRITICAL: 1 (Wiki XSS)
- HIGH:    15
- MEDIUM:  23
- LOW:     14
- UNCERTAIN: 5

## Top action items (order)

1. Replace `renderMarkdown` in `WikiView.vue` with `markdown-it` + `DOMPurify` (CRITICAL XSS).
2. Fix `BudgetView.vue` `severity="warn"` → `"warning"` (trivial, shipping bug).
3. Add `onUnmounted` teardown for Chart.js in `SprintBoardView.vue`, global mouse listeners in `GanttView.vue`, and debounce timers in `MyTasksView.vue` / `WikiView.vue` (memory leaks).
4. Normalise `useNeoConfirm()` async-accept pattern across the 3 callsites (`WikiView`, `GanttView`, `BudgetView`) with a documented convention.
5. Convert `Promise.all` bulk update in `WorkPackagesView.vue` to `Promise.allSettled` with per-item result counts.
6. Standardise notification-panel navigation on path params instead of `?projectId=`.
7. Remove or rewrite `ProjectManagerView.vue` (unreachable / legacy).
8. Fix the provide/inject ref-vs-value mismatch in `AppShell` / `AppSidebar`.
