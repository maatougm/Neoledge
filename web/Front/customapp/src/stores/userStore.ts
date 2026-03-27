/**
 * @file     userStore.ts
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-26
 * @desc     Pinia store for user management — state never mutated in place (immutable updates)
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import axios from 'axios'
import { useApp } from './useApp'
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

  // ─── Helpers ─────────────────────────────────────────────────────────────────
  const apiBase = () => useApp().apiUrl + '/admin/AppUser'

  const authHeader = () => {
    const jwt = useApp().jwt
    return jwt ? { Authorization: `Bearer ${jwt}` } : {}
  }

  // ─── Actions ─────────────────────────────────────────────────────────────────

  const fetchAll = async () => {
    loading.value = true
    error.value = null
    try {
      const { data } = await axios.get<UserResponse[]>(apiBase(), { headers: authHeader() })
      users.value = [...data]
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
      const { data } = await axios.get<UserResponse[]>(`${apiBase()}/by-role/${role}`, {
        headers: authHeader(),
      })
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
      const { data } = await axios.post<UserResponse>(apiBase(), payload, {
        headers: authHeader(),
      })
      users.value = [...users.value, data]
      return data
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors de la création.'
      return null
    } finally {
      loading.value = false
    }
  }

  const updateUser = async (id: string, payload: UpdateUserPayload): Promise<UserResponse | null> => {
    loading.value = true
    error.value = null
    try {
      const { data } = await axios.put<UserResponse>(`${apiBase()}/${id}`, payload, {
        headers: authHeader(),
      })
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
      const { data } = await axios.post<{ temporaryPassword: string }>(
        `${apiBase()}/${id}/reset-password`,
        {},
        { headers: authHeader() },
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
      await axios.post(`${apiBase()}/${id}/deactivate`, {}, { headers: authHeader() })
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
      await axios.post(`${apiBase()}/${id}/reactivate`, {}, { headers: authHeader() })
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
