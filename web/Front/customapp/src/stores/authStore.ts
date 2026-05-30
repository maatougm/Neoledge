/** @file src/stores/authStore.ts — Pinia store for authentication state and actions */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import axios from 'axios'
import { useConfigStore } from './configStore'
import { fireLogout } from './logoutBus'
import { getUserRole, getUserFullName, getUserInitials, getUserId, isTokenExpired } from '@/lib/jwt'

// ─── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'nl_jwt'

// ─── Store ────────────────────────────────────────────────────────────────────

/**
 * /auth/me response. The dynamic-RBAC era exposed a `permissions` map and
 * an `assignedRoles` list on top of the user object; both are now empty
 * (kept in the response shape for one-release backward compatibility).
 */
interface MeResponse {
  user: { id: string; email: string; firstName: string; lastName: string; role: string }
  permissions?: { global: string[]; perProject: Record<string, string[]> }
  roles?: { id: string; name: string; projectId: string | null }[]
}

export const useAuthStore = defineStore('auth', () => {
  // ── State ──────────────────────────────────────────────────────────────────
  const jwt = ref<string>('')

  // ── Getters ────────────────────────────────────────────────────────────────

  const isAuthenticated = computed<boolean>(() => !!jwt.value)

  const userRole = computed<string | null>(() =>
    jwt.value ? getUserRole(jwt.value) : null,
  )

  const userFullName = computed<string>(() =>
    jwt.value ? getUserFullName(jwt.value) : '',
  )

  const userInitials = computed<string>(() =>
    jwt.value ? getUserInitials(jwt.value) : '??',
  )

  const userId = computed<string | null>(() =>
    jwt.value ? getUserId(jwt.value) : null,
  )

  // ── Internal helpers ───────────────────────────────────────────────────────

  function _persist(token: string): void {
    localStorage.setItem(STORAGE_KEY, token)
  }

  function _clearStorage(): void {
    localStorage.removeItem(STORAGE_KEY)
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  /**
   * Loads the JWT from localStorage on application startup.
   * Call this once in the app entry point (main.ts or App.vue onMounted).
   */
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

  /**
   * Login step 1 — email + password.
   *
   * Returns:
   *   - `{ requiresTotp: false }` on success (jwt stored).
   *   - `{ requiresTotp: true, tempToken }` when TOTP challenge is required.
   */
  const login = async (
    email: string,
    password: string,
  ): Promise<{ requiresTotp: boolean; tempToken?: string }> => {
    const config = useConfigStore()
    // Use plain axios to avoid the circular dep with api.ts
    const response = await axios.post<{
      jwt?: string
      requiresTotp?: boolean
      tempToken?: string
    }>(config.apiUrl + '/auth/login', { email, password })

    if (response.data.requiresTotp) {
      return { requiresTotp: true, tempToken: response.data.tempToken }
    }

    const token = response.data.jwt ?? ''
    jwt.value = token
    _persist(token)
    return { requiresTotp: false }
  }

  /**
   * Login step 2 — complete a TOTP challenge.
   * Stores the resulting JWT on success.
   */
  const loginTotp = async (tempToken: string, code: string): Promise<void> => {
    const config = useConfigStore()
    const response = await axios.post<{ jwt?: string }>(
      config.apiUrl + '/auth/login/totp',
      { tempToken, code },
    )

    const token = response.data.jwt ?? ''
    jwt.value = token
    _persist(token)
  }

  /**
   * Request a passwordless magic-link sign-in email. Always resolves (the
   * backend returns 200 whether or not the account exists — no enumeration),
   * so callers should show a generic "if an account exists…" confirmation.
   */
  const requestMagicLink = async (email: string): Promise<void> => {
    const config = useConfigStore()
    await axios.post(config.apiUrl + '/auth/magic-link', { email })
  }

  /**
   * Consume a magic-link token.
   * Returns:
   *   - `{ requiresTotp: false }` on success (jwt stored).
   *   - `{ requiresTotp: true, tempToken }` when the account has 2FA enabled.
   * Throws on an invalid / expired link (401).
   */
  const magicLogin = async (
    token: string,
  ): Promise<{ requiresTotp: boolean; tempToken?: string }> => {
    const config = useConfigStore()
    const response = await axios.post<{
      jwt?: string
      requiresTotp?: boolean
      tempToken?: string
    }>(config.apiUrl + '/auth/magic-login', { token })

    if (response.data.requiresTotp) {
      return { requiresTotp: true, tempToken: response.data.tempToken }
    }

    const newToken = response.data.jwt ?? ''
    jwt.value = newToken
    _persist(newToken)
    return { requiresTotp: false }
  }

  /**
   * Logout — clears local state then notifies the backend.
   * Navigation to /login is handled by the router guard (via 401 or explicit redirect).
   */
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

  /** Explicitly set a JWT (e.g. from Elise GUID flow). */
  const setJwt = (token: string): void => {
    jwt.value = token
    _persist(token)
  }

  /** Clear authentication state entirely (without calling the logout endpoint). */
  const clear = (): void => {
    jwt.value = ''
    _clearStorage()
    // Notify every store that registered on the logout bus so they can reset
    // their per-user state and tear down any polling timers.
    fireLogout()
    // Also emit a CustomEvent so any non-store listener (composables, tests,
    // or ad-hoc subscribers) can react to logout without importing logoutBus.
    if (typeof window !== 'undefined') {
      try {
        window.dispatchEvent(new CustomEvent('auth:logout'))
      } catch {
        // Swallow — older browsers / JSDOM edge cases should not block logout.
      }
    }
  }

  /**
   * Validate the current JWT against /auth/me. 401 means the token was
   * invalidated (e.g. password reset / account deactivation) and the user
   * should be redirected to /login. The legacy `permissions` / `roles`
   * fields in the response are ignored — authorization is driven by the
   * `role` claim baked into the JWT.
   */
  const fetchMe = async (): Promise<MeResponse | null> => {
    if (!jwt.value) return null
    const config = useConfigStore()
    try {
      const response = await axios.get<MeResponse>(config.apiUrl + '/auth/me', {
        headers: { Authorization: `Bearer ${jwt.value}` },
      })
      return response.data
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 401) {
        clear()
      }
      return null
    }
  }

  return {
    // State (expose as readonly-ish — consumers should use actions to mutate)
    jwt,
    // Getters
    isAuthenticated,
    userRole,
    userFullName,
    userInitials,
    userId,
    // Actions
    init,
    login,
    loginTotp,
    requestMagicLink,
    magicLogin,
    logout,
    setJwt,
    clear,
    fetchMe,
  }
})
