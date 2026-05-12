/**
 * @file src/stores/userStore.ts — Pinia store for user management — immutable state updates
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '@/lib/api'
import { onLogout } from './logoutBus'
import type {
  UserResponse,
  CreateUserPayload,
  UpdateUserPayload,
  UserRole,
} from '@/types/user.types'

export const useUserStore = defineStore('users', () => {
  // ─── State ──────────────────────────────────────────────────────────────────
  const users = ref<UserResponse[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  // ─── Getters ─────────────────────────────────────────────────────────────────
  const activeUsers = computed(() => users.value.filter((u) => u.isActive))
  const projectManagers = computed(() =>
    users.value.filter((u) => u.role === 'ProjectManager' && u.isActive),
  )

  // ─── Actions ─────────────────────────────────────────────────────────────────

  const fetchAll = async () => {
    loading.value = true
    error.value = null
    try {
      const { data } = await api.get<{ items: UserResponse[]; total: number } | UserResponse[]>('/admin/appuser')
      const items = Array.isArray(data) ? data : (data.items ?? [])
      users.value = [...items]
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors du chargement des utilisateurs.'
    } finally {
      loading.value = false
    }
  }

  const fetchByRole = async (role: UserRole) => {
    loading.value = true
    error.value = null
    try {
      const { data } = await api.get<UserResponse[]>(`/admin/appuser/by-role/${role}`)
      return data
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur.'
      return []
    } finally {
      loading.value = false
    }
  }

  const createUser = async (payload: CreateUserPayload): Promise<UserResponse | null> => {
    loading.value = true
    error.value = null
    try {
      const { data } = await api.post<UserResponse>('/admin/appuser', payload)
      users.value = [...users.value, data]
      return data
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors de la création.'
      return null
    } finally {
      loading.value = false
    }
  }

  const updateUser = async (
    id: string,
    payload: UpdateUserPayload,
  ): Promise<UserResponse | null> => {
    loading.value = true
    error.value = null
    try {
      const { data } = await api.put<UserResponse>(`/admin/appuser/${id}`, payload)
      users.value = users.value.map((u) => (u.id === id ? { ...data } : u))
      return data
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors de la mise à jour.'
      return null
    } finally {
      loading.value = false
    }
  }

  const resetPassword = async (id: string): Promise<string | null> => {
    loading.value = true
    error.value = null
    try {
      const { data } = await api.post<{ temporaryPassword: string }>(
        `/admin/appuser/${id}/reset-password`,
        {},
      )
      return data.temporaryPassword
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors de la réinitialisation.'
      return null
    } finally {
      loading.value = false
    }
  }

  const deactivateUser = async (id: string) => {
    loading.value = true
    error.value = null
    try {
      await api.post(`/admin/appuser/${id}/deactivate`, {})
      users.value = users.value.map((u) => (u.id === id ? { ...u, isActive: false } : u))
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors de la désactivation.'
    } finally {
      loading.value = false
    }
  }

  const reactivateUser = async (id: string) => {
    loading.value = true
    error.value = null
    try {
      await api.post(`/admin/appuser/${id}/reactivate`, {})
      users.value = users.value.map((u) => (u.id === id ? { ...u, isActive: true } : u))
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors de la réactivation.'
    } finally {
      loading.value = false
    }
  }

  /**
   * Hard delete an account. The backend rejects the call with a 400 when
   * the user has history rows that block FK deletion (managed projects,
   * authored tasks, time entries, comments, attachments) — the caller is
   * expected to surface that message via the toast.
   */
  const deleteUser = async (id: string): Promise<boolean> => {
    loading.value = true
    error.value = null
    try {
      await api.delete(`/admin/appuser/${id}`)
      users.value = users.value.filter((u) => u.id !== id)
      return true
    } catch (e: unknown) {
      const fromAxios =
        typeof e === 'object' && e !== null && 'response' in e
          ? ((e as { response?: { data?: { message?: string } } }).response?.data?.message ?? null)
          : null
      error.value =
        fromAxios ??
        (e instanceof Error ? e.message : 'Erreur lors de la suppression.')
      return false
    } finally {
      loading.value = false
    }
  }

  // ─── Logout reset ────────────────────────────────────────────────────────────

  /** Wipe per-user state on logout. */
  const reset = (): void => {
    users.value = []
    loading.value = false
    error.value = null
  }

  onLogout(reset)

  return {
    users,
    loading,
    error,
    activeUsers,
    projectManagers,
    fetchAll,
    fetchByRole,
    createUser,
    updateUser,
    resetPassword,
    deactivateUser,
    reactivateUser,
    deleteUser,
    reset,
  }
})
