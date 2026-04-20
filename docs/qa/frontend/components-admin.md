# QA — Admin Components

Files opened:
- `C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\components\admin\AssignManagerDialog.vue`
- `C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\components\admin\PersonalDashboard.vue`
- `C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\components\admin\PortalTokenManager.vue`
- `C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\components\admin\PortalTokenTable.vue`
- `C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\components\admin\ProjectBulkToolbar.vue`
- `C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\components\admin\ProjectCreateForm.vue`
- `C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\components\admin\ProjectDetailPanel.vue`
- `C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\components\admin\ProjectList.vue`
- `C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\components\admin\ProjectTableRow.vue`
- `C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\components\admin\TrashSection.vue`
- `C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\components\admin\UserFormDialog.vue`
- `C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\components\admin\UserList.vue`
- `C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\components\admin\sections\ActivitySection.vue`
- `C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\components\admin\sections\AnalyticsBottleneckPanel.vue`
- `C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\components\admin\sections\AnalyticsRiskPanel.vue`
- `C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\components\admin\sections\AnalyticsSection.vue`
- `C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\components\admin\sections\DashboardSection.vue`
- `C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\components\admin\sections\LogsSection.vue`
- `C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\components\admin\sections\ProjectManagementSection.vue`
- `C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\components\admin\sections\SecuritySection.vue`
- `C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\components\admin\sections\SystemStatusSection.vue`
- `C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\components\admin\sections\TemplatesSection.vue`
- `C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\components\admin\sections\UserManagementSection.vue`

Additional type file inspected for context only (not a component, no findings written against it):
- `C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\types\user.types.ts` — confirmed `USER_ROLE_OPTIONS` includes `Admin` role entry.

---

## Findings

### [HIGH] Invalid NeoTag severity `"warn"` used widely (NeoLibrary accepts `"warning"`, not `"warn"`)
- File: `web/Front/customapp/src/components/admin/sections/SystemStatusSection.vue:104`
- Category: neolibrary
- Evidence:
```vue
const statusSeverity = (s: ProjectStatus) =>
  PROJECT_STATUS_SEVERITY[s] as 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast'
```
- Impact: CLAUDE.md declares NeoTag accepts `"success" | "info" | "warning" | "danger" | "secondary" | "contrast"`. Passing `"warn"` silently degrades to default styling (or unstyled) on current library; color will not render as warning orange. Same bug also appears in `TrashSection.vue:104-114`, `ProjectDetailPanel.vue:294`, `DashboardSection.vue:134` (`<NeoTag ... severity="warn" />`), `DashboardSection.vue:317`, `PersonalDashboard.vue:52` (`:severity="isOverdue(p.endDate) ? 'danger' : 'warn'"`), `ProjectBulkToolbar.vue:17` (`<NeoButton ... severity="warn">`), `ProjectManagementSection.vue:99` (`severity="warn"`), `ProjectManagementSection.vue:207` (`severity="warn"`), `UserList.vue:97` (`severity="warn"`).
- Fix: Replace all `"warn"` severities with `"warning"` to match the documented NeoLibrary API. Also update the upstream `PROJECT_STATUS_SEVERITY` map in `types/project.types.ts` if it is the source of the value. [UNCERTAIN: this depends on whether NeoLibrary silently accepts `"warn"` as an alias; the prop-type union in `PersonalDashboard.vue:122` even includes `'primary'` which is also invalid per CLAUDE.md.]

### [HIGH] `UserFormDialog` lets any admin create another Admin client-side — escalation surface depends entirely on backend role check
- File: `web/Front/customapp/src/components/admin/UserFormDialog.vue:58-63`
- Category: validation
- Evidence:
```vue
<NeoSelect
  v-model="form.role"
  label="Rôle"
  :options="USER_ROLE_OPTIONS"
  optionLabel="label"
  optionValue="value"
  :error="errors.role"
  required
/>
```
And:
```ts
// types/user.types.ts:26
export const USER_ROLE_OPTIONS = (Object.entries(USER_ROLE_LABELS) as [UserRole, string][]).map(
  ([value, label]) => ({ value, label }),
)
```
`USER_ROLE_LABELS` includes `Admin`. The submit payload on `UserFormDialog.vue:170-176` emits `role: form.role` without any further check.
- Impact: Any user who can open this dialog (i.e., someone with access to admin UI) can select `Administrateur` from the dropdown. Security rests entirely on the backend rejecting non-admin callers. That is the correct defense but the frontend has zero UX guardrails — no warning, no confirm, no visual distinction for the Admin option. A compromised lower-privileged admin session (e.g., a delegated ops user reaching this screen) can silently create Admins.
- Fix: (a) gate the Admin option behind `authStore.currentUser.role === 'Admin'` before including it in `USER_ROLE_OPTIONS`; (b) show a confirm dialog when role === `Admin`; (c) show a warning badge in the role-hint paragraph (`UserFormDialog.vue:64`). Also verify backend rejects payloads where the caller's role is not Admin.

