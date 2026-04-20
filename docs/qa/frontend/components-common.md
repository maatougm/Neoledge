# Frontend QA — Common / Shared Components

Files opened:
- `web/Front/customapp/src/components/common/AppModal.vue`
- `web/Front/customapp/src/components/common/AppSearchModal.vue`
- `web/Front/customapp/src/components/common/AppSkeleton.vue`
- `web/Front/customapp/src/components/common/KeyboardHelpDialog.vue`
- `web/Front/customapp/src/components/common/ModulePageHeader.vue`
- `web/Front/customapp/src/components/common/PresenceAvatars.vue`
- `web/Front/customapp/src/components/common/PriorityDot.vue`
- `web/Front/customapp/src/components/common/ProjectBreadcrumbs.vue`
- `web/Front/customapp/src/components/common/ProjectModuleShell.vue`
- `web/Front/customapp/src/components/common/SplitPanel.vue`
- `web/Front/customapp/src/components/common/StatCard.vue`
- `web/Front/customapp/src/components/common/StatusChip.vue`
- `web/Front/customapp/src/components/common/TableSkeleton.vue`
- `web/Front/customapp/src/components/common/WpStatusTag.vue`
- `web/Front/customapp/src/components/meetings/MeetingExtrasTabs.vue`
- `web/Front/customapp/src/components/filters/FilterBuilder.vue`
- `web/Front/customapp/src/components/filters/SavedFiltersPanel.vue`
- `web/Front/customapp/src/components/Anomalies.vue`
- `web/Front/customapp/src/components/ChangePasswordDialog.vue`
- `web/Front/customapp/src/components/ErrorBoundary.vue`
- `web/Front/customapp/src/components/Loader.vue`
- `web/Front/customapp/src/components/NotificationBell.vue`

Corroborating evidence files opened:
- `web/Front/customapp/src/types/project.types.ts`
- `web/Front/customapp/src/types/filter.types.ts`
- `web/Front/customapp/src/composables/useCollaborationSocket.ts`
- `web/Front/customapp/src/composables/useKeyboardShortcuts.ts` (grep)
- `web/Front/customapp/src/stores/notificationStore.ts` (grep)
- `web/back-nest/prisma/schema.prisma` (grep for enums)
- `web/Front/customapp/src/layouts/AppShell.vue` (grep)
- `web/Front/customapp/CLAUDE.md` NeoLibrary constraints (from project CLAUDE.md)

---

## CRITICAL

### [CRITICAL] `AppModal` has no `<body>` scroll-lock
- File: `web/Front/customapp/src/components/common/AppModal.vue:2-22`
- Category: UX / a11y
- Evidence:
```vue
<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="visible" class="modal-scrim" @mousedown.self="close">
        <div class="modal-box" :style="{ width: width || '480px' }" role="dialog" aria-modal="true">
```
No `document.body.style.overflow = 'hidden'` or equivalent during `v-if="visible"`. The scrim is `position: fixed; inset: 0` (line 50-51), but the underlying page remains scrollable with wheel/trackpad/keyboard since body is not locked.
- Impact: Mobile and desktop users can scroll the underlying page while modal is open. On stacked modals (e.g. `KeyboardHelpDialog` + nested dialog) keystrokes can reach the underlying document. Breaks WAI-ARIA modal expectation.
- Fix: In `watch(() => props.visible)`, toggle `document.body.style.overflow` and restore on close/unmount. Cleanup must also fire in `onUnmounted` for the case where the component unmounts while `visible=true`.

### [CRITICAL] `AppModal` has no focus trap and no initial focus
- File: `web/Front/customapp/src/components/common/AppModal.vue:2-46`
- Category: a11y
- Evidence:
```vue
<div class="modal-box" :style="{ width: width || '480px' }" role="dialog" aria-modal="true">
```
No `ref`, no `onMounted`-driven `focus()`, no Tab/Shift-Tab cycling, no `:aria-labelledby`. The modal is marked `role="dialog" aria-modal="true"` but the underlying page's focus order remains active — Tab can move into the background.
- Impact: Screen-reader / keyboard users cannot reliably operate the dialog; focus can escape to the page behind (failing WCAG 2.4.3 & 2.1.2). Label "Fermer" button only — no dialog-title association.
- Fix: Add `ref` on `.modal-box`; on `visible` → true, `await nextTick()` then focus first focusable descendant; wire a keydown handler that cycles Tab/Shift+Tab inside the box; emit `update:visible` on Escape (already done). Also wire `aria-labelledby` to the `.modal-title` element's id.

### [CRITICAL] `PresenceAvatars` — avatar color pulled directly from socket payload, no sanitisation
- File: `web/Front/customapp/src/components/common/PresenceAvatars.vue:6-10`
- Category: xss (CSS-injection via inline style)
- Evidence:
```vue
<div
  v-for="user in visibleUsers"
  :key="user.userId"
  class="avatar"
  :style="{ background: user.color }"
  :title="user.name"
  :aria-label="user.name"
>
```
`PresenceUser.color` is typed as `string` (see `useCollaborationSocket.ts:12-17`). The type guard `isPresenceUser` (line 28-36) only checks `typeof === 'string'` — it does NOT validate that the color is a safe CSS color token.
- Impact: A malicious collaborator (or a compromised server) can inject arbitrary CSS via `background`, e.g. `red; position:fixed; inset:0; z-index:99999`, effectively obscuring the whole UI. While Vue sets inline style via `element.style` (which rejects `javascript:` URLs), CSS property values like `background: url('https://evil.com/beacon.png')` still leak IP/CSRF tokens via cookies. Also applies to `StatusChip.vue` line 3 (`:style="{ color, background, borderColor: color + '33' }"`) where `color`/`background` are static but the pattern is duplicated elsewhere.
- Fix: Whitelist colors to a fixed palette (hex `#RRGGBB`), or regex-validate `^#[0-9a-f]{6}$` before binding. Same treatment for any user-supplied CSS value on the client.

