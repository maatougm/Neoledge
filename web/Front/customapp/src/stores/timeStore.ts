/** @file src/stores/timeStore.ts — Time entries + summaries */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/lib/api'

export interface TimeEntry {
  id: string
  userId: string
  projectId: string
  workPackageId: string | null
  hours: number
  spentOn: string
  activity: string
  comment: string | null
  isBillable: boolean
  lockedAt: string | null
  createdAt: string
  updatedAt: string
  project?: { id: string; name: string }
  workPackage?: { id: string; title: string }
  user?: { id: string; firstName: string; lastName: string }
}

export interface TimeSummary {
  total: number
  byUser: { userId: string; name: string; hours: number }[]
  byActivity: { activity: string; hours: number }[]
}

export const useTimeStore = defineStore('time', () => {
  const myEntries = ref<TimeEntry[]>([])
  const projectEntries = ref<TimeEntry[]>([])
  const weekEntries = ref<TimeEntry[]>([])
  const summary = ref<TimeSummary | null>(null)
  const loading = ref(false)

  async function fetchMy(filters: { from?: string; to?: string; projectId?: string; workPackageId?: string } = {}) {
    loading.value = true
    try {
      const params = new URLSearchParams()
      Object.entries(filters).forEach(([k, v]) => v && params.append(k, v))
      const q = params.toString() ? `?${params.toString()}` : ''
      const { data } = await api.get<TimeEntry[]>(`/api/time-entries${q}`)
      myEntries.value = data
    } finally {
      loading.value = false
    }
  }

  async function fetchProject(projectId: string, filters: { from?: string; to?: string; userId?: string } = {}) {
    const params = new URLSearchParams()
    Object.entries(filters).forEach(([k, v]) => v && params.append(k, v))
    const q = params.toString() ? `?${params.toString()}` : ''
    const { data } = await api.get<TimeEntry[]>(`/pm/projects/${projectId}/time-entries${q}`)
    projectEntries.value = data
  }

  async function create(payload: { projectId: string; workPackageId?: string; hours: number; spentOn: string; activity?: string; comment?: string; isBillable?: boolean }) {
    const { data } = await api.post<TimeEntry>('/api/time-entries', payload)
    myEntries.value = [data, ...myEntries.value]
    return data
  }

  async function update(id: string, payload: Partial<TimeEntry>) {
    const { data } = await api.patch<TimeEntry>(`/api/time-entries/${id}`, payload)
    const idx = myEntries.value.findIndex((e) => e.id === id)
    if (idx >= 0) myEntries.value = [...myEntries.value.slice(0, idx), data, ...myEntries.value.slice(idx + 1)]
    return data
  }

  async function remove(id: string) {
    await api.delete(`/api/time-entries/${id}`)
    myEntries.value = myEntries.value.filter((e) => e.id !== id)
  }

  async function fetchWeek(weekStart: string) {
    const { data } = await api.get<{ start: string; entries: TimeEntry[] }>(`/api/time-entries/week?weekStart=${weekStart}`)
    weekEntries.value = data.entries
  }

  async function fetchSummary(projectId: string) {
    const { data } = await api.get<TimeSummary>(`/pm/projects/${projectId}/time-entries/summary`)
    summary.value = data
  }

  return { myEntries, projectEntries, weekEntries, summary, loading, fetchMy, fetchProject, create, update, remove, fetchWeek, fetchSummary }
})