### [HIGH] Password-strength validation is only a length check — no uppercase/digit check although placeholder promises it
- File: `web/Front/customapp/src/components/admin/UserFormDialog.vue:45-52, 155-156`
- Category: validation
- Evidence:
```vue
<NeoPassword
  v-if="!isEdit"
  v-model="form.password"
  label="Mot de passe"
  placeholder="Min. 8 caractères, 1 maj, 1 chiffre"
  :error="errors.password"
  toggleMask
  :feedback="true"
  required
/>
```
```ts
if (!isEdit.value && form.password.length < 8)
  errors.password = 'Au moins 8 caractères.'
```
- Impact: The placeholder (line 47) claims at least one uppercase and one digit are required but `validate()` only checks `length < 8`. Users who comply with the placeholder get no bonus, users who enter `"aaaaaaaa"` silently pass. Security regression vs. user expectation; backend strength check is unknown (not verified in this pass).
- Fix: Add regex validation: `if (!/[A-Z]/.test(p) || !/[0-9]/.test(p) || p.length < 8)` with clear error text. Keep the backend as the source of truth but reflect it client-side.

### [HIGH] `UserManagementSection` manipulates child composable state directly (`um.showCreateDialog.value = false`) from the template
- File: `web/Front/customapp/src/components/admin/sections/UserManagementSection.vue:84, 93, 131`
- Category: logic
- Evidence:
```vue
@close="um.showCreateDialog.value = false"
...
@close="um.showEditDialog.value = false; um.editingUser.value = null"
...
@click="um.showTempPasswordDialog.value = false; copied = false"
```
- Impact: Template is poking `.value` on refs exposed from a composable. Fragile — if `useUserManagement` ever returns a computed or wrapped ref, this breaks at runtime without a TS error. Also increases coupling and prevents reactivity audits. Multi-statement handlers (`um.showEditDialog.value = false; um.editingUser.value = null`) are hard to debug.
- Fix: Expose `closeCreate()`, `closeEdit()`, `closeTempPassword()` methods on the composable. Replace inline assignment handlers with method calls.

### [HIGH] `UserManagementSection` temp-password dialog leaves plaintext password visible until dialog is closed; no auto-close on timeout
- File: `web/Front/customapp/src/components/admin/sections/UserManagementSection.vue:98-134`
- Category: security
- Evidence:
```vue
<Dialog
  :visible="um.showTempPasswordDialog.value"
  ...
>
  ...
  <code class="temp-value">{{ um.tempPassword.value }}</code>
```
The dialog only closes on explicit user action; no auto-timeout, no audit logging shown client-side.
- Impact: A generated password remains on-screen indefinitely — it can be screen-captured, screen-shared, or viewed by shoulder-surfers. The `copied` reset is 3 s (line 181) but the actual password element is persistent.
- Fix: Auto-close the dialog after a bounded time (e.g., 2 min) and/or blur-redact after first copy. Consider requiring the admin to copy it exactly once before close is enabled.

### [HIGH] `SecuritySection` 2FA-disable form is vulnerable to double-submit via Enter key
- File: `web/Front/customapp/src/components/admin/sections/SecuritySection.vue:79-86, 180-195`
- Category: logic
- Evidence:
```vue
<NeoButton
  type="submit"
  label="Confirmer la désactivation"
  icon="pi pi-shield"
  severity="danger"
  :loading="loadingAction"
  :disabled="disableCode.length !== 6"
/>
```
and the handler:
```ts
const handleDisable = async () => {
  actionError.value  = null
  loadingAction.value = true
  try {
    await api.post('/auth/2fa/disable', { code: disableCode.value })
    ...
```
The outer `<form @submit.prevent="handleDisable" novalidate>` (line 57) will re-fire on Enter-press mid-flight; the only guard is `:disabled` against `disableCode.length !== 6`. It does NOT guard on `loadingAction`.
- Impact: If the user hits Enter twice before the response arrives, a second POST with the same 6-digit code is issued. TOTP codes are usually single-use — the second request will fail server-side but the UI will flip `actionError` to "Code invalide" even though the first call succeeded. Confusing UX and a potential denial-of-2FA-disable scenario.
- Fix: Add `|| loadingAction` to `:disabled`, and/or bail early in `handleDisable` if `loadingAction.value` is already true.