---

## HIGH

### [HIGH] `AppModal` z-index conflict with PrimeVue inner overlays
- File: `web/Front/customapp/src/components/common/AppModal.vue:56-62`
- Category: UX / logic
- Evidence:
```css
  /* Stack order:
       Sidebar/Topbar: 100 · Row menus, UserMenu, NotificationPanel: 9500
       AppModal (us): 9600 · Cmd-K: 9800 · PrimeVue overlays: 10000
     A modal must cover dropdowns but still allow its own inner Selects/Datepickers
     to teleport above it. */
  z-index: 9600;
```
The comment documents the intent, but there is no same-file guarantee. The Cmd-K palette (`AppSearchModal.vue:239`, `z-index: 9800`) is *above* `AppModal`. If Cmd-K opens while a plain modal is already visible (e.g. user hits Ctrl+K while a modal is open), the Cmd-K surface paints over the modal but the modal's Escape listener (AppModal.vue:40-43) is still attached globally — both receive Escape and the top one closes first (Cmd-K), leaving the modal still open. This is the documented intent, but:
- Impact: If the palette is triggered while a modal is open, subsequent Esc closes the palette — fine — but the underlying modal never traps focus, so Tab from the palette can land in background content. More importantly the keydown listeners on both stack; the order of resolution depends on attachment order (see next finding).
- Fix: Introduce a small z-index/keystroke manager (last-opened-wins). Document and test the Ctrl+K-while-modal-open path.

### [HIGH] `AppModal` keydown listener not stacked-aware — multiple modals close in wrong order
- File: `web/Front/customapp/src/components/common/AppModal.vue:35-43`
- Category: logic
- Evidence:
```ts
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}

// Attach a keyboard listener only while the modal is visible, so Escape closes it.
watch(() => props.visible, (v) => {
  if (v) window.addEventListener('keydown', onKeydown)
  else window.removeEventListener('keydown', onKeydown)
}, { immediate: true })
```
Every open `AppModal` adds its own `keydown` listener on `window`. Multiple simultaneously open modals all fire `close()` on a single Esc keystroke — all of them close at once, instead of top-first.
- Impact: `KeyboardHelpDialog` wraps `AppModal` (line 3: `<AppModal v-model:visible="visibleModel" ...>`), and if another `AppModal` is also open (e.g., a future confirmation dialog), Esc closes both. The inner `e.stopPropagation()` is absent.
- Fix: Either use `addEventListener('keydown', handler, { once: false, capture: true })` with a small top-of-stack registry, or record an `id` in a shared ref and have only the most-recently-mounted modal respond.

### [HIGH] `AppSearchModal` `onInput` does not reset `selIdx` — stale selection + no ARIA role for listbox
- File: `web/Front/customapp/src/components/common/AppSearchModal.vue:10-53,119-123`
- Category: a11y / logic
- Evidence:
```vue
<input
  ref="inputRef"
  v-model="query"
  class="cmdk-input"
  ...
  @input="onInput"
  @keydown.down.prevent="moveSel(1)"
  @keydown.up.prevent="moveSel(-1)"
  @keydown.enter.prevent="openSelected"
  @keydown.esc="close"
/>
```
```ts
function onInput(): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (query.value.trim().length < 2) { searchHits.value = []; return }
  debounceTimer = setTimeout(runServerSearch, 180)
}
```
No `selIdx.value = 0` in `onInput`. When the user types, `flatItems` shrinks/grows but `selIdx` keeps its old index. `moveSel` (line 213-217) wraps modulo length, but Enter (`openSelected`, line 219-222) uses `flatItems.value[selIdx.value]` which can point to an item that shifted under the cursor.

Also the list has no `role="listbox"` / `role="option"` / `aria-activedescendant` — only `role="dialog"`. The active option cannot be announced by a screen reader.
- Impact: Keyboard users can accidentally open the wrong result after typing. Screen-reader users cannot discover the cursored item.
- Fix: Reset `selIdx.value = 0` in `onInput` and `runServerSearch`. Add `role="listbox"` on the results container, `role="option"` + `id="cmdk-option-${idx}"` on each `<li>`, and `aria-activedescendant` on the input bound to the currently selected option's id.

### [HIGH] `AppSearchModal` debounce timer is never cleared on unmount / close
- File: `web/Front/customapp/src/components/common/AppSearchModal.vue:103,105-115,119-123`
- Category: memory-leak / logic
- Evidence:
```ts
let debounceTimer: ReturnType<typeof setTimeout> | null = null

watch(() => props.visible, async (v) => {
  if (v) {
    await nextTick()
    inputRef.value?.focus()
    inputRef.value?.select()
  } else {
    query.value = ''
    searchHits.value = []
    selIdx.value = 0
  }
})
```
When the user closes the palette while a debounce is pending, `setTimeout` fires ~180 ms later and calls `runServerSearch` → does a network request and writes `searchHits.value`. No `onUnmounted`/close handler clears `debounceTimer`.
- Impact: Wasted request after palette close; `searchHits` is mutated while palette is closed — next open momentarily shows stale results before the reset watcher runs. Also potential memory leak on HMR.
- Fix: Add `onUnmounted(() => { if (debounceTimer) clearTimeout(debounceTimer) })`. Also clear in the `else` branch of the visible watcher.

