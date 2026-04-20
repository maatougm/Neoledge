/**
 * @file     savedFiltersStore.ts
 * @module   NeoLeadge — Deployment Manager
 * @desc     Pinia store for saved filters — immutable state updates
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/lib/api'
import { onLogout } from './logoutBus'
import type { SavedFilter, FilterCriteria } from '@/types/filter.types'

export const useSavedFiltersStore = defineStore('savedFilters', () => {
  // ─── State ───────────────────────────────────────────────────────────────────
  const filters = ref<SavedFilter[]>([])
  const activeFilter = ref<SavedFilter | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  // ─── Actions ─────────────────────────────────────────────────────────────────

  const fetchAll = async (): Promise<void> => {
    loading.value = true
    error.value = null
    try {
      const { data } = await api.get<SavedFilter[]>('/api/saved-filters')
      filters.value = [...data]
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors du chargement des filtres.'
    } finally {
      loading.value = false
    }
  }

  const create = async (name: string, criteria: FilterCriteria): Promise<SavedFilter | null> => {
    loading.value = true
    error.value = null
    try {
      const { data } = await api.post<SavedFilter>('/api/saved-filters', { name, filters: criteria })
      filters.value = [...filters.value, data]
      return data
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors de la création du filtre.'
      return null
    } finally {
      loading.value = false
    }
  }

  const update = async (
    id: string,
    dto: { name?: string; filters?: FilterCriteria; isDefault?: boolean },
  ): Promise<SavedFilter | null> => {
    loading.value = true
    error.value = null
    try {
      const { data } = await api.put<SavedFilter>(`/api/saved-filters/${id}`, dto)
      filters.value = filters.value.map((f) => (f.id === id ? { ...data } : f))
      if (activeFilter.value?.id === id) {
        activeFilter.value = { ...data }
      }
      return data
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors de la mise à jour du filtre.'
      return null
    } finally {
      loading.value = false
    }
  }

  const remove = async (id: string): Promise<void> => {
    loading.value = true
    error.value = null
    try {
      await api.delete(`/api/saved-filters/${id}`)
      filters.value = filters.value.filter((f) => f.id !== id)
      if (activeFilter.value?.id === id) {
        activeFilter.value = null
      }
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors de la suppression du filtre.'
    } finally {
      loading.value = false
    }
  }

  const setDefault = async (id: string): Promise<void> => {
    loading.value = true
    error.value = null
    try {
      await api.patch(`/api/saved-filters/${id}/default`, {})
      filters.value = filters.value.map((f) => ({ ...f, isDefault: f.id === id }))
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur lors de la définition du filtre par défaut.'
    } finally {
      loading.value = false
    }
  }

  const applyFilter = (filter: SavedFilter): void => {
    activeFilter.value = { ...filter }
  }

  const clearActiveFilter = (): void => {
    activeFilter.value = null
  }

  const reset = (): void => {
    filters.value = []
    activeFilter.value = null
    loading.value = false
    error.value = null
  }

  onLogout(reset)

  return {
    filters,
    activeFilter,
    loading,
    error,
    fetchAll,
    create,
    update,
    remove,
    setDefault,
    applyFilter,
    clearActiveFilter,
    reset,
  }
})
