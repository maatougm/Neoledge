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

interface MeResponse {
  user: { id: string; email: string; firstName: string; lastName: string; role: string }
  permissions: { global: string[]; perProject: Record<string, string[]> }
  roles: { id: string; name: string; projectId: string | null }[]
}

export const useAuthStore = defineStore('auth', () => {
  // ── State ──────────────────────────────────────────────────────────────────
  const jwt = ref<string>('')
  const globalPermissions = ref<Set<string>>(new Set())
  const projectPermissions = ref<Map<string, Set<string>>>(new Map())
  const assignedRoles = ref<MeResponse['roles']>([])

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

  /**
   * Check whether the current user holds a permission. If `projectId` is
   * provided, per-project permissions also count; otherwise only global ones.
   */
  const can = (permissionKey: string, projectId?: string | null): boolean => {
    if (globalPermissions.value.has(permissionKey)) return true
    if (projectId) {
      const bucket = projectPermissions.value.get(projectId)
      if (bucket?.has(permissionKey)) return true
    }
    return false
  }

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
    globalPermissions.value = new Set()
    projectPermissions.value = new Map()
    assignedRoles.value = []
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
   * Fetch the live permission set for the current JWT. Call after login and
   * on app bootstrap. 401 means the token was invalidated (e.g. role change)
   * and the user should be redirected to /login.
   */
  const fetchMe = async (): Promise<MeResponse | null> => {
    if (!jwt.value) return null
    const config = useConfigStore()
    try {
      const response = await axios.get<MeResponse>(config.apiUrl + '/auth/me', {
        headers: { Authorization: `Bearer ${jwt.value}` },
      })
      globalPermissions.value = new Set(response.data.permissions.global)
      const perProject = new Map<string, Set<string>>()
      for (const [pid, keys] of Object.entries(response.data.permissions.perProject)) {
        perProject.set(pid, new Set(keys))
      }
      projectPermissions.value = perProject
      assignedRoles.value = response.data.roles
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
    globalPermissions,
    projectPermissions,
    assignedRoles,
    can,
    // Actions
    init,
    login,
    loginTotp,
    logout,
    setJwt,
    clear,
    fetchMe,
  }
})