### [HIGH] `AppSearchModal` — `/api/search` path mismatch with backend
- File: `web/Front/customapp/src/components/common/AppSearchModal.vue:129`
- Category: logic
- Evidence:
```ts
const { data } = await api.get<SearchHit[]>(`/api/search?q=${encodeURIComponent(query.value)}`)
```
Per project `CLAUDE.md` the NestJS routes use the prefix `/pm/projects/...`, `/admin/...`, `/api/analytics/...`, `/api/time-entries/...`. There is no `/api/search` route documented in the Routes section. I did NOT find it in the backend during this scan, but I did not grep exhaustively — `[UNCERTAIN]` on whether the endpoint exists.
- Impact: If the endpoint does not exist, every Ctrl+K search returns 404 and the `catch` block silently swallows the error (`searchHits.value = []`, line 140). Users see "Aucun résultat." instead of a useful message.
- Fix: Verify the endpoint exists; if missing, implement it. Surface non-404 errors via a toast.

### [HIGH] `ProjectBreadcrumbs` — `projectName` shown stale between projectId changes
- File: `web/Front/customapp/src/components/common/ProjectBreadcrumbs.vue:28-62`
- Category: UX / logic
- Evidence:
```ts
const props = defineProps<{ projectId: string }>()
const route = useRoute()
const projectName = ref<string>('')
...
async function loadProject() {
  try {
    const { data } = await api.get<{ name: string }>(`/pm/projects/${props.projectId}`)
    projectName.value = data.name
  } catch {
    projectName.value = ''
  }
}

watch(() => props.projectId, loadProject)
onMounted(loadProject)
```
When `projectId` changes, `loadProject` is invoked but `projectName.value` is **not reset** before the network request. The breadcrumb renders the previous project's name for the duration of the fetch (100-300 ms).

Also two requests-in-flight can race: user navigates A→B→A, if A's second fetch resolves after B's, the breadcrumb shows A while the page shows B. No abort controller.

Re: the "cross-project cache leak when cached breadcrumb rendered" concern in the prompt — this component does NOT use a module-level cache; each instance holds its own `projectName` ref. `[UNCERTAIN]` about any external cache; none was observed in this file.
- Impact: User sees wrong project name during fast navigation; perceived as a bug.
- Fix: Reset `projectName.value = ''` at the top of `loadProject()` before the request; use an `AbortController` + increment-tag to discard stale responses.

### [HIGH] `NotificationBell` — unread counter race on rapid reads
- File: `web/Front/customapp/src/components/NotificationBell.vue:86-101,123-126`
- Category: logic
- Evidence:
```ts
const unreadCount = computed(() => store.unreadCount)

const recentNotifications = computed(() =>
  [...store.notifications]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, MAX_VISIBLE),
)
...
async function handleMarkAsRead(id: string, alreadyRead: boolean): Promise<void> {
  if (alreadyRead) return
  await store.markAsRead(id)
}
```
Clicking three unread notifications in quick succession fires three `await store.markAsRead` in parallel. Per `notificationStore.ts:24` `unreadCount` is derived from `notifications.value.filter(...)`. If the store's `markAsRead` is not fully atomic (mutates item.isRead optimistically but awaits API), parallel calls can produce an intermediate count inconsistent with the server. Same issue in `handleRemove` (line 132-134).
- Impact: Badge flickers or displays wrong transient count.
- Fix: Serialize calls (queue) or flip `isRead` optimistically BEFORE `await`. Also `handleMarkAllAsRead` should short-circuit if `unreadCount.value === 0`.

### [HIGH] `NotificationBell` — dropdown closes on outside click but not on Escape; no `aria-expanded` updates the `role="dialog"` surface's focus
- File: `web/Front/customapp/src/components/NotificationBell.vue:22-23,138-150`
- Category: a11y
- Evidence:
```vue
<!-- Dropdown panel -->
<div v-if="open" class="notif-panel" role="dialog" aria-label="Notifications">
```
```ts
function onDocumentClick(event: MouseEvent): void {
  if (wrapRef.value && !wrapRef.value.contains(event.target as Node)) {
    open.value = false
  }
}

onMounted(() => {
  document.addEventListener('mousedown', onDocumentClick)
})

onUnmounted(() => {
  document.removeEventListener('mousedown', onDocumentClick)
})
```
No `keydown` listener for Escape. `role="dialog"` declared but focus is not moved into the panel on open, and nothing restores focus to the bell button on close — both WAI-ARIA Authoring Practices requirements for a dialog.
- Impact: Keyboard users can open the panel but cannot dismiss with Esc; focus is lost.
- Fix: Either downgrade to `role="menu"` / `role="region"` (more appropriate for a notification list) or implement full dialog semantics (Esc close, focus move, focus return). Add `@keydown.esc` on `wrapRef` or global listener while `open`.

### [HIGH] `NeoTag` severity mismatch — `FilterBuilder` falls back to `'secondary'` for High priority
- File: `web/Front/customapp/src/components/filters/FilterBuilder.vue:74-82,133-138` + `src/types/filter.types.ts:33-38`
- Category: neolibrary / logic
- Evidence (`filter.types.ts`):
```ts
export const PRIORITY_SEVERITY: Record<Priority, string> = {
  Low: 'secondary',
  Medium: 'info',
  High: 'warning',
  Critical: 'danger',
}
```
Evidence (`FilterBuilder.vue`):
```ts
type NeoTagSeverity = 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' | 'primary'
const VALID_SEVERITIES = new Set<string>(['success', 'info', 'warn', 'danger', 'secondary', 'contrast', 'primary'])
function toTagSeverity(val: string | undefined): NeoTagSeverity {
  return (val !== undefined && VALID_SEVERITIES.has(val) ? val : 'secondary') as NeoTagSeverity
}
```
`PRIORITY_SEVERITY.High === 'warning'` but the whitelist contains `'warn'` (not `'warning'`). Per project CLAUDE.md the accepted values for `NeoTag.severity` are `"success" | "info" | "warning" | "danger" | "secondary" | "contrast"`. Note the mismatch is *across* files: project CLAUDE.md says `"warning"`, but the `FilterBuilder`/`SavedFiltersPanel`/`WpStatusTag`/`ProjectModuleShell` TypeScript types say `"warn"`. `[UNCERTAIN]` which is correct at the NeoLibrary runtime — but whichever it is, High priority chips currently render as `secondary` (fallback) because the whitelist rejects `'warning'`.
- Impact: Priority chips mis-colored; priority filter and priority tag have inconsistent visuals.
- Fix: Pick one canonical string (`'warn'` or `'warning'`) and align: the TS `Severity` union on `NeoTag`, `PRIORITY_SEVERITY`, `WpStatusTag` `severity` computed, and project CLAUDE.md.