### [MEDIUM] `ProjectCreateForm` uses `NeoDatePicker` but never constrains type — may bind raw `Date` if store reassigns
- File: `web/Front/customapp/src/components/admin/ProjectCreateForm.vue:54-69`
- Category: neolibrary
- Evidence:
```vue
<NeoDatePicker
  v-model="form.startDate"
  label="Date de début"
  dateFormat="dd/mm/yy"
  :error="errors.startDate"
  required
  class="project-form__field"
/>
```
- Impact: `form` comes from `useProjectForm()` (line 108). CLAUDE.md states "NeoDatePicker v-model must be `string | null` — never bind to a `Date` object". Without inspecting `useProjectForm`, this component is one typo (`new Date()`) away from silent breakage. [UNCERTAIN — cannot see `useProjectForm.ts` in the scoped files.]
- Fix: Add a runtime assertion in the composable and/or explicitly type `form.startDate: string | null`. Verify `useProjectForm` never sets these fields to `Date` instances.

### [MEDIUM] `ProjectCreateForm` double-submit race between `submitCreate()` and template-apply call
- File: `web/Front/customapp/src/components/admin/ProjectCreateForm.vue:136-158`
- Category: logic
- Evidence:
```ts
const handleSubmit = async () => {
  const ok = await submitCreate()
  if (!ok) return

  const createdId = projectStore.currentProject?.id ?? null

  if (selectedTemplateId.value && createdId) {
    applyingTemplate.value = true
    try {
      await templateStore.applyToProject(selectedTemplateId.value, createdId)
```
The Create button is guarded by `:loading="submitting || applyingTemplate"` (line 88), but nothing prevents clicking Cancel between `submitCreate()` returning and the template apply finishing. The created project exists; closing the form orphans the template-application promise with no user feedback if it fails afterwards (the `toast.add` still runs via `finally`, but user has navigated away).
- Impact: Stuck state where a project is created without its template fields, user assumes all worked.
- Fix: Emit `created` only after both awaits succeed; disable Cancel while `applyingTemplate` is true.

### [MEDIUM] `ProjectList` filter debounce timer is module-scoped (not ref), so subsequent mounts share state
- File: `web/Front/customapp/src/components/admin/ProjectList.vue:149, 156-159`
- Category: perf
- Evidence:
```ts
let debounceTimer: ReturnType<typeof setTimeout> | null = null

watch(localSearch, () => {
  if (debounceTimer !== null) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => { currentSkip.value = 0; runSearch() }, 300)
})
```
`let debounceTimer` is declared in `<script setup>` — fine for a single instance, but there is no `onUnmounted` cleanup; if the component is unmounted during the 300 ms window, `runSearch()` will fire on an unmounted store listener. The Pinia store action still runs, which may trigger UI errors on stale refs elsewhere.
- Impact: Minor leak and stale fetch-after-unmount.
- Fix: Add `onUnmounted(() => { if (debounceTimer) clearTimeout(debounceTimer) })`.

### [MEDIUM] `ProjectTableRow` global document click listener can fire on other rows' open menus
- File: `web/Front/customapp/src/components/admin/ProjectTableRow.vue:125-127`
- Category: logic
- Evidence:
```ts
function closeMenu(): void { menuOpen.value = false }
onMounted(() => document.addEventListener('click', closeMenu))
onUnmounted(() => document.removeEventListener('click', closeMenu))
```
The listener is attached on every row. Clicking inside the teleported menu triggers `@click="menuOpen = false"` on the menu itself (line 87) before bubbling to document. OK. But opening the menu calls `openMenu` via a button `@click`; that click also bubbles to document → `closeMenu` is called → `menuOpen` is toggled to false. Because of Vue reactivity ordering it may appear to work, but the logic is fragile: the handler in `openMenu` sets `menuOpen = !menuOpen.value` AFTER the bubble reaches `closeMenu` if Vue's event handler order were to change. Also, every ProjectList row adds its own listener → O(n) document listeners for large pages.
- Impact: Flaky menu behavior, especially on mobile/touch where click ordering differs; memory pressure with 200+ rows (full page).
- Fix: Use a single app-level listener (composable `useClickOutside`), or stop propagation in `openMenu` (`event.stopPropagation()`). Also share one listener across rows via a singleton.

