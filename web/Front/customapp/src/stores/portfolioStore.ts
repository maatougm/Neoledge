/** @file src/stores/portfolioStore.ts — Portfolios + Versions */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/lib/api'
import { onLogout } from './logoutBus'

export interface Portfolio {
  id: string
  name: string
  description: string | null
  createdById: string
  createdAt: string
  _count?: { projects: number }
  projects?: Array<{ id: string; projectId: string; position: number; project: { id: string; name: string; status: string } }>
}

export interface Version {
  id: string
  projectId: string
  name: string
  description: string | null
  startDate: string | null
  endDate: string | null
  status: 'Open' | 'Locked' | 'Closed'
  position: number
  _count?: { workPackages: number }
}

export const usePortfolioStore = defineStore('portfolio', () => {
  const portfolios = ref<Portfolio[]>([])
  const currentPortfolio = ref<Portfolio | null>(null)
  const versions = ref<Version[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  function _errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
  }

  async function fetchAll() {
    loading.value = true
    error.value = null
    try {
      const { data } = await api.get<Portfolio[]>('/admin/portfolios')
      portfolios.value = data
    } catch (err) {
      error.value = _errMsg(err)
      console.error('[portfolioStore] fetchAll', err)
    } finally {
      loading.value = false
    }
  }

  async function fetchOne(id: string) {
    try {
      const { data } = await api.get<Portfolio>(`/admin/portfolios/${id}`)
      currentPortfolio.value = data
      return data
    } catch (err) {
      error.value = _errMsg(err)
      console.error('[portfolioStore] fetchOne', err)
      throw err
    }
  }

  async function create(payload: { name: string; description?: string }) {
    try {
      const { data } = await api.post<Portfolio>('/admin/portfolios', payload)
      portfolios.value = [data, ...portfolios.value]
      return data
    } catch (err) {
      error.value = _errMsg(err)
      console.error('[portfolioStore] create', err)
      throw err
    }
  }

  async function addProject(portfolioId: string, projectId: string) {
    try {
      await api.post(`/admin/portfolios/${portfolioId}/projects`, { projectId })
      await fetchOne(portfolioId)
    } catch (err) {
      error.value = _errMsg(err)
      console.error('[portfolioStore] addProject', err)
      throw err
    }
  }

  async function fetchVersions(projectId: string) {
    try {
      const { data } = await api.get<Version[]>(`/pm/projects/${projectId}/versions`)
      versions.value = data
    } catch (err) {
      error.value = _errMsg(err)
      console.error('[portfolioStore] fetchVersions', err)
      throw err
    }
  }

  async function createVersion(projectId: string, payload: { name: string; description?: string; startDate?: string; endDate?: string }) {
    try {
      const { data } = await api.post<Version>(`/pm/projects/${projectId}/versions`, payload)
      versions.value = [...versions.value, data]
      return data
    } catch (err) {
      error.value = _errMsg(err)
      console.error('[portfolioStore] createVersion', err)
      throw err
    }
  }

  async function updateVersion(projectId: string, id: string, payload: Partial<Version>) {
    try {
      const { data } = await api.patch<Version>(`/pm/projects/${projectId}/versions/${id}`, payload)
      const idx = versions.value.findIndex((v) => v.id === id)
      if (idx >= 0) versions.value = [...versions.value.slice(0, idx), data, ...versions.value.slice(idx + 1)]
      return data
    } catch (err) {
      error.value = _errMsg(err)
      console.error('[portfolioStore] updateVersion', err)
      throw err
    }
  }

  function reset(): void {
    portfolios.value = []
    currentPortfolio.value = null
    versions.value = []
    loading.value = false
    error.value = null
  }

  onLogout(reset)

  return { portfolios, currentPortfolio, versions, loading, error, fetchAll, fetchOne, create, addProject, fetchVersions, createVersion, updateVersion, reset }
})