### [HIGH] `SavedFiltersPanel` — uses primevue `Dialog` directly, contradicting project CLAUDE.md
- File: `web/Front/customapp/src/components/filters/SavedFiltersPanel.vue:96-155,169`
- Category: neolibrary
- Evidence:
```ts
import Dialog from 'primevue/dialog'
```
```vue
<Dialog
  v-model:visible="showSaveDialog"
  header="Sauvegarder le filtre"
  modal
  :style="{ width: '22rem' }"
>
```
Project `CLAUDE.md` documents `AppModal.vue` as "replacement for deprecated NeoDialog" and recent commit `d4b5258` says "replace primevue Dialog with custom modal in UserFormDialog". Using raw `primevue/dialog` here regresses the policy. `ChangePasswordDialog.vue:2-8,51` has the same issue.
- Impact: Visual/UX inconsistency with the rest of the app; the PrimeVue dialog doesn't honour the project's z-index ladder (comment in `AppModal.vue:56-61` puts PrimeVue at 10000 which is *above* Cmd-K, meaning PrimeVue dialog renders on top of everything including search palette — possibly intended, but inconsistent with `AppModal` patterns).
- Fix: Replace both with `AppModal`.

### [HIGH] `SavedFiltersPanel.confirmDelete` deletes without confirmation, despite method name
- File: `web/Front/customapp/src/components/filters/SavedFiltersPanel.vue:271-278`
- Category: UX / logic
- Evidence:
```ts
const confirmDelete = async (filter: SavedFilter): Promise<void> => {
  await store.remove(filter.id)
  if (!store.error) {
    toast.add({ severity: 'success', detail: `Filtre "${filter.name}" supprimé.`, life: 3000 })
  } else {
    toast.add({ severity: 'error', detail: store.error, life: 4000 })
  }
}
```
Function name implies a confirm step but the delete fires immediately on click (line 89: `@click="confirmDelete(filter)"`).
- Impact: Accidental deletion of saved filters with no undo.
- Fix: Use `useNeoConfirm().require({ message, accept: () => store.remove(filter.id) })` or an `AppModal` confirm-step.

### [HIGH] `MeetingExtrasTabs.addAgenda` — `Number.isFinite(undefined)` is always false, so duration is never null when empty
- File: `web/Front/customapp/src/components/meetings/MeetingExtrasTabs.vue:137-147`
- Category: logic
- Evidence:
```ts
async function addAgenda() {
  if (!newAgenda.title.trim()) return
  const duration = newAgenda.durationText ? parseInt(newAgenda.durationText, 10) : undefined
  await store.addAgenda(props.projectId, props.meetingId, {
    title: newAgenda.title.trim(),
    duration: Number.isFinite(duration) ? duration : null,
  })
```
When `durationText` is empty string, `duration = undefined`, then `Number.isFinite(undefined) === false`, so body sends `duration: null` — that's OK. But when `durationText = "abc"`, `parseInt` returns `NaN`, `Number.isFinite(NaN) === false`, sends `null` — OK. However when `durationText = "15"`, `parseInt` returns `15`, sent as-is. So the "bug" is more subtle: user input like `"15m"` becomes `15` silently, `"0"` becomes `0` (sent), and negative numbers (`"-5"`) pass through unchallenged.
- Impact: Silent parsing of invalid input; negative durations accepted.
- Fix: `const n = parseInt(newAgenda.durationText, 10); duration = Number.isFinite(n) && n > 0 ? n : null`.

---

## MEDIUM

### [MEDIUM] `PresenceAvatars` — initial character extraction broken for non-BMP names
- File: `web/Front/customapp/src/components/common/PresenceAvatars.vue:11`
- Category: logic / i18n
- Evidence:
```vue
{{ user.name[0]?.toUpperCase() ?? '?' }}
```
`string[0]` for a name starting with an emoji (🦊) or a surrogate-pair character (e.g. `'𝓐lice'`) yields half of the code point → mojibake.
- Impact: Broken glyph shown in the avatar.
- Fix: `Array.from(user.name)[0]?.toUpperCase() ?? '?'` — or use `[...user.name][0]`.

### [MEDIUM] `PresenceAvatars` — `:key="user.userId"` correct, but no key on overflow-pill — fine
- File: `web/Front/customapp/src/components/common/PresenceAvatars.vue:4-20`
- Category: perf (non-issue)
- Evidence: The `v-for` uses `user.userId` (stable). The task prompt asked about "missing key prop causing re-render churn" — I verified `:key` exists (line 5). `[UNCERTAIN]` about re-render churn of the parent list; this component is fine.
- Impact: none observed.
- Fix: n/a.

