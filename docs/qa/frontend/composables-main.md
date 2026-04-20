# QA — composables / main.ts / App.vue

Files opened:
- `C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\composables\useNotificationSocket.ts`
- `C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\composables\useCollaborationSocket.ts`
- `C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\composables\useDarkMode.ts`
- `C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\composables\useFeatureFlags.ts`
- `C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\composables\useKeyboardShortcuts.ts`
- `C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\composables\usePermission.ts`
- `C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\composables\useProjectForm.ts`
- `C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\composables\useUserManagement.ts`
- `C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\main.ts`
- `C:\Users\BigPoppa\Desktop\neoleadge\web\Front\customapp\src\App.vue`

Scope note: only static analysis; no modifications made.

---

## useNotificationSocket.ts

### [HIGH] JWT not refreshed on reconnect — stale token survives re-auth
- File: `web/Front/customapp/src/composables/useNotificationSocket.ts:39-46`
- Category: logic / error-handling
- Evidence:
```ts
    socket = io(`${base}/notifications`, {
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 30_000,
    })
```
- Impact: The `token` passed to `connect()` is captured in the initial handshake. When Socket.IO auto-reconnects (infinite attempts), it re-sends the same `auth.token`. If the JWT has expired or been rotated (token refresh flow), every reconnect will fail with an auth error and the client will loop forever without visible recovery. Users who stay in-app past `JWT_EXPIRES_IN=7d` silently lose real-time notifications.
- Fix: Attach a `reconnect_attempt` handler that refreshes `auth.token` from the auth store before the next handshake, e.g. `socket.on('reconnect_attempt', () => { socket.auth = { token: authStore.token } })`. Alternatively handle `connect_error` → if reason is auth, trigger token refresh then `socket.connect()`.

### [HIGH] No `connect_error` handler — silent failure + no user feedback
- File: `web/Front/customapp/src/composables/useNotificationSocket.ts:48-79`
- Category: error-handling / UX
- Evidence:
```ts
    socket.on('connect', () => {
      connected.value = true
    })

    socket.on('disconnect', () => {
      connected.value = false
    })

    socket.on('notification', (payload: unknown) => {
```
- Impact: Unlike `useCollaborationSocket.ts` (which logs `connect_error`), the notification socket has no `connect_error`, `error`, or `reconnect_failed` listeners. When the JWT is rejected or the server is down, the user has no indication. There is no toast, no UI badge, no log — only `connected.value` stays `false`.
- Fix: Add `socket.on('connect_error', (err) => { console.warn(...) })` plus a user-visible banner or toast after N failures. Parity with the collaboration socket is a minimum.

### [HIGH] Dynamic import inside event handler — every notification pays import cost + creates timing race
- File: `web/Front/customapp/src/composables/useNotificationSocket.ts:56-78`
- Category: perf / logic
- Evidence:
```ts
    socket.on('notification', (payload: unknown) => {
      // Lazy import to avoid circular dependency at module init time
      import('@/stores/notificationStore')
        .then(({ useNotificationStore }) => {
          const store = useNotificationStore()
          if (isNotification(payload)) {
            store.addNotification(payload)
          }
        })
        .catch(() => undefined)

      // Show toast popup
      import('@neolibrary/components')
        .then(({ useNeoToast }) => {
```
- Impact: After the first notification arrives, the modules are cached — but the promise-microtask chain still runs on every event. More importantly, `.catch(() => undefined)` silently swallows ALL errors — including `isNotification` failures, store mutation errors, or toast-composable misuse. A malformed payload would be ignored with zero observability.
- Fix: Hoist the imports to module top level (circular imports can be avoided by importing the *store factory* lazily inside the handler via a captured reference set at `connect()` time), and replace `.catch(() => undefined)` with `.catch((err) => console.error('[NotificationSocket]', err))`.

### [MEDIUM] `useNeoToast()` called outside Vue `setup()` — undefined behavior
- File: `web/Front/customapp/src/composables/useNotificationSocket.ts:69-76`
- Category: logic
- Evidence:
```ts
      import('@neolibrary/components')
        .then(({ useNeoToast }) => {
          const toast = useNeoToast()
          toast.add({
            severity: 'info',
            summary: String((payload as Record<string, unknown>)['title'] ?? 'Notification'),
```
- Impact: `useNeoToast()` is a composable that typically expects an active Vue component instance (via `inject()` / `getCurrentInstance()`). Calling it from a Socket.IO event callback runs outside any component's setup context. Depending on NeoLibrary's internals, it may either (a) silently no-op, (b) throw, or (c) emit toasts to an incorrect layer. This is [UNCERTAIN] without NeoLibrary's source, but the pattern is risky.
- Fix: Inject the toast reference once inside a consuming component (e.g., `AppShell.vue`) and expose it to the socket via a callback, or use NeoLibrary's global toast service if one exists.

