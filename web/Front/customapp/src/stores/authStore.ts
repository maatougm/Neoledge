/** @file src/stores/authStore.ts — Pinia store for authentication state and actions */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import axios from 'axios'
import { useConfigStore } from './configStore'
import { getUserRole, getUserFullName, getUserInitials, getUserId } from '@/lib/jwt'

// ─── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'nl_jwt'

// ─── Store ────────────────────────────────────────────────────────────────────

export const useAuthStore = defineStore('auth', () => {
  // ── State ──────────────────────────────────────────────────────────────────
  const jwt = ref<string>('')
  const mustChangePassword = ref<boolean>(false)

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
      mustChangePassword?: boolean
    }>(config.apiUrl + '/auth/login', { email, password })

    if (response.data.requiresTotp) {
      return { requiresTotp: true, tempToken: response.data.tempToken }
    }

    const token = response.data.jwt ?? ''
    jwt.value = token
    mustChangePassword.value = response.data.mustChangePassword ?? false
    _persist(token)
    return { requiresTotp: false }
  }

  /**
   * Login step 2 — complete a TOTP challenge.
   * Stores the resulting JWT on success.
   */
  const loginTotp = async (tempToken: string, code: string): Promise<void> => {
    const config = useConfigStore()
    const response = await axios.post<{
      jwt?: string
      mustChangePassword?: boolean
    }>(config.apiUrl + '/auth/login/totp', { tempToken, code })

    const token = response.data.jwt ?? ''
    jwt.value = token
    mustChangePassword.value = response.data.mustChangePassword ?? false
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
    mustChangePassword.value = false
    _clearStorage()
  }

  return {
    // State (expose as readonly-ish — consumers should use actions to mutate)
    jwt,
    mustChangePassword,
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
    logout,
    setJwt,
    clear,
  }
})
