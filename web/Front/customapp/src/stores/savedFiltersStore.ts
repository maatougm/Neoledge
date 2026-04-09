/**
 * @file     savedFiltersStore.ts
 * @module   NeoLeadge — Deployment Manager
 * @desc     Pinia store for saved filters — immutable state updates
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import axios from 'axios'
import { useApp } from './useApp'
import type { SavedFilter, FilterCriteria } from '@/types/filter.types'

export const useSavedFiltersStore = defineStore('savedFilters', () => {
  // ─── State ───────────────────────────────────────────────────────────────────
  const filters = ref<SavedFilter[]>([])
  const activeFilter = ref<SavedFilter | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  // ─── Helpers ─────────────────────────────────────────────────────────────────
  const apiBase = () => useApp().apiUrl + '/api/saved-filters'
  const authHeader = () => {
    const jwt = useApp().jwt
    return jwt ? { Authorization: `Bearer ${jwt}` } : {}
  }

  // ─── Actions ─────────────────────────────────────────────────────────────────

  const fetchAll = async (): Promise<void> => {
    loading.value = true
    error.value = null
    try {
      const { data } = await axios.get<SavedFilter[]>(apiBase(), { headers: authHeader() })
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
      const { data } = await axios.post<SavedFilter>(
        apiBase(),
        { name, filters: criteria },
        { headers: authHeader() },
      )
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
      const { data } = await axios.put<SavedFilter>(`${apiBase()}/${id}`, dto, {
        headers: authHeader(),
      })
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
      await axios.delete(`${apiBase()}/${id}`, { headers: authHeader() })
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
      await axios.patch(`${apiBase()}/${id}/default`, {}, { headers: authHeader() })
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
  }
})