### [MEDIUM] `ActivitySection` auto-refresh `setInterval` keeps running while tab is hidden
- File: `web/Front/customapp/src/components/admin/sections/ActivitySection.vue:131-158`
- Category: perf
- Evidence:
```ts
const REFRESH_INTERVAL_MS = 60_000
...
onMounted(() => {
  void fetchAll()
  intervalId = setInterval(() => { void fetchAll() }, REFRESH_INTERVAL_MS)
})

onUnmounted(() => {
  if (intervalId !== null) {
    clearInterval(intervalId)
    intervalId = null
  }
})
```
Cleanup on unmount is correct, but the timer still ticks when the browser tab is in background — each tick fetches 200 activities + stats. No `visibilitychange` handler.
- Impact: Wasted bandwidth for admins who keep the tab open, wasted backend CPU on the 15-min-cached analytics endpoint, potential stale auth token issues for long-lived tabs.
- Fix: Pause the interval when `document.hidden` becomes true; resume on focus. Pattern also missing from `DashboardSection.vue` (no auto-refresh there, so moot).

### [MEDIUM] `AnalyticsSection` Chart.js instances are never explicitly destroyed; vue-chartjs handles it but no resize guard
- File: `web/Front/customapp/src/components/admin/sections/AnalyticsSection.vue:44-46, 91-93`
- Category: perf
- Evidence:
```vue
<div class="analytics__chart-box">
  <Bar :data="velocityChartData" :options="velocityChartOptions" />
</div>
...
<div class="analytics__chart-box analytics__chart-box--tall">
  <Bar :data="workloadChartData" :options="workloadChartOptions" />
</div>
```
`vue-chartjs` Bar component does destroy on unmount internally, so the main concern about memory leaks is mitigated. BUT: the chart `options` are `computed` and return new object identity on every store mutation — `responsive: true, maintainAspectRatio: false` — this causes Chart.js to re-render on every store dispatch, not only when data changes. With `store.loading` toggling on refresh, both charts recompute options twice per refresh.
- Impact: Jank on dashboards with fast polling; not a leak.
- Fix: Move `velocityChartOptions` and `workloadChartOptions` to plain `const` (they are static — none reference reactive data). Keep `velocityChartData` / `workloadChartData` computed.

### [MEDIUM] `PersonalDashboard` `NOW_MS` is frozen at module load; deadline calculation becomes stale for long-lived sessions
- File: `web/Front/customapp/src/components/admin/PersonalDashboard.vue:168-177, 185`
- Category: logic
- Evidence:
```ts
const NOW_MS = Date.now()
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000

const upcomingDeadlines = computed<ProjectSummary[]>(() =>
  myProjects.value.filter((p) => {
    if (!p.endDate) return false
    const diff = new Date(p.endDate).getTime() - NOW_MS
    return diff <= FOURTEEN_DAYS_MS
  }),
)
...
const isOverdue = (dateStr: string): boolean => new Date(dateStr).getTime() < NOW_MS
```
`NOW_MS` is captured once at script execution time (not mount). A dashboard left open overnight (or longer) will still classify yesterday's deadlines using yesterday's clock.
- Impact: "Upcoming" list becomes inaccurate by 24 h+, overdue badges do not flip even after the deadline passes.
- Fix: Move `NOW_MS = Date.now()` inside the computed, or track with a `ref` that is refreshed on an interval or visibility-change.

### [MEDIUM] `PersonalDashboard` decodes JWT client-side and trusts `given_name`/`family_name` for display
- File: `web/Front/customapp/src/components/admin/PersonalDashboard.vue:145-153`
- Category: logic
- Evidence:
```ts
const displayName = computed<string>(() => {
  if (!authStore.jwt) return 'Utilisateur'
  try {
    const p = JSON.parse(atob(authStore.jwt.split('.')[1]))
    return [p.given_name, p.family_name].filter(Boolean).join(' ') || 'Utilisateur'
  } catch {
    return 'Utilisateur'
  }
})
```
- Impact: (a) Duplicates logic that likely exists in `authStore.currentUser` — single source of truth violation. (b) `atob` fails on base64url tokens containing `-` or `_` (the JWT alphabet) — Node-style base64url tokens silently fall into the catch and the user sees "Utilisateur" even when authenticated. (c) No sanitization of the decoded name before rendering. Vue auto-escapes text interpolation so it is not an XSS, but a malicious JWT issuer could still inject confusing unicode.
- Fix: Read first/last name from `authStore.currentUser` (the store likely already holds the profile). Remove the `atob` decode entirely.

