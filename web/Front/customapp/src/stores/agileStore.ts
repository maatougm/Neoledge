/** @file src/stores/agileStore.ts — Boards, Sprints, Burndown */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/lib/api'
import { onLogout } from './logoutBus'
import type { WorkPackage } from '@/types/work-package.types'

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
  const error = ref<string | null>(null)

  function _errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
  }

  async function fetchBoards(projectId: string) {
    loading.value = true
    error.value = null
    try {
      const { data } = await api.get<Board[]>(`/pm/projects/${projectId}/boards`)
      boards.value = data
    } catch (err) {
      error.value = _errMsg(err)
    } finally {
      loading.value = false
    }
  }

  async function fetchBoard(projectId: string, boardId: string) {
    try {
      const { data } = await api.get<Board>(`/pm/projects/${projectId}/boards/${boardId}`)
      currentBoard.value = data
      return data
    } catch (err) {
      error.value = _errMsg(err)
      throw err
    }
  }

  async function createBoard(projectId: string, payload: { name: string; type?: string; isDefault?: boolean }) {
    try {
      const { data } = await api.post<Board>(`/pm/projects/${projectId}/boards`, payload)
      boards.value = [...boards.value, data]
      return data
    } catch (err) {
      error.value = _errMsg(err)
      throw err
    }
  }

  async function createColumn(projectId: string, boardId: string, payload: { name: string; wipLimit?: number; mapStatus?: string }) {
    try {
      const { data } = await api.post<BoardColumn>(`/pm/projects/${projectId}/boards/${boardId}/columns`, payload)
      return data
    } catch (err) {
      error.value = _errMsg(err)
      throw err
    }
  }

  async function moveCard(projectId: string, boardId: string, wpId: string, columnId: string | null, position = 0) {
    try {
      await api.patch(`/pm/projects/${projectId}/boards/${boardId}/cards/${wpId}/move`, { columnId, position })
    } catch (err) {
      error.value = _errMsg(err)
      throw err
    }
  }

  async function fetchSprints(projectId: string, boardId: string) {
    try {
      const { data } = await api.get<Sprint[]>(`/pm/projects/${projectId}/boards/${boardId}/sprints`)
      sprints.value = data
      return data
    } catch (err) {
      error.value = _errMsg(err)
      throw err
    }
  }

  async function createSprint(projectId: string, boardId: string, payload: { name: string; startDate: string; endDate: string; goal?: string; capacity?: number }) {
    try {
      const { data } = await api.post<Sprint>(`/pm/projects/${projectId}/boards/${boardId}/sprints`, payload)
      sprints.value = [data, ...sprints.value]
      return data
    } catch (err) {
      error.value = _errMsg(err)
      throw err
    }
  }

  async function startSprint(projectId: string, sprintId: string) {
    try {
      const { data } = await api.post<Sprint>(`/pm/projects/${projectId}/sprints/${sprintId}/start`)
      const idx = sprints.value.findIndex((s) => s.id === sprintId)
      if (idx >= 0) sprints.value = [...sprints.value.slice(0, idx), data, ...sprints.value.slice(idx + 1)]
      return data
    } catch (err) {
      error.value = _errMsg(err)
      throw err
    }
  }

  async function closeSprint(projectId: string, sprintId: string) {
    try {
      const { data } = await api.post<Sprint>(`/pm/projects/${projectId}/sprints/${sprintId}/close`)
      const idx = sprints.value.findIndex((s) => s.id === sprintId)
      if (idx >= 0) sprints.value = [...sprints.value.slice(0, idx), data, ...sprints.value.slice(idx + 1)]
      return data
    } catch (err) {
      error.value = _errMsg(err)
      throw err
    }
  }

  async function addWpsToSprint(projectId: string, sprintId: string, workPackageIds: string[]) {
    try {
      await api.post(`/pm/projects/${projectId}/sprints/${sprintId}/work-packages`, { workPackageIds })
    } catch (err) {
      error.value = _errMsg(err)
      throw err
    }
  }

  async function fetchBurndown(projectId: string, sprintId: string) {
    try {
      const { data } = await api.get<{ sprint: Sprint; days: { date: string; ideal: number; remaining: number }[] }>(`/pm/projects/${projectId}/sprints/${sprintId}/burndown`)
      burndown.value = data
    } catch (err) {
      error.value = _errMsg(err)
      throw err
    }
  }

  // ─── Logout reset ────────────────────────────────────────────────────────────

  function reset(): void {
    boards.value = []
    currentBoard.value = null
    sprints.value = []
    currentSprint.value = null
    burndown.value = null
    loading.value = false
    error.value = null
  }

  onLogout(reset)

  return {
    boards, currentBoard, sprints, currentSprint, burndown, loading, error,
    fetchBoards, fetchBoard, createBoard, createColumn, moveCard,
    fetchSprints, createSprint, startSprint, closeSprint, addWpsToSprint, fetchBurndown,
    reset,
  }
})
