/** @file src/stores/timeStore.ts — Time entries + summaries */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/lib/api'
import { onLogout } from './logoutBus'

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
  const error = ref<string | null>(null)

  function _errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
  }

  async function fetchMy(filters: { from?: string; to?: string; projectId?: string; workPackageId?: string } = {}) {
    loading.value = true
    error.value = null
    try {
      const params = new URLSearchParams()
      Object.entries(filters).forEach(([k, v]) => v && params.append(k, v))
      const q = params.toString() ? `?${params.toString()}` : ''
      const { data } = await api.get<TimeEntry[]>(`/api/time-entries${q}`)
      myEntries.value = data
    } catch (err) {
      error.value = _errMsg(err)
    } finally {
      loading.value = false
    }
  }

  async function fetchProject(projectId: string, filters: { from?: string; to?: string; userId?: string } = {}) {
    try {
      const params = new URLSearchParams()
      Object.entries(filters).forEach(([k, v]) => v && params.append(k, v))
      const q = params.toString() ? `?${params.toString()}` : ''
      const { data } = await api.get<TimeEntry[]>(`/pm/projects/${projectId}/time-entries${q}`)
      projectEntries.value = data
    } catch (err) {
      error.value = _errMsg(err)
      throw err
    }
  }

  async function create(payload: { projectId: string; workPackageId?: string; hours: number; spentOn: string; activity?: string; comment?: string; isBillable?: boolean }) {
    try {
      const { data } = await api.post<TimeEntry>('/api/time-entries', payload)
      myEntries.value = [data, ...myEntries.value]
      return data
    } catch (err) {
      error.value = _errMsg(err)
      throw err
    }
  }

  async function update(id: string, payload: Partial<TimeEntry>) {
    try {
      const { data } = await api.patch<TimeEntry>(`/api/time-entries/${id}`, payload)
      const idx = myEntries.value.findIndex((e) => e.id === id)
      if (idx >= 0) myEntries.value = [...myEntries.value.slice(0, idx), data, ...myEntries.value.slice(idx + 1)]
      return data
    } catch (err) {
      error.value = _errMsg(err)
      throw err
    }
  }

  async function remove(id: string) {
    try {
      await api.delete(`/api/time-entries/${id}`)
      myEntries.value = myEntries.value.filter((e) => e.id !== id)
    } catch (err) {
      error.value = _errMsg(err)
      throw err
    }
  }

  async function fetchWeek(weekStart: string) {
    try {
      const { data } = await api.get<{ start: string; entries: TimeEntry[] }>(`/api/time-entries/week?weekStart=${weekStart}`)
      weekEntries.value = data.entries
    } catch (err) {
      error.value = _errMsg(err)
      throw err
    }
  }

  async function fetchSummary(projectId: string) {
    try {
      const { data } = await api.get<TimeSummary>(`/pm/projects/${projectId}/time-entries/summary`)
      summary.value = data
    } catch (err) {
      error.value = _errMsg(err)
      throw err
    }
  }

  function reset(): void {
    myEntries.value = []
    projectEntries.value = []
    weekEntries.value = []
    summary.value = null
    loading.value = false
    error.value = null
  }

  onLogout(reset)

  return { myEntries, projectEntries, weekEntries, summary, loading, error, fetchMy, fetchProject, create, update, remove, fetchWeek, fetchSummary, reset }
})