### [MEDIUM] `SplitPanel` has no `ResizeObserver` — prompt's "resize-observer cleanup on unmount" concern not applicable
- File: `web/Front/customapp/src/components/common/SplitPanel.vue:1-43`
- Category: informational
- Evidence: The file is pure CSS flex; no `ResizeObserver`, no JS width measurement, no drag handle. Resize responsiveness is handled by `@media (max-width: 900px)` (line 39-42).
- Impact: none — but the 35/65 split is fixed (`width: 35%`, line 30) and cannot be user-resized, contradicting the name of a "split panel". Users cannot drag the divider.
- Fix: If a draggable divider is wanted, add a resizer ref + `pointermove` listener and an `onUnmounted` cleanup. Otherwise, rename to `ListDetailLayout` for clarity.

### [MEDIUM] `WpStatusTag` — `'warn'` vs `'warning'` again + no fallback for unknown status
- File: `web/Front/customapp/src/components/common/WpStatusTag.vue:12-22`
- Category: neolibrary / logic
- Evidence:
```ts
const severity = computed<'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast'>(() => {
  switch (props.status) {
    case 'New':        return 'secondary'
    case 'InProgress': return 'info'
    case 'Resolved':   return 'success'
    case 'Closed':     return 'success'
    case 'OnHold':     return 'warn'
    case 'Rejected':   return 'danger'
    default:           return 'secondary'
  }
})
```
Backend `schema.prisma:643` declares `status String @default("New") @db.VarChar(20)` — the value is a free-form string, not an enum. The switch accepts 6 canonical values and falls back to `'secondary'` for everything else. If someone introduces a new status like `Blocked`, `Reopened` or `Done`, the tag silently renders as grey "Blocked" text. `StatusChip.vue` maps `Blocked` but `WpStatusTag` does NOT — two components have different vocabularies (6 vs 7 labels).
- Impact: Design inconsistency; unknown statuses visually blend with `New`/`Closed`.
- Fix: Align the two maps in a single source-of-truth module (`src/types/workPackage.types.ts`) and import everywhere. Decide on `'warn'` vs `'warning'` canonically.

### [MEDIUM] `StatusChip` and `WpStatusTag` diverge on `Blocked`, `Closed` color mapping
- File: `web/Front/customapp/src/components/common/StatusChip.vue:13-20` vs `WpStatusTag.vue:13-22`
- Category: logic / UX
- Evidence (`StatusChip`):
```ts
Closed:       { label: 'Clôturé',       color: '#71717A', background: '#F4F4F5' },
OnHold:       { label: 'En pause',      color: '#F59E0B', background: '#FFFBEB' },
Blocked:      { label: 'Bloqué',        color: '#DC2626', background: '#FEF2F2' },
```
Evidence (`WpStatusTag`):
```ts
case 'Closed':     return 'success'
case 'OnHold':     return 'warn'
case 'Rejected':   return 'danger'
```
`StatusChip` treats `Closed` as neutral grey; `WpStatusTag` treats `Closed` as `success`. `StatusChip` lists `Blocked`; `WpStatusTag` does not. `WpStatusTag` has `Rejected`; `StatusChip` does not.
- Impact: Same WP rendered in two views shows two different colors.
- Fix: Unify the status vocabulary and color mapping in one module.

### [MEDIUM] `PriorityDot` has no `Critical` class, but `filter.types.ts` uses `'Critical'`
- File: `web/Front/customapp/src/components/common/PriorityDot.vue:3,18-22` vs `src/types/filter.types.ts:24`
- Category: logic
- Evidence:
```vue
<span class="priority-dot" :class="`priority-dot--${(priority || 'normal').toLowerCase()}`" :title="priority || 'Normal'" />
```
```css
.priority-dot--low       { background: #10b981; }
.priority-dot--normal    { background: #3b82f6; }
.priority-dot--high      { background: #f59e0b; }
.priority-dot--urgent    { background: #ef4444; }
.priority-dot--immediate { background: #dc2626; }
```
Filter types canonical `Priority` values: `'Low' | 'Medium' | 'High' | 'Critical'`. Schema (`schema.prisma:644`) uses `priority String @default("Normal")`. CSS classes cover `low/normal/high/urgent/immediate` — mixing two vocabularies: (`Low/Medium/High/Critical`) vs (`Low/Normal/High/Urgent/Immediate`). There is no selector for `Critical` or `Medium` — so the dot has no background for those values (fallback: no style, transparent dot).
- Impact: Dot disappears (transparent) for `Critical` and `Medium` priorities.
- Fix: Align one vocabulary; add CSS classes for all canonical values.

### [MEDIUM] `FilterBuilder` binds a single-value `NeoSelect` to an array — likely broken multi-select
- File: `web/Front/customapp/src/components/filters/FilterBuilder.vue:35-42,62-69`
- Category: neolibrary / logic
- Evidence:
```vue
<NeoSelect
  v-model="localStatus"
  :options="statusOptions"
  optionLabel="label"
  optionValue="value"
  placeholder="Tous les statuts"
  @change="emitChange"
/>
```
`localStatus` is `ref<string[]>` (line 156). The `NeoSelect` spec in project CLAUDE.md lists `v-model, options, optionLabel, optionValue, placeholder, disabled` — no `multiple` prop documented. `NeoSelect` most likely holds a single value and will set `localStatus` to a string on selection, wiping the array. The render of chips below (lines 43-56) `v-for="s in localStatus"` assumes array — only ever shows one chip if NeoSelect does single-value.
- Impact: "Multi-select" UX does not actually multi-select; the apparent array state is replaced by a scalar on each change; the chip list then iterates characters of that string (each `s` in a `"InProgress"` iteration is a single char), producing spurious single-char chips.
- Fix: Use a true multi-select component (NeoMultiSelect if available, or a custom chip-picker). Do not bind arrays to `NeoSelect` without verifying it supports `multiple`.