### [MEDIUM] `disconnect()` does not remove listeners — GC leak potential on hot-reload
- File: `web/Front/customapp/src/composables/useNotificationSocket.ts:82-86`
- Category: memory-leak
- Evidence:
```ts
  function disconnect(): void {
    socket?.disconnect()
    socket = null
    connected.value = false
  }
```
- Impact: `socket.disconnect()` closes the transport but keeps registered listeners. Setting `socket = null` drops the reference, so in practice the Socket.IO Manager cleans up, but any external handlers added via `.on()` by consumers would leak. The bigger issue: during HMR in dev, the module re-evaluates while old sockets still exist — there is no `socket.removeAllListeners()` before reassignment in `connect()`.
- Fix: `socket?.removeAllListeners(); socket?.disconnect(); socket = null`. Same in `connect()` before `socket = io(...)` to defensively clean any pre-existing instance.

### [LOW] `isNotification` is incomplete — misses v2.0 fields
- File: `web/Front/customapp/src/composables/useNotificationSocket.ts:13-23`
- Category: logic
- Evidence:
```ts
function isNotification(payload: unknown): payload is Notification {
  if (typeof payload !== 'object' || payload === null) return false
  const p = payload as Record<string, unknown>
  return (
    typeof p['id'] === 'string' &&
    typeof p['type'] === 'string' &&
    typeof p['title'] === 'string' &&
    typeof p['message'] === 'string' &&
    typeof p['isRead'] === 'boolean'
  )
}
```
- Impact: CLAUDE.md states the `Notification` model gained `reason`, `entityType`, `entityId`, `actorId`, `link` in v2.0. The guard only validates 5 fields, so a backward-incompatible payload change (e.g., renaming `title`) would not be flagged; worse, new required fields could be missing yet the guard would still succeed. The cast at line 73 `(payload as Record<string, unknown>)['title']` bypasses the guard entirely for the toast.
- Fix: Use a shared Zod schema as the source of truth for the `Notification` type, and reuse it both here and in the store.

---

## useCollaborationSocket.ts

### [HIGH] JWT not refreshed on reconnect (same bug as notification socket)
- File: `web/Front/customapp/src/composables/useCollaborationSocket.ts:67-80`
- Category: logic
- Evidence:
```ts
  function connect(apiUrl: string, token: string): void {
    if (socket?.connected) return

    const base = apiUrl.replace(/\/$/, '')

    try {
      socket = io(`${base}/collaboration`, {
        auth: { token },
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 2000,
        reconnectionDelayMax: 30_000,
      })
```
- Impact: Same class of bug. After JWT expiry, the socket reconnects with a stale token indefinitely. Presence drops and silently never recovers.
- Fix: Same remedy — subscribe to `reconnect_attempt` and refresh `socket.auth.token` from `authStore` before each attempt.

### [HIGH] `pendingJoins` buffer is module-scoped and cleared only on `connect` — stale joins leak across sessions
- File: `web/Front/customapp/src/composables/useCollaborationSocket.ts:62,82-89,138-145`
- Category: logic / memory-leak
- Evidence:
```ts
const pendingJoins = new Set<string>()
...
      socket.on('connect', () => {
        connected.value = true
        // Flush any join-project calls that arrived before the socket finished handshake.
        for (const projectId of pendingJoins) {
          socket?.emit('join-project', projectId)
        }
        pendingJoins.clear()
      })
...
  function joinProject(projectId: string): void {
    if (!socket?.connected) {
      // Buffer the join — flushed in the 'connect' handler once handshake completes.
      pendingJoins.add(projectId)
      return
    }
```
- Impact: If `joinProject(A)` is called before socket connects, then the user navigates away and `leaveProject(A)` is called (removed from `pendingJoins`), but then the user visits project B and `joinProject(B)` before handshake — by the time handshake fires, they may no longer be viewing B. All pending joins flush together. If `disconnect()` is called before `connect` handler fires, `pendingJoins` is never cleared → next `connect()` will resurrect joins for projects the user no longer watches.
- Fix: Clear `pendingJoins` inside `disconnect()`. Consider storing a single `currentProjectId` instead of a set, since a user typically only views one project.

