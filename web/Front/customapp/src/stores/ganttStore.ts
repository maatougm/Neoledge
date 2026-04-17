/** @file src/stores/ganttStore.ts — Gantt chart + milestones + baselines */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/lib/api'
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

  async function fetchGantt(projectId: string) {
    loading.value = true
    try {
      const { data } = await api.get<{ workPackages: WorkPackage[]; milestones: Milestone[]; dependencies: typeof dependencies.value }>(`/pm/projects/${projectId}/gantt`)
      workPackages.value = data.workPackages
      milestones.value = data.milestones
      dependencies.value = data.dependencies
    } finally {
      loading.value = false
    }
  }

  async function createMilestone(projectId: string, payload: { title: string; date: string; description?: string; color?: string; workPackageId?: string }) {
    const { data } = await api.post<Milestone>(`/pm/projects/${projectId}/milestones`, payload)
    milestones.value = [...milestones.value, data]
    return data
  }

  async function updateMilestone(projectId: string, id: string, payload: Partial<Milestone>) {
    const { data } = await api.patch<Milestone>(`/pm/projects/${projectId}/milestones/${id}`, payload)
    const idx = milestones.value.findIndex((m) => m.id === id)
    if (idx >= 0) milestones.value = [...milestones.value.slice(0, idx), data, ...milestones.value.slice(idx + 1)]
    return data
  }

  async function deleteMilestone(projectId: string, id: string) {
    await api.delete(`/pm/projects/${projectId}/milestones/${id}`)
    milestones.value = milestones.value.filter((m) => m.id !== id)
  }

  async function fetchBaselines(projectId: string) {
    const { data } = await api.get<Baseline[]>(`/pm/projects/${projectId}/baselines`)
    baselines.value = data
  }

  async function captureBaseline(projectId: string, snapshotName: string) {
    const { data } = await api.post<{ snapshotName: string; count: number }>(`/pm/projects/${projectId}/baselines`, { snapshotName })
    await fetchBaselines(projectId)
    return data
  }

  async function compareBaseline(projectId: string, snapshotName: string) {
    const { data } = await api.get(`/pm/projects/${projectId}/baselines/${snapshotName}/compare`)
    return data
  }

  return {
    workPackages, milestones, dependencies, baselines, loading,
    fetchGantt, createMilestone, updateMilestone, deleteMilestone,
    fetchBaselines, captureBaseline, compareBaseline,
  }
})
