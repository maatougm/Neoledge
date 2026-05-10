/** @file src/stores/ganttStore.ts — Gantt chart + milestones + baselines */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/lib/api'
import { onLogout } from './logoutBus'
import type { WorkPackage } from '@/types/work-package.types'

export interface Milestone {
  id: string
  projectId: string
  workPackageId: string | null
  title: string
  description: string | null
  date: string
  isReached: boolean
  color: string | null
  position: number
}

export interface Baseline {
  snapshotName: string
  capturedAt: string
  wpCount: number
}

export const useGanttStore = defineStore('gantt', () => {
  const workPackages = ref<WorkPackage[]>([])
  const milestones = ref<Milestone[]>([])
  const dependencies = ref<{ fromWpId: string; toWpId: string; type: string }[]>([])
  const baselines = ref<Baseline[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  function _errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
  }

  async function fetchGantt(projectId: string) {
    loading.value = true
    error.value = null
    try {
      const { data } = await api.get<{ workPackages: WorkPackage[]; milestones: Milestone[]; dependencies: typeof dependencies.value }>(`/pm/projects/${projectId}/gantt`)
      workPackages.value = data.workPackages
      milestones.value = data.milestones
      dependencies.value = data.dependencies
    } catch (err) {
      error.value = _errMsg(err)
    } finally {
      loading.value = false
    }
  }

  async function createMilestone(projectId: string, payload: { title: string; date: string; description?: string; color?: string; workPackageId?: string }) {
    try {
      const { data } = await api.post<Milestone>(`/pm/projects/${projectId}/milestones`, payload)
      milestones.value = [...milestones.value, data]
      return data
    } catch (err) {
      error.value = _errMsg(err)
      throw err
    }
  }

  async function updateMilestone(projectId: string, id: string, payload: Partial<Milestone>) {
    try {
      const { data } = await api.patch<Milestone>(`/pm/projects/${projectId}/milestones/${id}`, payload)
      const idx = milestones.value.findIndex((m) => m.id === id)
      if (idx >= 0) milestones.value = [...milestones.value.slice(0, idx), data, ...milestones.value.slice(idx + 1)]
      return data
    } catch (err) {
      error.value = _errMsg(err)
      throw err
    }
  }

  async function deleteMilestone(projectId: string, id: string) {
    try {
      await api.delete(`/pm/projects/${projectId}/milestones/${id}`)
      milestones.value = milestones.value.filter((m) => m.id !== id)
    } catch (err) {
      error.value = _errMsg(err)
      throw err
    }
  }

  async function fetchBaselines(projectId: string) {
    try {
      const { data } = await api.get<Baseline[]>(`/pm/projects/${projectId}/baselines`)
      baselines.value = data
    } catch (err) {
      error.value = _errMsg(err)
      throw err
    }
  }

  async function captureBaseline(projectId: string, snapshotName: string) {
    try {
      const { data } = await api.post<{ snapshotName: string; count: number }>(`/pm/projects/${projectId}/baselines`, { snapshotName })
      await fetchBaselines(projectId)
      return data
    } catch (err) {
      error.value = _errMsg(err)
      throw err
    }
  }

  async function compareBaseline(projectId: string, snapshotName: string) {
    try {
      const { data } = await api.get(`/pm/projects/${projectId}/baselines/${snapshotName}/compare`)
      return data
    } catch (err) {
      error.value = _errMsg(err)
      throw err
    }
  }

  /**
   * Optimistic in-place patch of a workPackage by id.
   * Used by GanttView during drag — replaces the array slot with a new
   * spread copy so reactivity tracks the change without the component
   * mutating the store directly.
   */
  function patchWorkPackage(id: string, patch: Partial<WorkPackage>): void {
    const idx = workPackages.value.findIndex((w) => w.id === id)
    if (idx < 0) return
    const next = workPackages.value.slice()
    next[idx] = { ...next[idx], ...patch }
    workPackages.value = next
  }

  // ─── Logout reset ────────────────────────────────────────────────────────────

  function reset(): void {
    workPackages.value = []
    milestones.value = []
    dependencies.value = []
    baselines.value = []
    loading.value = false
    error.value = null
  }

  onLogout(reset)

  return {
    workPackages, milestones, dependencies, baselines, loading, error,
    fetchGantt, createMilestone, updateMilestone, deleteMilestone,
    fetchBaselines, captureBaseline, compareBaseline,
    patchWorkPackage,
    reset,
  }
})