### [MEDIUM] `DashboardSection` `statusSeverity` function is defined but never used (dead code)
- File: `web/Front/customapp/src/components/admin/sections/DashboardSection.vue:316-317`
- Category: logic
- Evidence:
```ts
const statusSeverity = (s: ProjectStatus) =>
  PROJECT_STATUS_SEVERITY[s] as 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast'
```
- Impact: Dead code + lint warning surface. Same pattern appears in `ProjectList.vue` (imports `PROJECT_STATUS_SEVERITY` but only passes to `ProjectTableRow` which defines its own `statusBadgeClass`).
- Fix: Delete unused helper.

### [MEDIUM] `ProjectManagementSection` CSV export leaks special chars and does not escape newlines
- File: `web/Front/customapp/src/components/admin/sections/ProjectManagementSection.vue:364-385`
- Category: logic
- Evidence:
```ts
const rows = store.projects.map((p) => [
  p.name,
  p.clientName,
  ...
])
const csv = [headers, ...rows]
  .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
  .join('\n')
```
- Impact: Newlines inside `p.name` or `p.clientName` (possible for client-supplied strings) will break the CSV row boundary. Excel will happily import a multi-line CSV cell if quoted — that part is OK — but the `.join('\n')` for row separation collides with embedded newlines because Excel also treats `\n` within a quoted cell as a line break. Minor; typical CSV behavior.
- Fix: Use `\r\n` as row separator (Excel canonical), and strip control chars from cell values.

### [MEDIUM] `ProjectDetailPanel` `activeTab === 'fields'` uses `v-show` so all field content stays in DOM even when on other tabs
- File: `web/Front/customapp/src/components/admin/ProjectDetailPanel.vue:54, 76`
- Category: perf
- Evidence:
```vue
<div v-show="activeTab === 'fields'" class="meta-card">
  ...
<div v-show="activeTab === 'fields'" class="fields-card">
```
Other tabs use `v-if` (lines 173, 178, 183). Inconsistent: `v-show` keeps the entire Questionnaire form (including NeoInputText with local state in `newField`) mounted when the user is on portal/activity/validations tabs.
- Impact: Unnecessary DOM weight, especially with many fields; also means any watchers/focus inside the field form remain active.
- Fix: Use `v-if` uniformly for tab panels, or document intentionally why Questionnaire needs to persist.

### [MEDIUM] `AssignManagerDialog` does not handle Escape key or focus-trap
- File: `web/Front/customapp/src/components/admin/AssignManagerDialog.vue:9-45`
- Category: UX
- Evidence:
```vue
<div v-if="visible" class="dialog-overlay" @click.self="emit('close')">
```
No `role="dialog"`, no `aria-modal`, no focus management, no Escape listener. The `UserFormDialog.vue` at least adds `role="dialog" aria-modal="true"` (line 11), but both dialogs lack Escape-to-close and focus-trap.
- Impact: Accessibility failure (WCAG 2.4.3 / ARIA authoring practices), keyboard users cannot dismiss, and after tab-ing through to end of dialog focus escapes to background.
- Fix: Add `@keydown.esc="emit('close')"` on the panel; when opened, focus first input; use a focus-trap helper or use `<dialog>` element.

### [MEDIUM] `TrashSection` + `ProjectManagementSection` do NOT `await` `useNeoConfirm().require`, which matches CLAUDE.md — but their `accept:` callbacks race with the store's `error` ref
- File: `web/Front/customapp/src/components/admin/TrashSection.vue:130-137, 148-156`
- Category: logic
- Evidence:
```ts
accept: async () => {
  await store.restoreProject(id)
  if (!store.error) {
    toast.add({ severity: 'success', detail: `Projet « ${name} » restauré.`, life: 3000 })
  } else {
    toast.add({ severity: 'error', detail: store.error, life: 4000 })
  }
},
```
If two `confirm.require` calls open (rapid click on Restore/Purge, or calls across stores), the shared `store.error` ref may belong to a different operation by the time this `accept` reads it.
- Impact: Wrong toast shown. Low probability but real.
- Fix: Have the store action return a `Result.ok / Result.fail`-like value so the caller doesn't have to read post-hoc state.

### [LOW] `LogsSection` renders raw log lines with `v-for` + text interpolation (no XSS but no filtering of ANSI color codes)
- File: `web/Front/customapp/src/components/admin/sections/LogsSection.vue:31-33`
- Category: UX
- Evidence:
```vue
<div v-for="(line, i) in lines" :key="i" :class="['log-line', levelClass(line)]">
  {{ line }}
</div>
```
No XSS risk (text interpolation escapes). But ANSI escape sequences (`\x1B[...]m`) and long unbroken tokens are rendered literally, harming readability; `levelClass` relies on literal `[ERROR]` substring, failing for JSON-formatted logs or logs emitted by structured loggers.
- Impact: Level colors may be wrong for Nest/Winston logs.
- Fix: Parse log levels with a stricter regex; strip ANSI before display. Consider virtualization for 200+ lines to avoid rendering cost.

