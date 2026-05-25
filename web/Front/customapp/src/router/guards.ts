/** @file src/router/guards.ts — Reusable Vue Router navigation guards */

import type { NavigationGuardNext, RouteLocationNormalized } from 'vue-router'
import { useAuthStore } from '@/stores/authStore'

// ─── Role Guard ───────────────────────────────────────────────────────────────

/**
 * Per-route role-based access guard.
 *
 * Apply as `beforeEnter` on routes that carry `meta.allowedRoles`.
 * Redirects to `/unauthorized` when the current user's role is not in the list.
 */
export function roleGuard(
  to: RouteLocationNormalized,
  _from: RouteLocationNormalized,
  next: NavigationGuardNext,
): void {
  const auth = useAuthStore()
  const allowedRoles = to.meta.allowedRoles as string[] | undefined

  if (!allowedRoles || allowedRoles.length === 0) {
    next()
    return
  }

  if (!auth.userRole || !allowedRoles.includes(auth.userRole)) {
    next({ name: 'unauthorized' })
    return
  }

  next()
}