### [MEDIUM] `KeyboardHelpDialog` does not stop `?` from being re-registered while already visible
- File: `web/Front/customapp/src/components/common/KeyboardHelpDialog.vue:24-35` + `useKeyboardShortcuts.ts:39-92`
- Category: UX
- Evidence:
```ts
const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{ (e: 'update:visible', v: boolean): void }>()

const visibleModel = computed({
  get: () => props.visible,
  set: (v) => emit('update:visible', v),
})
```
The composable toggles `helpVisible` on `?` keypress (`useKeyboardShortcuts.ts:92: helpVisible.value = !helpVisible.value`). When the help dialog is open and `?` is pressed, the composable's global listener toggles to `false`, and `AppModal`'s Escape already handles close. But while typing "?" in the (focused) modal, the global listener still fires — no guard for `e.target instanceof HTMLInputElement`.
- Impact: User opens the help dialog, clicks into any input that happens to be teleported into the modal, and a literal `?` keystroke toggles the dialog shut.
- Fix: In `useKeyboardShortcuts`, ignore keys when `event.target` is an `input/textarea/[contenteditable]`.

### [MEDIUM] `ErrorBoundary.onErrorCaptured` returns `false` and blocks error propagation — but `error.ts` retry requires full reload
- File: `web/Front/customapp/src/components/ErrorBoundary.vue:23-31`
- Category: UX
- Evidence:
```ts
onErrorCaptured((err: Error) => {
  error.value = err
  errorMessage.value = err.message || 'Une erreur inattendue est survenue.'
  return false
})

const handleRetry = () => {
  window.location.reload()
}
```
`return false` swallows the error (stops Vue from re-throwing). `handleRetry` does a full page reload, which loses Pinia state, router history, and unsaved edits.
- Impact: Users lose in-progress work (e.g. half-completed Work Package forms) when a rendering error bubbles up.
- Fix: Attempt `error.value = null` first to re-render the `<slot>`; only reload as a last resort. Surface the raw error stack in development builds (`import.meta.env.DEV`).

### [MEDIUM] `ChangePasswordDialog` — password mismatch allows submit with 8-char minimum but nothing else
- File: `web/Front/customapp/src/components/ChangePasswordDialog.vue:67-88`
- Category: security
- Evidence:
```ts
async function submit() {
  errorMsg.value = ''
  if (newPass.value.length < 8) {
    errorMsg.value = 'Le nouveau mot de passe doit contenir au moins 8 caractères.'
    return
  }
  if (newPass.value !== confirm.value) {
    errorMsg.value = 'Les mots de passe ne correspondent pas.'
    return
  }
```
Only length check — no complexity, no weak-password list, no "new ≠ current" check. `NeoPassword` with `:feedback="true"` only gives visual feedback, not a hard gate.
- Impact: User can set `"password"` if ≥ 8 chars. Backend must enforce the real policy.
- Fix: Align with backend policy, add checks for `newPass === current`, reject passwords in a short common-password list, require at least one number + one letter.

### [MEDIUM] `ChangePasswordDialog` — swallows all API errors into a generic French string
- File: `web/Front/customapp/src/components/ChangePasswordDialog.vue:78-87`
- Category: UX
- Evidence:
```ts
try {
  await api.post('/auth/change-password', { currentPassword: current.value, newPassword: newPass.value })
  toast.add({ severity: 'success', detail: 'Mot de passe modifié avec succès.', life: 3000 })
  emit('update:visible', false)
  reset()
} catch {
  errorMsg.value = 'Erreur lors du changement de mot de passe.'
}
```
Backend might return 400 ("current password wrong") vs 401 ("session expired") vs 500 — user sees one identical message.
- Impact: User cannot tell whether their current password was wrong or the server is down.
- Fix: Inspect `error.response?.status` and `error.response?.data?.message` to surface a specific message.

### [MEDIUM] `NotificationBell` panel opens on click — no collision handling with viewport edges
- File: `web/Front/customapp/src/components/NotificationBell.vue:23,215-228`
- Category: UX
- Evidence:
```vue
<div v-if="open" class="notif-panel" role="dialog" aria-label="Notifications">
```
```css
.notif-panel {
  position: absolute;
  bottom: 0;
  left: calc(100% + 10px);
  width: 340px;
```
When placed near the right edge of the viewport, the panel overflows horizontally. No flip logic.
- Impact: On narrow or right-aligned topbars, the panel is clipped.
- Fix: Use a floating-ui / popper positioner, or a `@media` query that flips to `right: 0`.

### [MEDIUM] `MeetingExtrasTabs.addAtt` — externalEmail sent as `null` when empty string
- File: `web/Front/customapp/src/components/meetings/MeetingExtrasTabs.vue:157-167`
- Category: logic
- Evidence:
```ts
await store.addAttendee(props.projectId, props.meetingId, {
  externalName: newAtt.externalName.trim(),
  externalEmail: newAtt.externalEmail || null,
  isPresent: false,
})
```
No email format validation — a user typing `"foo"` still posts. Backend Prisma schema likely stores it unchanged. Also `externalEmail.trim()` is not called.
- Impact: Invalid / whitespace emails accepted.
- Fix: Validate with a regex or Zod before POST; trim the value.

### [MEDIUM] `MeetingExtrasTabs.outcomeSeverity` return type not constrained
- File: `web/Front/customapp/src/components/meetings/MeetingExtrasTabs.vue:116-123`
- Category: neolibrary
- Evidence:
```ts
function outcomeSeverity(t: string) {
  switch (t) {
    case 'Decision': return 'info'
    case 'Action':   return 'success'
    case 'Risk':     return 'danger'
    default:         return 'secondary'
  }
}
```
Inferred return type is the union of string literals. Since `NeoTag.severity` is typed, passing this un-widened literal works at compile time — but there is no compile-time guard that `'success'/'info'/'danger'/'secondary'` are accepted by NeoTag. Also missing `'Note'` case (falls into `secondary` default).
- Impact: OK in practice; maintainability risk.
- Fix: Declare `function outcomeSeverity(t: string): NeoTagSeverity`.