### [LOW] `PortalTokenTable.formatDate` throws on invalid ISO without fallback
- File: `web/Front/customapp/src/components/admin/PortalTokenTable.vue:96-102`
- Category: logic
- Evidence:
```ts
function formatDate(d: string | Date): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(d))
}
```
- Impact: `new Date('not-a-date')` → `Invalid Date` → `Intl.DateTimeFormat.format(Invalid Date)` throws on some browsers (Safari) or returns `"Invalid Date"` string. Backend should always return valid ISO, but no guard.
- Fix: Return `'—'` on `Number.isNaN(d.getTime())`.

### [LOW] `PortalTokenManager.buildFullUrl` uses `window.location.origin` — works in prod but fails if component ever rendered SSR
- File: `web/Front/customapp/src/components/admin/PortalTokenManager.vue:128-130`
- Category: types
- Evidence:
```ts
function buildFullUrl(token: string): string {
  return `${window.location.origin}/portal/${token}`
}
```
- Impact: SPA-only context — acceptable today. Note for future if SSR is adopted.
- Fix: Read origin from config store (`configStore.publicOrigin`) if set.

### [LOW] `UserList.onMounted(() => store.fetchAll())` double-fetches when `UserManagementSection` already fetches
- File: `web/Front/customapp/src/components/admin/UserList.vue:151`
- Category: perf
- Evidence:
```ts
onMounted(() => store.fetchAll())
```
`UserManagementSection.vue` binds `:users="filteredUsers"` (line 73) where `filteredUsers` filters `userStore.users` — user-store is populated externally. `UserList` still triggers its own fetch on mount.
- Impact: Duplicate `/admin/users` request on every mount.
- Fix: Gate with `if (store.users.length === 0) store.fetchAll()`, or move the fetch to the parent section exclusively.

### [LOW] `SystemStatusSection.load` swallows errors silently; no user-facing error state
- File: `web/Front/customapp/src/components/admin/sections/SystemStatusSection.vue:93-101`
- Category: UX
- Evidence:
```ts
const load = async () => {
  loading.value = true
  try {
    const { data } = await api.get<SystemStatus>('/admin/SystemStatus')
    status.value = data
  } finally {
    loading.value = false
  }
}
```
No `catch`. If `/admin/SystemStatus` fails, user sees indefinite loading-spinner → empty card silently. No error template branch exists.
- Impact: Silent failure. Admin wastes time diagnosing.
- Fix: Add `catch` that sets an error ref and renders a `NeoMessage severity="error"`.

### [LOW] `ActivitySection` `filterAction === null` check assumes filter is exactly `null` — but the select binds `''` initially for "Tous"
- File: `web/Front/customapp/src/components/admin/sections/ActivitySection.vue:67-68, 141-142, 217-222`
- Category: logic
- Evidence:
```ts
const filterAction  = ref<string | null>(null)
const filterProject = ref<string | null>(null)
...
:disabled="filterAction === null && filterProject === null"
...
const filteredItems = computed<ProjectActivity[]>(() => {
  return activities.value.filter((a) => {
    if (filterAction.value !== null && a.action !== filterAction.value) return false
    if (filterProject.value !== null && a.projectId !== filterProject.value) return false
    return true
  })
})
```
The select's `placeholder` is used instead of an explicit "all" option. If NeoSelect ever emits `''` instead of `null` on clear (per PrimeVue convention), the filter will check `'' !== null` → true → filter against empty string → always falsey → empty list.
- Impact: Filter clears may not visually clear depending on NeoSelect's clear-behavior.
- Fix: Also handle `''` as "no filter"; or supply an explicit `{label: 'Tous', value: null}` option.

### [LOW] `ProjectManagementSection` shows raw HTML color inline styles in template instead of class
- File: `web/Front/customapp/src/components/admin/sections/ProjectManagementSection.vue:157-162, 191-196`
- Category: UX
- Evidence:
```vue
<span
  v-if="isNearDeadline(p)"
  title="Échéance dans moins de 7 jours"
  style="color:#f59e0b;margin-left:4px"
>
  <i class="pi pi-exclamation-triangle" />
</span>
```
- Impact: Breaks dark-mode theming (`#f59e0b` literal); also bypasses the design-token system (`var(--nl-warning)`).
- Fix: Replace with a utility class and use `var(--nl-warning)`.

