/**
 * @file src/stores/logoutBus.ts
 * Tiny in-memory pub/sub used to reset every Pinia store on logout.
 *
 * Each store registers a `reset` function at setup time via `onLogout(reset)`.
 * `authStore.clear()` calls `fireLogout()` which invokes every registered
 * handler, ensuring per-user state (lists, loading flags, polling timers)
 * is wiped before the next user (or the same user re-authenticating) sees it.
 */

type ResetFn = () => void

const handlers = new Set<ResetFn>()

/**
 * Register a handler to run on logout. Safe to call multiple times with
 * different functions — duplicates are deduped by Set identity.
 */
export function onLogout(fn: ResetFn): void {
  handlers.add(fn)
}

/** Remove a previously registered handler. */
export function offLogout(fn: ResetFn): void {
  handlers.delete(fn)
}

/**
 * Invoke every registered handler. Exceptions are swallowed so a single
 * broken handler does not prevent the others from running.
 */
export function fireLogout(): void {
  for (const fn of handlers) {
    try {
      fn()
    } catch {
      // swallow — one handler must not block the others
    }
  }
}

/** Test-only — exposed for unit tests to reset the registry between runs. */
export function _clearHandlers(): void {
  handlers.clear()
}