---

## LOW

### [LOW] `Anomalies.vue` — legacy `defineProps` Options API mixed with `<script setup>`
- File: `web/Front/customapp/src/components/Anomalies.vue:1-18`
- Category: logic (style)
- Evidence:
```vue
<script setup lang="ts">
import { defineProps } from 'vue'
const props = defineProps({
  messages: {
    type: Array<string>,
    default: () => []
  }
})
</script>
```
`defineProps` is a compiler macro — importing it from `'vue'` is unnecessary (and emits a compile warning). Also uses the verbose options-API syntax in a TS file; prefer `defineProps<{ messages?: string[] }>()`.
Also `<li :key="item">` uses the string itself as key — if messages are duplicated the list breaks.
- Impact: Lint warning / duplicated-message rendering bug.
- Fix:
```ts
const props = withDefaults(defineProps<{ messages?: string[] }>(), { messages: () => [] })
```
and `<li v-for="(item, i) in messages" :key="i">`.

### [LOW] `AppSkeleton` — `:style="{ width, height }"` types allow invalid CSS
- File: `web/Front/customapp/src/components/common/AppSkeleton.vue:2-16`
- Category: logic
- Evidence:
```ts
withDefaults(defineProps<{
  variant?: 'line' | 'block' | 'circle'
  width?: string
  height?: string
}>(), {
  variant: 'line',
  width: '100%',
  height: '16px',
})
```
A caller passing `width="12"` (no unit) produces invalid CSS silently (browsers treat as `12` → 0).
- Impact: UI skeleton renders wrong size.
- Fix: Validate at runtime (`assert width.match(/(px|%|em|rem|vw|vh)$/)` in dev) or document the contract.

### [LOW] `TableSkeleton.colWidth` — hardcoded width list of 6 cycles beyond `cols=5`
- File: `web/Front/customapp/src/components/common/TableSkeleton.vue:23-27`
- Category: perf / UX
- Evidence:
```ts
function colWidth(col: number): string {
  // Varied widths per column to mimic realistic table content
  const widths = ['40%', '15%', '12%', '18%', '15%', '20%']
  return widths[(col - 1) % widths.length]
}
```
Sum of widths for default `cols=5`: 40+15+12+18+15 = 100 %. Add a 1.5 rem gap (line 34) and the row overflows horizontally.
- Impact: Horizontal overflow on the skeleton (visual only).
- Fix: Reduce the first column to ~35 %.

### [LOW] `StatCard` — `tone` is optional but CSS applies only four class names
- File: `web/Front/customapp/src/components/common/StatCard.vue:3,13-20,43-46`
- Category: logic
- Evidence:
```vue
<div class="stat" :class="`stat--${tone}`">
```
```ts
type Tone = 'normal' | 'danger' | 'warning' | 'success'
defineProps<{ icon: string; label: string; value: number | string; tone?: Tone }>()
```
When `tone` is `undefined`, the template renders `stat--undefined` class — no matching CSS, which is fine, but the default "normal" tone never receives styling beyond the base `.stat`. Inconsistent with the `Tone` declaration listing `'normal'`.
- Impact: Minor; `.stat--normal` class does not exist in CSS so nothing differentiates "normal" from "undefined".
- Fix:
```vue
<div class="stat" :class="tone && tone !== 'normal' ? `stat--${tone}` : ''">
```
Or use `withDefaults` with `tone: 'normal'` and add `.stat--normal { ... }`.

### [LOW] `ProjectBreadcrumbs.MODULE_LABELS` missing entries
- File: `web/Front/customapp/src/components/common/ProjectBreadcrumbs.vue:32-45`
- Category: UX
- Evidence:
```ts
const MODULE_LABELS: Record<string, string> = {
  'pm-project-detail':    '',
  'pm-workpackages':      'Work Packages',
  'pm-gantt':             'Gantt',
  'pm-board':             'Board',
  'pm-backlogs':          'Backlog',
  'pm-sprint':            'Sprint',
  'pm-wiki':              'Wiki',
  'pm-wiki-page':         'Wiki',
  'pm-budget':            'Budget',
  'pm-time':              'Temps',
  'pm-members':           'Membres',
  'pm-project-activity':  'Activité',
}
```
Project `CLAUDE.md` lists additional project modules: sprint-board (`/sprint`), wiki/:slug, meetings — and admin routes `portfolio`, `team-planner`, plus `ProjectActivityView`. If a new route is added without updating this map, the breadcrumb renders no module label.
- Impact: Missing breadcrumb on new modules.
- Fix: Move labels into the route meta (`meta: { breadcrumb: 'Gantt' }`) and read from `route.meta.breadcrumb`.

### [LOW] `NotificationBell` — `Ctrl+K` collision risk with `mark-all-btn` when dropdown open
- File: `web/Front/customapp/src/components/NotificationBell.vue:27-33`
- Category: UX
- Evidence: No explicit keyboard shortcut collision; `[UNCERTAIN]` about real collision with Cmd-K. Worth noting the panel is `position: absolute; bottom: 0; left: calc(100% + 10px)` — in the sidebar-rail layout it appears *beside* the bell, possibly under the Cmd-K overlay if palette opens next.
- Impact: None observed in current tests.
- Fix: none required.

### [LOW] `Loader.vue` — `z-index: 9999` collides with AppModal's 9600 and Cmd-K's 9800
- File: `web/Front/customapp/src/components/Loader.vue:7-16`
- Category: logic / UX
- Evidence:
```css
.loader-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--nl-overlay-bg);
  z-index: 9999;
}
```
Per the comment in `AppModal.vue:56-61`, `Loader` (9999) sits between Cmd-K (9800) and PrimeVue (10000). If a Loader shows over an open modal, the modal is blocked — probably intended — but Cmd-K over a Loader is not possible.
- Impact: Z-stack ladder undocumented; inconsistent layering.
- Fix: Register Loader in the comment block and pick an intentional rank.