### [LOW] Inline styles in `ProjectDetailPanel` Dialog body hardcode colors (break dark mode)
- File: `web/Front/customapp/src/components/admin/ProjectDetailPanel.vue:189, 196, 199, 200`
- Category: UX
- Evidence:
```vue
<div v-if="store.templates.length === 0" style="padding: 1rem; color: #6b7280; text-align:center;">
  Aucun modèle disponible.
</div>
<div v-else style="display:flex;flex-direction:column;gap:0.75rem;padding:0.5rem 0">
  <div
    v-for="tpl in store.templates"
    :key="tpl.id"
    style="display:flex;align-items:center;justify-content:space-between;padding:0.75rem;border:1px solid #e5e7eb;border-radius:8px"
  >
    <div>
      <div style="font-weight:600;font-size:0.875rem;color:#111827">{{ tpl.name }}</div>
```
- Impact: Template-picker dialog is illegible in dark mode (`#111827` black text on dark surface).
- Fix: Move to `<style scoped>` with design tokens (`var(--nl-text-1)`, `var(--nl-border)`).

### [LOW] `TemplatesSection` imports `Checkbox` from primevue but never renders it
- File: `web/Front/customapp/src/components/admin/sections/TemplatesSection.vue:124`
- Category: logic
- Evidence:
```ts
import Checkbox from 'primevue/checkbox'
```
No `<Checkbox>` element appears in the template; the `FieldRow.isRequired` property is present on the interface but never surfaced to the user (the "required" checkbox was presumably intended for each field row but is missing).
- Impact: Dead import + missing functionality (user cannot mark a template field required even though the data model supports it).
- Fix: Either render the checkbox in `.field-row` or drop the unused import and `isRequired` field.

### [LOW] `TemplatesSection` `formatDate` is missing hour/minute despite stored as full timestamp
- File: `web/Front/customapp/src/components/admin/sections/TemplatesSection.vue:177-179`
- Category: UX
- Evidence:
```ts
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR')
}
```
And column header (line 27) "Créé le". The project uses `@/lib/formatDate.ts` elsewhere per CLAUDE.md — this component re-implements its own.
- Impact: Inconsistent date formatting across the admin area.
- Fix: Import `formatDateShort` from `@/lib/formatDate`.

### [LOW] `AnalyticsSection` hardcoded chart colors ignore dark-mode tokens
- File: `web/Front/customapp/src/components/admin/sections/AnalyticsSection.vue:124-127, 166-174, 192-199`
- Category: UX
- Evidence:
```ts
const CHART_PRIMARY = '#0F62FE'
const CHART_DANGER  = '#DC2626'
const CHART_SUCCESS = '#16A34A'
const CHART_GRID    = 'rgba(0, 0, 0, 0.04)'
...
title: { display: true, text: 'Jours', color: '#71717A', font: { size: 11 } },
...
labels: { boxWidth: 12, font: { size: 11 }, color: '#3F3F46' },
```
Grid and axis colors are hex literals. In dark mode the `rgba(0,0,0,0.04)` grid lines are invisible on dark background, and text color `#3F3F46` (light zinc) becomes near-black-on-black.
- Impact: Unreadable charts in dark mode.
- Fix: Read tokens via `getComputedStyle(document.documentElement).getPropertyValue('--nl-text-3')` in a watcher tied to the theme, or accept theme as a prop.

### [LOW] `ProjectBulkToolbar` emits are silent when `localStatus` / `localManager` are falsy — no user feedback
- File: `web/Front/customapp/src/components/admin/ProjectBulkToolbar.vue:91-101`
- Category: UX
- Evidence:
```ts
function emitStatus(): void {
  if (!localStatus.value) return
  emit('set-status', localStatus.value)
  localStatus.value = ''
}
```
If the user somehow triggers the button with no selection (e.g., keyboard Enter), the function no-ops silently. Button's `:disabled="!localStatus"` already handles this via UI — so the guard is belt-and-braces — but inconsistent UX.
- Impact: Negligible; defensive check.
- Fix: Remove the early-return since the `:disabled` attribute already prevents it, or raise a toast.

### [LOW] `AssignManagerDialog` select label passes `email` into the option label — PII exposure in dropdown
- File: `web/Front/customapp/src/components/admin/AssignManagerDialog.vue:75-80`
- Category: UX
- Evidence:
```ts
const pmOptions = computed(() =>
  userStore.projectManagers.map((u) => ({
    value: u.id,
    label: `${u.firstName} ${u.lastName} — ${u.email}`,
  })),
)
```
- Impact: Minor — admins already see emails elsewhere, but inside a select dropdown next to a client-facing project name creates potential for screen-recording leakage. Also clutters dropdown on long domain names.
- Fix: Consider `${firstName} ${lastName}` as primary label and email as secondary (NeoSelect option template if supported).

