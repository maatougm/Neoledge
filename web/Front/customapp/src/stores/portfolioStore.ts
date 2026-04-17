/** @file src/stores/portfolioStore.ts — Portfolios + Versions */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/lib/api'

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

  async function fetchAll() {
    loading.value = true
    try {
      const { data } = await api.get<Portfolio[]>('/admin/portfolios')
      portfolios.value = data
    } finally {
      loading.value = false
    }
  }

  async function fetchOne(id: string) {
    const { data } = await api.get<Portfolio>(`/admin/portfolios/${id}`)
    currentPortfolio.value = data
    return data
  }

  async function create(payload: { name: string; description?: string }) {
    const { data } = await api.post<Portfolio>('/admin/portfolios', payload)
    portfolios.value = [data, ...portfolios.value]
    return data
  }

  async function addProject(portfolioId: string, projectId: string) {
    await api.post(`/admin/portfolios/${portfolioId}/projects`, { projectId })
    await fetchOne(portfolioId)
  }

  async function fetchVersions(projectId: string) {
    const { data } = await api.get<Version[]>(`/pm/projects/${projectId}/versions`)
    versions.value = data
  }

  async function createVersion(projectId: string, payload: { name: string; description?: string; startDate?: string; endDate?: string }) {
    const { data } = await api.post<Version>(`/pm/projects/${projectId}/versions`, payload)
    versions.value = [...versions.value, data]
    return data
  }

  async function updateVersion(projectId: string, id: string, payload: Partial<Version>) {
    const { data } = await api.patch<Version>(`/pm/projects/${projectId}/versions/${id}`, payload)
    const idx = versions.value.findIndex((v) => v.id === id)
    if (idx >= 0) versions.value = [...versions.value.slice(0, idx), data, ...versions.value.slice(idx + 1)]
    return data
  }

  return { portfolios, currentPortfolio, versions, loading, fetchAll, fetchOne, create, addProject, fetchVersions, createVersion, updateVersion }
})
