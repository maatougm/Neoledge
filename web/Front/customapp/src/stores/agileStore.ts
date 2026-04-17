/** @file src/stores/agileStore.ts — Boards, Sprints, Burndown */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/lib/api'
import type { WorkPackage, UserSummary } from '@/types/work-package.types'

export interface BoardColumn {
  id: string
  boardId: string
  name: string
  position: number
  wipLimit: number | null
  mapStatus: string | null
  workPackages?: WorkPackage[]
}

export interface Board {
  id: string
  projectId: string
  name: string
  type: string
  isDefault: boolean
  columns?: BoardColumn[]
  _count?: { columns: number; sprints: number }
}

export interface Sprint {
  id: string
  boardId: string
  name: string
  goal: string | null
  startDate: string
  endDate: string
  status: 'Planning' | 'Active' | 'Closed'
  capacity: number | null
  _count?: { workPackages: number }
}

export const useAgileStore = defineStore('agile', () => {
  const boards = ref<Board[]>([])
  const currentBoard = ref<Board | null>(null)
  const sprints = ref<Sprint[]>([])
  const currentSprint = ref<Sprint | null>(null)
  const burndown = ref<{ sprint: Sprint; days: { date: string; ideal: number; remaining: number }[] } | null>(null)
  const loading = ref(false)

  async function fetchBoards(projectId: string) {
    loading.value = true
    try {
      const { data } = await api.get<Board[]>(`/pm/projects/${projectId}/boards`)
      boards.value = data
    } finally {
      loading.value = false
    }
  }

  async function fetchBoard(projectId: string, boardId: string) {
    const { data } = await api.get<Board>(`/pm/projects/${projectId}/boards/${boardId}`)
    currentBoard.value = data
    return data
  }

  async function createBoard(projectId: string, payload: { name: string; type?: string; isDefault?: boolean }) {
    const { data } = await api.post<Board>(`/pm/projects/${projectId}/boards`, payload)
    boards.value = [...boards.value, data]
    return data
  }

  async function createColumn(projectId: string, boardId: string, payload: { name: string; wipLimit?: number; mapStatus?: string }) {
    const { data } = await api.post<BoardColumn>(`/pm/projects/${projectId}/boards/${boardId}/columns`, payload)
    return data
  }

  async function moveCard(projectId: string, boardId: string, wpId: string, columnId: string | null, position = 0) {
    await api.patch(`/pm/projects/${projectId}/boards/${boardId}/cards/${wpId}/move`, { columnId, position })
  }

  async function fetchSprints(projectId: string, boardId: string) {
    const { data } = await api.get<Sprint[]>(`/pm/projects/${projectId}/boards/${boardId}/sprints`)
    sprints.value = data
    return data
  }

  async function createSprint(projectId: string, boardId: string, payload: { name: string; startDate: string; endDate: string; goal?: string; capacity?: number }) {
    const { data } = await api.post<Sprint>(`/pm/projects/${projectId}/boards/${boardId}/sprints`, payload)
    sprints.value = [data, ...sprints.value]
    return data
  }

  async function startSprint(projectId: string, sprintId: string) {
    const { data } = await api.post<Sprint>(`/pm/projects/${projectId}/sprints/${sprintId}/start`)
    const idx = sprints.value.findIndex((s) => s.id === sprintId)
    if (idx >= 0) sprints.value = [...sprints.value.slice(0, idx), data, ...sprints.value.slice(idx + 1)]
    return data
  }

  async function closeSprint(projectId: string, sprintId: string) {
    const { data } = await api.post<Sprint>(`/pm/projects/${projectId}/sprints/${sprintId}/close`)
    const idx = sprints.value.findIndex((s) => s.id === sprintId)
    if (idx >= 0) sprints.value = [...sprints.value.slice(0, idx), data, ...sprints.value.slice(idx + 1)]
    return data
  }

  async function addWpsToSprint(projectId: string, sprintId: string, workPackageIds: string[]) {
    await api.post(`/pm/projects/${projectId}/sprints/${sprintId}/work-packages`, { workPackageIds })
  }

  async function fetchBurndown(projectId: string, sprintId: string) {
    const { data } = await api.get(`/pm/projects/${projectId}/sprints/${sprintId}/burndown`)
    burndown.value = data as typeof burndown.value
  }

  return {
    boards, currentBoard, sprints, currentSprint, burndown, loading,
    fetchBoards, fetchBoard, createBoard, createColumn, moveCard,
    fetchSprints, createSprint, startSprint, closeSprint, addWpsToSprint, fetchBurndown,
  }
})
