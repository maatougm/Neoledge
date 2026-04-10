/**
 * @file src/stores/userStore.ts — Pinia store for user management — immutable state updates
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '@/lib/api'
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
      const { data } = await api.get<UserResponse[]>(`/admin/AppUser/by-role/${role}`)
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
      const { data } = await api.post<UserResponse>('/admin/AppUser', payload)
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
      const { data } = await api.put<UserResponse>(`/admin/AppUser/${id}`, payload)
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
        `/admin/AppUser/${id}/reset-password`,
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
      await api.post(`/admin/AppUser/${id}/deactivate`, {})
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
      await api.post(`/admin/AppUser/${id}/reactivate`, {})
      users.value = users.value.map((u) => (u.id === id ? { ...u, isActive: true } : u))
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors de la réactivation.'
    } finally {
      loading.value = false
    }
  }

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
  }
})