### [HIGH] Reconnect does not re-emit `join-project` — presence is lost silently
- File: `web/Front/customapp/src/composables/useCollaborationSocket.ts:82-89`
- Category: logic / UX
- Evidence:
```ts
      socket.on('connect', () => {
        connected.value = true
        // Flush any join-project calls that arrived before the socket finished handshake.
        for (const projectId of pendingJoins) {
          socket?.emit('join-project', projectId)
        }
        pendingJoins.clear()
      })
```
- Impact: After a network blip + reconnect, the server drops the room membership but the client does NOT re-join. `pendingJoins` was cleared on initial connect, so the flush loop runs empty on every reconnect. The user's presence disappears from teammates' screens and remote `field-changed`/`card-moved` events for that project stop arriving.
- Fix: Track `activeProjectId` separately from `pendingJoins`. On every `connect` event, re-emit `join-project` for the active project regardless of whether it's in the pending set.

### [MEDIUM] `remoteFieldChange` / `remoteCardMove` are module-global — multi-component consumers race on the same ref
- File: `web/Front/customapp/src/composables/useCollaborationSocket.ts:60-61,106-123`
- Category: logic
- Evidence:
```ts
const remoteFieldChange = ref<RemoteFieldChange | null>(null)
const remoteCardMove = ref<RemoteCardMove | null>(null)
```
- Impact: Any component watching `remoteFieldChange` will see the same value as every other. If two components both react to the same ref and one sets it to `null` to acknowledge, the other misses the event. There is no event-queue semantics — it's a last-write-wins cell.
- Fix: Use `mitt` or `tinyEmitter` for these signals, or expose per-consumer `watch` subscriptions with a monotonic id so consumers can dedupe. Alternatively, set the ref and immediately schedule clearing with `nextTick` so the watcher fires once.

### [MEDIUM] `disconnect()` forgets to clear `remoteCardMove` and `pendingJoins`
- File: `web/Front/customapp/src/composables/useCollaborationSocket.ts:130-136`
- Category: logic / memory-leak
- Evidence:
```ts
  function disconnect(): void {
    socket?.disconnect()
    socket = null
    connected.value = false
    presenceList.value = []
    remoteFieldChange.value = null
  }
```
- Impact: `remoteCardMove` keeps its last value across logout/login cycles. `pendingJoins` also keeps entries, so a user who buffered a join then logged out will re-emit that join-project on next login — potentially to a project they lost access to.
- Fix: Add `remoteCardMove.value = null` and `pendingJoins.clear()` to `disconnect()`.

### [MEDIUM] No listener cleanup before re-`io()` — duplicate handlers on reconnect-via-connect
- File: `web/Front/customapp/src/composables/useCollaborationSocket.ts:68-80`
- Category: memory-leak
- Evidence:
```ts
    if (socket?.connected) return
    ...
    try {
      socket = io(`${base}/collaboration`, {
```
- Impact: The early return only triggers if the socket is currently connected. If `connect()` is called after a `disconnect()` (`socket = null`) that is fine, but if called after a transient disconnect where the old socket still exists with handlers attached, a second socket is created via `io()` (Manager may return the same instance for the same URL but listeners accumulate). This is [UNCERTAIN] without inspecting Socket.IO manager caching behavior for this exact URL.
- Fix: `socket?.removeAllListeners(); socket?.disconnect();` before reassignment — defensive.

### [LOW] `card-moved` type guard is inlined and inconsistent with others
- File: `web/Front/customapp/src/composables/useCollaborationSocket.ts:112-123`
- Category: logic
- Evidence:
```ts
      socket.on('card-moved', (payload: unknown) => {
        if (typeof payload === 'object' && payload !== null) {
          const p = payload as Record<string, unknown>
          if (typeof p['workPackageId'] === 'string' && typeof p['status'] === 'string') {
            remoteCardMove.value = {
              workPackageId: p['workPackageId'],
              boardColumnId: (p['boardColumnId'] as string | null) ?? null,
              status: p['status'],
            }
          }
        }
      })
```
- Impact: The `boardColumnId` cast is unsafe — if the server sends `boardColumnId: 42` (number), this becomes the number silently, breaking downstream string comparisons.
- Fix: Extract an `isRemoteCardMove` guard that validates `boardColumnId: string | null | undefined`.