### [LOW] `KeyboardHelpDialog` — `<td>` used for kb-hints without `<th scope>` etc.
- File: `web/Front/customapp/src/components/common/KeyboardHelpDialog.vue:4-21`
- Category: a11y
- Evidence: The table has no `<caption>`, no `<thead>`, and `<tr><td class="kb-help__sep" colspan="2">Navigation (depuis un projet)</td></tr>` abuses a data cell as a section header.
- Impact: Minor; screen readers announce an unstructured table.
- Fix: Convert to `<dl>` or add `<caption>` + `<thead>` and use `<th scope="rowgroup">` for the section separators.

### [LOW] `ProjectModuleShell` — no explicit `aria-label` or skip-link
- File: `web/Front/customapp/src/components/common/ProjectModuleShell.vue:2-14`
- Category: a11y
- Evidence: The shell stacks breadcrumbs + header + body but the `<div class="pms">` is not a `<main>` or `role="main"`. Multiple `ProjectModuleShell`s on the same page would be indistinguishable to AT.
- Impact: Mild.
- Fix: Wrap body in `<main>` or add `role="region"` + `aria-label`.

### [LOW] `Teleport to="body"` assumption — body always exists at component mount
- File: `web/Front/customapp/src/components/common/AppModal.vue:3`, `AppSearchModal.vue:3`
- Category: logic
- Evidence: Vue's `Teleport` target is resolved at mount time. `document.body` always exists in a normal SPA bootstrap (Vite/Vue 3 mounts after `#app`). No SSR is in use (dev server is Vite on port 5173 per project `CLAUDE.md`). `[UNCERTAIN]` about SSR/test-harness builds.
- Impact: none in current setup.
- Fix: n/a.

---

## UNCERTAIN

### [UNCERTAIN] Backend `/api/search` endpoint existence
- File: `web/Front/customapp/src/components/common/AppSearchModal.vue:129`
- Category: logic
- Evidence: the frontend calls `/api/search?q=...` but the project `CLAUDE.md` route list does not mention this endpoint. I did not exhaustively grep the NestJS source.
- Impact: If absent, the palette's "server search" silently returns no hits.
- Fix: Confirm endpoint; document it in CLAUDE.md.

### [UNCERTAIN] NeoTag severity string — `'warn'` vs `'warning'`
- File: Multiple (`FilterBuilder.vue:134`, `ModulePageHeader.vue:20`, `ProjectModuleShell.vue:24`, `WpStatusTag.vue:12`, project CLAUDE.md)
- Category: neolibrary
- Evidence: TS unions use `'warn'`; project CLAUDE.md says `"warning"`. `filter.types.ts:36` uses `'warning'`.
- Impact: One of them fails at runtime (the other is silently dropped).
- Fix: Inspect the NeoLibrary `NeoTag` source to pick the canonical value.

### [UNCERTAIN] Cross-project breadcrumb cache leak
- File: `web/Front/customapp/src/components/common/ProjectBreadcrumbs.vue`
- Category: informational
- Evidence: The prompt asked specifically about "cross-project cache leak when cached breadcrumb rendered". `ProjectBreadcrumbs.vue` holds a per-instance `projectName` ref (no module-level cache). The stale-during-fetch issue is covered in [HIGH] above; no cache leak was observed.
- Impact: none from this file.
- Fix: n/a.

### [UNCERTAIN] `FilterBuilder` — `NeoDatePicker` emits `string | string[] | null`
- File: `web/Front/customapp/src/components/filters/FilterBuilder.vue:103-113,159-160`
- Category: neolibrary
- Evidence:
```vue
<NeoDatePicker
  v-model="localDateFrom"
  placeholder="Du…"
  @update:modelValue="emitChange"
/>
```
```ts
const localDateFrom = ref<string | null>(props.modelValue.dateRange?.from ?? null)
```
Project `CLAUDE.md` says NeoDatePicker v-model is `string | string[] | null`. `localDateFrom` is typed `string | null`; if the picker emits an array (date-range mode) the ref holds an array cast as a string and `dateRange.from` is serialized incorrectly.
- Impact: If the picker is ever configured in range mode, the filter criterion breaks.
- Fix: Widen the ref type to `string | string[] | null`; pick a single branch when building criteria.

---

## Summary counts

| Severity  | Count |
|-----------|-------|
| CRITICAL  | 3     |
| HIGH      | 10    |
| MEDIUM    | 13    |
| LOW       | 9     |
| UNCERTAIN | 4     |

## Top 5 to fix first

1. Add body scroll-lock + focus-trap + focus-return to `AppModal` (CRITICAL, unblocks WCAG + many dialogs).
2. Sanitise / whitelist `PresenceAvatars` color value (CRITICAL, XSS-via-CSS vector).
3. Fix the `'warn'` vs `'warning'` severity mismatch — impacts `FilterBuilder`, `SavedFiltersPanel`, `WpStatusTag`, `ModulePageHeader`, `ProjectModuleShell` (HIGH, fixes all priority/status chip colors).
4. Replace raw `primevue/dialog` in `SavedFiltersPanel.vue` and `ChangePasswordDialog.vue` with `AppModal` (HIGH, matches project policy & v2.0 commit `d4b5258`).
5. Add `<body>`-scoped-delete confirmation to `SavedFiltersPanel.confirmDelete` and reset `selIdx`/clear debounce in `AppSearchModal` (HIGH, prevents data loss + keyboard bugs).