### [LOW] `UserFormDialog` modal does not close on Escape or body scroll lock
- File: `web/Front/customapp/src/components/admin/UserFormDialog.vue:9`
- Category: UX
- Evidence:
```vue
<div v-if="visible" class="modal-scrim" @mousedown.self="emit('close')">
```
No `@keydown.esc`, no body-scroll lock (user can scroll the background while modal is open).
- Impact: A11y / UX.
- Fix: Add Escape listener; toggle `document.body.style.overflow = 'hidden'` while visible.

### [LOW] `UserFormDialog` `errors` delete loop uses `as keyof typeof errors` but `errors` is typed as Partial — possible TS issue with stricter configs
- File: `web/Front/customapp/src/components/admin/UserFormDialog.vue:144, 150`
- Category: types
- Evidence:
```ts
Object.keys(errors).forEach((k) => delete errors[k as keyof typeof errors])
```
- Impact: Minor — works, but `Object.keys(errors)` returns `string[]`, cast is safe only because `errors` is reactive-proxy-backed.
- Fix: Replace with `for (const k of Object.keys(errors) as (keyof typeof errors)[]) delete errors[k]`.

### [UNCERTAIN] `ProjectDetailPanel` nested `<Dialog>` inside detail view without portal-wrapped z-index management
- File: `web/Front/customapp/src/components/admin/ProjectDetailPanel.vue:188-206`
- Category: UX
- Evidence:
```vue
<Dialog v-model:visible="showTemplateDialog" header="Appliquer un modèle" :modal="true" style="width: 480px">
```
PrimeVue Dialog auto-teleports; OK. But if `ProjectDetailPanel` is itself inside `UserFormDialog`'s z-stacking sibling, layering may conflict with `UserFormDialog`'s custom z-index 9600. [UNCERTAIN — need to observe running UI.]
- Fix: If stacking bugs appear, pass explicit `:pt="{ root: { style: { zIndex: 9700 } } }"` or use the custom `AppModal`.

### [UNCERTAIN] `ProjectManagementSection` inline `<Dialog>` (primevue) is used while CLAUDE.md deprecated NeoDialog; mixed dialog strategy
- File: `web/Front/customapp/src/components/admin/sections/ProjectManagementSection.vue:238-266`
- Category: neolibrary
- Evidence:
```vue
<Dialog
  v-model:visible="showDuplicate"
  header="Dupliquer le projet"
  :modal="true"
  style="width: 420px"
>
```
CLAUDE.md says: "AppModal.vue — Teleport-based modal (replacement for deprecated NeoDialog)". Same pattern appears in `TemplatesSection.vue:59, 92`, `UserManagementSection.vue:98`, `ProjectDetailPanel.vue:188`. Only `UserFormDialog.vue` uses the new modal pattern.
- Impact: Migration is incomplete. Styling will diverge between pages.
- Fix: Migrate all admin dialogs to `AppModal.vue`.

### [UNCERTAIN] `useNeoConfirm().require` usage returns void per CLAUDE.md — all admin callers use `accept` callback correctly
- File: multiple — `TrashSection.vue:124`, `ProjectManagementSection.vue:193, 484, 498, 511-530`, `TemplatesSection.vue:210`, `ProjectDetailPanel.vue:334`, `ProjectList.vue:193`
- Category: neolibrary
- Evidence: All callers use `accept: async () => {...}` pattern; none `await confirm.require(...)`.
- Impact: Conforms to CLAUDE.md.
- Fix: None needed — noted as a positive finding (contrast to other sections that may misuse it).

---

## Summary

- CRITICAL: 0
- HIGH: 5 (NeoTag `"warn"` vs `"warning"` spread across ~10 sites; Admin-role escalation UX gap; weak password policy; composable internals poked from template; plaintext password on screen)
- MEDIUM: 12
- LOW: 12
- UNCERTAIN: 3

Cross-cutting themes:
1. `"warn"` vs `"warning"` NeoTag/NeoButton severity mismatch: 10+ sites; fix project-wide.
2. Dialog inconsistency: PrimeVue `<Dialog>` still used in 4+ components despite `AppModal.vue` being the documented replacement.
3. Accessibility gaps: no Escape, no focus-trap, no scroll-lock on custom modals/dialogs.
4. Frozen `Date.now()` / stale time references in dashboard computeds.
5. Dark-mode readability: several components embed hex colors in inline `style=` attributes or chart options.
