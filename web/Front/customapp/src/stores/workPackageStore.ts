/** @file src/stores/workPackageStore.ts — Work Packages state + actions */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/lib/api'
import { onLogout } from './logoutBus'
import type { WorkPackage, CreateWpPayload, UpdateWpPayload, WorkPackageCustomField } from '@/types/work-package.types'

export const useWorkPackageStore = defineStore('workPackages', () => {
  const items = ref<WorkPackage[]>([])
  const total = ref<number>(0)
  const currentWp = ref<WorkPackage | null>(null)
  const customFields = ref<WorkPackageCustomField[]>([])
  const loading = ref<boolean>(false)
  const error = ref<string | null>(null)

  async function fetchAll(projectId: string, filters: Record<string, string | number | undefined> = {}): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const params = new URLSearchParams()
      Object.entries(filters).forEach(([k, v]) => {
        if (v !== undefined && v !== '') params.append(k, String(v))
      })
      const q = params.toString() ? `?${params.toString()}` : ''
      const { data } = await api.get<{ items: WorkPackage[]; total: number }>(`/pm/projects/${projectId}/work-packages${q}`)
      items.value = data.items
      total.value = data.total
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur'
    } finally {
      loading.value = false
    }
  }

  function _errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
  }

  async function fetchOne(projectId: string, id: string): Promise<WorkPackage | null> {
    try {
      const { data } = await api.get<WorkPackage>(`/pm/projects/${projectId}/work-packages/${id}`)
      currentWp.value = data
      return data
    } catch (err) {
      error.value = _errMsg(err)
      return null
    }
  }

  async function create(projectId: string, payload: CreateWpPayload): Promise<WorkPackage | null> {
    try {
      const { data } = await api.post<WorkPackage>(`/pm/projects/${projectId}/work-packages`, payload)
      items.value = [data, ...items.value]
      return data
    } catch (err) {
      error.value = _errMsg(err)
      return null
    }
  }

  async function update(projectId: string, id: string, payload: UpdateWpPayload): Promise<WorkPackage | null> {
    try {
      const { data } = await api.patch<WorkPackage>(`/pm/projects/${projectId}/work-packages/${id}`, payload)
      const idx = items.value.findIndex((w) => w.id === id)
      if (idx >= 0) items.value = [...items.value.slice(0, idx), data, ...items.value.slice(idx + 1)]
      if (currentWp.value?.id === id) currentWp.value = { ...currentWp.value, ...data }
      return data
    } catch (err) {
      error.value = _errMsg(err)
      return null
    }
  }

  async function remove(projectId: string, id: string): Promise<boolean> {
    try {
      await api.delete(`/pm/projects/${projectId}/work-packages/${id}`)
      items.value = items.value.filter((w) => w.id !== id)
      if (currentWp.value?.id === id) currentWp.value = null
      return true
    } catch (err) {
      error.value = _errMsg(err)
      return false
    }
  }

  async function moveCard(projectId: string, id: string, payload: { boardColumnId?: string | null; sprintId?: string | null; parentId?: string | null; position?: number }): Promise<boolean> {
    try {
      await api.patch(`/pm/projects/${projectId}/work-packages/${id}/move`, payload)
      return true
    } catch (err) {
      error.value = _errMsg(err)
      return false
    }
  }

  async function addWatcher(projectId: string, wpId: string, userId: string): Promise<boolean> {
    try {
      await api.post(`/pm/projects/${projectId}/work-packages/${wpId}/watchers`, { userId })
      return true
    } catch (err) {
      error.value = _errMsg(err)
      return false
    }
  }

  async function removeWatcher(projectId: string, wpId: string, userId: string): Promise<boolean> {
    try {
      await api.delete(`/pm/projects/${projectId}/work-packages/${wpId}/watchers/${userId}`)
      return true
    } catch (err) {
      error.value = _errMsg(err)
      return false
    }
  }

  async function addDependency(projectId: string, wpId: string, toWpId: string, type = 'relates'): Promise<boolean> {
    try {
      await api.post(`/pm/projects/${projectId}/work-packages/${wpId}/dependencies`, { toWpId, type })
      return true
    } catch (err) {
      error.value = _errMsg(err)
      return false
    }
  }

  async function removeDependency(projectId: string, wpId: string, depId: string): Promise<boolean> {
    try {
      await api.delete(`/pm/projects/${projectId}/work-packages/${wpId}/dependencies/${depId}`)
      return true
    } catch (err) {
      error.value = _errMsg(err)
      return false
    }
  }

  async function fetchCustomFields(projectId: string): Promise<void> {
    try {
      const { data } = await api.get<WorkPackageCustomField[]>(`/pm/projects/${projectId}/wp-custom-fields`)
      customFields.value = data
    } catch (err) {
      error.value = _errMsg(err)
      customFields.value = []
    }
  }

  async function createCustomField(projectId: string, name: string, fieldType: string, options?: string): Promise<void> {
    try {
      await api.post(`/pm/projects/${projectId}/wp-custom-fields`, { name, fieldType, options })
      await fetchCustomFields(projectId)
    } catch (err) {
      error.value = _errMsg(err)
      throw err
    }
  }

  async function deleteCustomField(projectId: string, id: string): Promise<void> {
    try {
      await api.delete(`/pm/projects/${projectId}/wp-custom-fields/${id}`)
      await fetchCustomFields(projectId)
    } catch (err) {
      error.value = _errMsg(err)
      throw err
    }
  }

  async function upsertCustomValues(projectId: string, wpId: string, values: { customFieldId: string; value?: string }[]): Promise<void> {
    try {
      await api.put(`/pm/projects/${projectId}/work-packages/${wpId}/custom-values`, { values })
    } catch (err) {
      error.value = _errMsg(err)
      throw err
    }
  }

  // ─── Logout reset ────────────────────────────────────────────────────────────

  function reset(): void {
    items.value = []
    total.value = 0
    currentWp.value = null
    customFields.value = []
    loading.value = false
    error.value = null
  }

  onLogout(reset)

  return {
    items, total, currentWp, customFields, loading, error,
    fetchAll, fetchOne, create, update, remove, moveCard,
    addWatcher, removeWatcher, addDependency, removeDependency,
    fetchCustomFields, createCustomField, deleteCustomField, upsertCustomValues,
    reset,
  }
})