---

## useDarkMode.ts

### [HIGH] SSR hostile — top-level `document` and `localStorage` access
- File: `web/Front/customapp/src/composables/useDarkMode.ts:12-15`
- Category: logic
- Evidence:
```ts
const isDark = ref(localStorage.getItem('darkMode') === 'true')

// Apply class immediately on module load — before any Vue component mounts
document.documentElement.classList.toggle('dark', isDark.value)
```
- Impact: Although the project currently runs CSR only (Vite dev, no SSR), importing this module anywhere server-side (e.g., future Nuxt migration, Vitest JSDOM without proper setup, or pre-rendering) throws `ReferenceError: localStorage is not defined` / `document is not defined`. This is load-bearing if the file is imported during module evaluation of a test file.
- Fix: Guard with `typeof window !== 'undefined'`. Example:
  ```ts
  const initial = typeof window !== 'undefined' && localStorage.getItem('darkMode') === 'true'
  const isDark = ref(initial)
  if (typeof document !== 'undefined') document.documentElement.classList.toggle('dark', initial)
  ```

### [MEDIUM] `savePreference` silently swallows all errors — no retry, no observability
- File: `web/Front/customapp/src/composables/useDarkMode.ts:30-41`
- Category: error-handling
- Evidence:
```ts
async function savePreference(): Promise<void> {
  if (!_token || !_apiBase) return
  try {
    await axios.put(
      `${_apiBase}/api/userprofile/preferences`,
      { darkMode: isDark.value },
      { headers: { Authorization: `Bearer ${_token}` } },
    )
  } catch {
    // Fire-and-forget — silently ignore network errors
  }
}
```
- Impact: Cross-device sync will be silently broken if the backend returns 401/500. No log even in dev. Also, if `loadFromBackend` was never called (e.g., login flow didn't invoke it yet), `_token` is empty and the function exits — the preference is written only to localStorage, which is fine, but there's no indication the sync failed.
- Fix: `console.warn('[useDarkMode] savePreference failed', err)` in the catch. Also: `_apiBase` missing should probably log once.

### [MEDIUM] `CLAUDE.md` lists no such endpoint — `/api/userprofile/preferences` may not exist
- File: `web/Front/customapp/src/composables/useDarkMode.ts:33,55`
- Category: logic
- Evidence:
```ts
    await axios.put(
      `${_apiBase}/api/userprofile/preferences`,
      { darkMode: isDark.value },
```
- Impact: [UNCERTAIN] — the CLAUDE.md API route list does not include `/api/userprofile/preferences`. If that route is missing from the NestJS backend, every dark-mode toggle hits a 404 silently (caught and swallowed). Needs verification against `web/back-nest/src/`.
- Fix: Grep the backend for the route handler. If absent, either add it or remove the backend sync path and keep localStorage-only.

### [MEDIUM] `_token` / `_apiBase` module state never cleared on logout
- File: `web/Front/customapp/src/composables/useDarkMode.ts:18-19,50-52`
- Category: memory-leak / security
- Evidence:
```ts
let _token = ''
let _apiBase = ''
...
  async function loadFromBackend(token: string, apiBase: string): Promise<void> {
    _token   = token
    _apiBase = apiBase
```
- Impact: The JWT is held in module-scope `_token` indefinitely. After logout, a subsequent dark-mode toggle will still `PUT /api/userprofile/preferences` with the old user's token (until the server rejects it). This is both a logic issue (wrong user updated) and a minor security smell (token outlives the session).
- Fix: Expose a `clearAuth()` function from `useDarkMode` and call it from `authStore.logout()`.

### [LOW] `isDark` has no safeguard against corrupted localStorage
- File: `web/Front/customapp/src/composables/useDarkMode.ts:12`
- Category: logic
- Evidence:
```ts
const isDark = ref(localStorage.getItem('darkMode') === 'true')
```
- Impact: Fine for happy path. If storage is full or blocked (private mode, Safari ITP), `getItem` returns `null` which compares false — no issue. But `setItem` inside `applyDark` can throw `QuotaExceededError`, which is uncaught.
- Fix: `try { localStorage.setItem(...) } catch {}` in `applyDark`.

---

## useKeyboardShortcuts.ts

### [MEDIUM] `pendingG` is a closure variable shared per composable invocation — double-mount races
- File: `web/Front/customapp/src/composables/useKeyboardShortcuts.ts:41-42,116-120`
- Category: logic
- Evidence:
```ts
  let pendingG = false
  let pendingGTimer: ReturnType<typeof setTimeout> | null = null
...
  onMounted(() => window.addEventListener('keydown', handleKey))
  onUnmounted(() => {
    window.removeEventListener('keydown', handleKey)
    clearPendingG()
  })
```
- Impact: Each call to `useKeyboardShortcuts()` creates its own `handleKey` and its own `pendingG` state. If the composable is accidentally mounted twice (e.g., in both `AppShell` and a child layout), you get double `keydown` listeners and each press of `g` starts a separate sequence. CLAUDE.md warns to "call once from AppShell" but there's no guard.
- Fix: Module-level flag or a singleton pattern — first caller wins, second call returns the same refs without re-registering the listener. Or use `document.addEventListener` with a sentinel to ensure single attachment.

### [MEDIUM] Ctrl+K / Cmd+K handler does not check `isTypingTarget` but others do — inconsistent UX
- File: `web/Front/customapp/src/composables/useKeyboardShortcuts.ts:58-67`
- Category: UX
- Evidence:
```ts
  function handleKey(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey) {
      // Ctrl+K / Cmd+K → global search
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchVisible.value = true
      }
      return
    }
    if (isTypingTarget(e.target)) return
```
- Impact: Ctrl+K inside a `<textarea>` (wiki editor) will steal focus and open global search, overriding a user's native keyboard intent (browsers use Ctrl+K to focus the URL bar on some platforms, but more importantly textarea users may want Ctrl+K for custom bindings). The convention is that Ctrl+K for search *is* expected to work inside inputs — but the inconsistency with other shortcuts should be documented.
- Fix: Either document the intended behavior or also gate Ctrl+K on `isTypingTarget`.

### [LOW] `pendingG` sequence: pressing `g` then quickly `g` again — first `g` clears, second `g` starts new sequence, 800ms window may be tight
- File: `web/Front/customapp/src/composables/useKeyboardShortcuts.ts:98-100`
- Category: UX
- Evidence:
```ts
      case 'g':
        pendingG = true
        pendingGTimer = setTimeout(clearPendingG, 800)
        return
```
- Impact: If the user presses `g`, triggers the pending state, then presses another `g` for "g → g (Gantt)", the first branch consumes it. But if they press `g`, hesitate, then press `g`, they navigate to Gantt by accident. The 800ms default is standard in Vim, but combined with `preventDefault()` not being called on the first `g`, the letter 'g' may appear in the URL or break text elsewhere. [UNCERTAIN] without manual QA.
- Fix: Call `e.preventDefault()` on the first `g` as well to signal intent has been captured.

### [LOW] `goTo` swallows all navigation errors — no distinction between redirect and real failures
- File: `web/Front/customapp/src/composables/useKeyboardShortcuts.ts:49-51`
- Category: error-handling
- Evidence:
```ts
  function goTo(path: string) {
    router.push(path).catch(() => {})
  }
```
- Impact: Silently hides NavigationFailureType.aborted (expected) but also chunk-load errors and other real failures. If a route fails to load, the user sees no feedback.
- Fix: `router.push(path).catch((err) => { if (!isNavigationFailure(err)) console.warn(err) })`.

---

## useProjectForm.ts

### [HIGH] State is module-scoped only in intent — actually closure-scoped, no reset between projects
- File: `web/Front/customapp/src/composables/useProjectForm.ts:29-42`
- Category: logic / UX
- Evidence:
```ts
export function useProjectForm() {
  const store = useProjectStore()
  const toast = useNeoToast()

  // ─── Form state ────────────────────────────────────────────────────────────
  const form = reactive<CreateProjectPayload>({
    name: '',
    clientName: '',
    startDate: '',
    endDate: '',
    projectManagerId: undefined,
  })
```
- Impact: The form state is created fresh on every `useProjectForm()` call (inside the function body, not at module scope). Good — no cross-component pollution. BUT: a single component that calls `useProjectForm()` in `setup()` and then switches which project it's editing (via `v-if` or keeping the same component mounted) will NOT get a form reset unless it explicitly calls `reset()`. There is no `watch` on route params to auto-reset. This matches the explicit concern in the prompt about "state reset between projects".
- Fix: Document clearly that consumers must call `reset()` on dialog open/close, OR add a `useProjectForm(route)` variant that watches `route.params.id` and auto-resets.

### [MEDIUM] `validate()` compares date strings with `>` — works for ISO but fails for French format
- File: `web/Front/customapp/src/composables/useProjectForm.ts:54-56`
- Category: logic
- Evidence:
```ts
    if (form.startDate && form.endDate && form.endDate <= form.startDate) {
      errors.endDate = 'La date de fin doit être postérieure à la date de début.'
    }
```
- Impact: `form.startDate` can be in `dd/mm/yyyy` form (per `toISODate` pass-through). Comparing `"09/04/2026" <= "10/04/2026"` is lexicographic and happens to work for same-year same-century cases, but fails for cross-year: `"31/12/2025" <= "01/01/2026"` evaluates to `false` only because '3' > '0' lexicographically — wrong result. Validation logic is date-format-dependent.
- Fix: Normalize to ISO before comparing: `if (toISODate(form.startDate) && toISODate(form.endDate) && toISODate(form.endDate) <= toISODate(form.startDate))`.

### [LOW] `toISODate` trusts the two-digit-year heuristic — `"01/01/50"` → `2050-01-01` even when user meant 1950
- File: `web/Front/customapp/src/composables/useProjectForm.ts:15-27`
- Category: logic
- Evidence:
```ts
function toISODate(s: string): string {
  if (!s) return s
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const parts = s.split('/')
  if (parts.length === 3) {
    const [d, m, y] = parts
    const fullYear = y.length === 2 ? `20${y}` : y
```
- Impact: Project management domain likely never needs pre-2000 dates, so the rule is fine in practice. Noted for awareness.
- Fix: None needed unless the domain widens.

### [LOW] No validation of `projectManagerId` UUID shape
- File: `web/Front/customapp/src/composables/useProjectForm.ts:47-59`
- Category: logic
- Evidence:
```ts
  const validate = (): boolean => {
    Object.keys(errors).forEach((k) => delete errors[k as keyof typeof errors])

    if (!form.name.trim()) errors.name = 'Le nom du projet est requis.'
    if (!form.clientName.trim()) errors.clientName = 'Le nom du client est requis.'
    if (!form.startDate) errors.startDate = 'La date de début est requise.'
    if (!form.endDate) errors.endDate = 'La date de fin est requise.'
```
- Impact: `projectManagerId` is passed through without shape checks. Server will reject bad UUIDs, but the UX round-trip is slow. Minor.
- Fix: Regex-check UUID before submit.

---

## useFeatureFlags.ts

### [MEDIUM] `readPrefs` runs on every `flags.value` read — no caching
- File: `web/Front/customapp/src/composables/useFeatureFlags.ts:27-45`
- Category: perf
- Evidence:
```ts
function readPrefs(): Partial<FeatureFlags> {
  try {
    const raw = localStorage.getItem('user_preferences')
    if (!raw) return {}
    return JSON.parse(raw) as Partial<FeatureFlags>
  } catch {
    return {}
  }
}

export function useFeatureFlags() {
  const flags = computed<FeatureFlags>(() => ({ ...DEFAULTS, ...readPrefs() }))
```
- Impact: `computed` memoizes, so it should re-read only when reactive dependencies change — but `localStorage` is NOT reactive. Any component that reads `flags.value` will ALWAYS see the cached initial value until Vue happens to invalidate the computed (which it won't, since there are no deps). First access parses JSON; subsequent access returns the memoized value — meaning updates to `user_preferences` in localStorage NEVER propagate to the UI.
- Fix: Either (a) poll via `storage` event listener and a `ref` to force recomputation, or (b) move preferences into Pinia/authStore so they're reactive.

### [LOW] No `Zod` schema for `user_preferences` — arbitrary localStorage content deserializes without validation
- File: `web/Front/customapp/src/composables/useFeatureFlags.ts:31-35`
- Category: logic
- Evidence:
```ts
    if (!raw) return {}
    return JSON.parse(raw) as Partial<FeatureFlags>
```
- Impact: If localStorage contains `{"showGantt": "yes"}`, the spread keeps the string, and downstream `isEnabled('showGantt')` returns the truthy string `"yes"` — which equals `true` in boolean context but leaks a string type across boundaries.
- Fix: Validate with Zod, fall back to defaults on parse failure.

---

## usePermission.ts

### [LOW] `usePermissions().can` is not bound — passing `auth.can` directly may lose `this`
- File: `web/Front/customapp/src/composables/usePermission.ts:24-29`
- Category: logic
- Evidence:
```ts
export function usePermissions(): {
  can: (permissionKey: string, projectId?: string | null) => boolean
} {
  const auth = useAuthStore()
  return { can: auth.can }
}
```
- Impact: [UNCERTAIN] — Pinia `defineStore` auto-binds action methods, so `this` inside `can` usually resolves via the store proxy. If `can` is defined as a getter or a plain arrow function that closes over `authStore.state`, this is fine. If it's a method that uses `this.user`, passing it unbound could break. Verify in `authStore.ts`.
- Fix: `return { can: auth.can.bind(auth) }` defensively.

---

## useUserManagement.ts

### [LOW] `toast` captured at composable init — may be outside component setup if misused
- File: `web/Front/customapp/src/composables/useUserManagement.ts:14-16`
- Category: logic
- Evidence:
```ts
export function useUserManagement() {
  const store = useUserStore()
  const toast = useNeoToast()
```
- Impact: Same class as `useNotificationSocket` but less severe — `useUserManagement` should only be called from inside a component setup, which is the normal case. Still worth noting.
- Fix: Document the constraint explicitly in the JSDoc.

### [LOW] `openEdit` clones the user shallowly — nested object mutations leak back
- File: `web/Front/customapp/src/composables/useUserManagement.ts:31-34`
- Category: logic
- Evidence:
```ts
  const openEdit = (user: UserResponse) => {
    editingUser.value = { ...user }
    showEditDialog.value = true
  }
```
- Impact: If `UserResponse` contains nested objects (e.g., `preferences: {}`), the spread only shallow-copies. Editing `editingUser.value.preferences.foo` would mutate the original list row. [UNCERTAIN] without the type def.
- Fix: `structuredClone(user)` or `JSON.parse(JSON.stringify(user))` for safety.

### [LOW] `handleDeactivate` relies on `store.error` being `null` after success — race on concurrent calls
- File: `web/Front/customapp/src/composables/useUserManagement.ts:67-74`
- Category: logic
- Evidence:
```ts
  const handleDeactivate = async (id: string) => {
    await store.deactivateUser(id)
    if (!store.error) {
      toast.add({ severity: 'success', detail: 'Compte désactivé.', life: 3000 })
    } else {
      toast.add({ severity: 'error', detail: store.error, life: 5000 })
    }
  }
```
- Impact: If two rapid deactivations fire, store.error after the second await reflects the latter call's outcome — but both handlers check the same flag. Minor since Vue's reactivity is synchronous per tick, but the pattern is fragile.
- Fix: Have store actions return `{ ok: boolean, error?: string }` rather than stashing on the store.

---

## main.ts

### [MEDIUM] No global Vue error handler — uncaught errors disappear into the console
- File: `web/Front/customapp/src/main.ts:26-32`
- Category: error-handling
- Evidence:
```ts
const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(NeoLibraryThemePlugin, { theme: 'neoledge' })

app.mount('#app')
```
- Impact: `app.config.errorHandler` is not set, so runtime errors in component render functions, setup, or lifecycle hooks log to console and nothing else — no user-facing toast, no telemetry, no recovery UI. The comment in `App.vue` says "Global error boundary ... handled per-layout" but none of the layouts I was asked to review implement it here.
- Fix:
  ```ts
  app.config.errorHandler = (err, instance, info) => {
    console.error('[VueError]', info, err)
    // Optionally route to toast/Sentry
  }
  ```

### [MEDIUM] Plugin registration order — `router` installed before `NeoLibraryThemePlugin`
- File: `web/Front/customapp/src/main.ts:28-30`
- Category: logic
- Evidence:
```ts
app.use(createPinia())
app.use(router)
app.use(NeoLibraryThemePlugin, { theme: 'neoledge' })
```
- Impact: Pinia first is correct (stores may be used in router guards). Router second means router guards execute before `NeoLibraryThemePlugin` installs. [UNCERTAIN] whether any router guard reads NeoLibrary globals — likely not, but worth verifying. Also, `app.mount('#app')` happens synchronously after `app.use(NeoLibraryThemePlugin)`, so the first render has the theme. Fine.
- Fix: Consider reversing `router` and `NeoLibraryThemePlugin` if any guard ever uses NeoLibrary composables.

### [LOW] FOUC prevention duplicates the logic already in `useDarkMode.ts`
- File: `web/Front/customapp/src/main.ts:22-24`
- Category: logic
- Evidence:
```ts
if (localStorage.getItem('darkMode') === 'true') {
  document.documentElement.classList.add('dark', 'p-dark')
}
```
- Impact: `useDarkMode.ts:12-15` already does this at module load. If main.ts imports anything that pulls `useDarkMode.ts`, the class may be set twice (harmless) or main.ts's check runs first and useDarkMode's check overrides (identical, so idempotent). Functional — just redundant.
- Fix: Remove lines 22-24 once `useDarkMode` is guaranteed to be imported before first render, OR keep only the main.ts version and remove the module-level side effect in `useDarkMode.ts`.

### [LOW] No `localStorage` guard in FOUC prevention — blows up if storage is blocked
- File: `web/Front/customapp/src/main.ts:22`
- Category: error-handling
- Evidence:
```ts
if (localStorage.getItem('darkMode') === 'true') {
```
- Impact: Safari in private mode / disabled cookies throws when accessing `localStorage`. The entire app fails to bootstrap.
- Fix: `try { ... } catch {}` wrapper.

---

## App.vue

### [MEDIUM] No error boundary — `<router-view />` is the only child, no `<Suspense>` fallback, no `onErrorCaptured`
- File: `web/Front/customapp/src/App.vue:1-8`
- Category: error-handling / UX
- Evidence:
```vue
<template>
  <router-view />
</template>

<script setup lang="ts">
// Global error boundary and toast are handled per-layout (AppShell injects NeoToast).
// Dark mode class sync is handled by useDarkMode singleton (applied at module load in main.ts).
</script>
```
- Impact: If a route fails to load (chunk error), or any child layout throws during setup, there is no fallback UI at the app root. The user sees a blank page. The comment defers the concern to "per-layout" but this means any user who logs in to a broken layout sees nothing — no retry button, no error text.
- Fix: Wrap with `<Suspense><template #fallback>Chargement...</template><router-view/></Suspense>` and add `onErrorCaptured` to present a global error toast or a recovery UI.

### [LOW] No `<meta>` viewport / theme-color in `App.vue` — relies entirely on `index.html`
- File: `web/Front/customapp/src/App.vue:1-13`
- Category: UX
- Evidence: File has only `<template><router-view/></template>` — no `<Teleport>`, no global toast mount.
- Impact: `useNeoToast` relies on a toast mount point existing somewhere. If `AppShell` is not mounted (e.g., `/login` or `/portal/:token` routes), toast calls may no-op silently. [UNCERTAIN] without inspecting NeoLibrary.
- Fix: Mount a global `<NeoToast />` directly in `App.vue` at the root so it's always available regardless of route.

---

## Cross-cutting issues

### [HIGH] Neither socket composable exposes a way to trigger reconnect with fresh JWT after token refresh
- Files:
  - `web/Front/customapp/src/composables/useNotificationSocket.ts:32-88`
  - `web/Front/customapp/src/composables/useCollaborationSocket.ts:66-181`
- Category: logic
- Evidence: Neither file exposes `refreshAuth(token)`, `reauthenticate()`, or similar. The only API is `connect(apiUrl, token)` which early-returns when the socket is still connected.
- Impact: When the auth store rotates tokens (refresh flow), there is no way to push the new token to a socket that is currently connected. Unless the server forces a disconnect on token expiry, the long-lived socket keeps operating with the old token in `socket.auth`, which becomes a problem when the connection drops and reconnects attempt with the stale value.
- Fix: Expose `updateAuth(token: string)` that sets `socket.auth = { token }` on both composables; call it from a watcher on `authStore.token`.

### [MEDIUM] Module-level refs in three composables never evict — cache memory accumulates
- Files:
  - `useNotificationSocket.ts:27-28` (`socket`, `connected`)
  - `useCollaborationSocket.ts:57-62` (`socket`, `connected`, `presenceList`, `remoteFieldChange`, `remoteCardMove`, `pendingJoins`)
  - `useDarkMode.ts:12,18-19` (`isDark`, `_token`, `_apiBase`)
- Category: memory-leak
- Evidence: All three hold module-scope state that persists for the life of the JS bundle. Navigating `/login` → `/app` → logout → `/login` does not clear any of these.
- Impact: Sensitive state (tokens, JWTs, presence data) survives logouts. For a shared-computer kiosk scenario this is a minor security issue; for memory, it's negligible.
- Fix: Central `resetAll()` helper called from `authStore.logout()` that resets each composable's module state.

---

End of report.
