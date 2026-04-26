/** @file src/stores/teamPlannerStore.ts — Team capacity + assignments + conflicts */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/lib/api'
import { onLogout } from './logoutBus'
import type { WorkPackage, UserSummary } from '@/types/work-package.types'

export interface UserCapacity {
  user: UserSummary
  capacityHours: number
  allocatedHours: number
  utilizationPercent: number
}

export interface UserAssignments {
  user: UserSummary
  items: WorkPackage[]
}

export type ConflictRow = { userId: string; wp1: WorkPackage; wp2: WorkPackage }

export const useTeamPlannerStore = defineStore('teamPlanner', () => {
  const assignments = ref<UserAssignments[]>([])
  const capacity = ref<UserCapacity[]>([])
  const conflicts = ref<ConflictRow[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  function _errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
  }

  async function fetchAssignments(from: string, to: string, userIds: string[] = [], projectIds: string[] = []) {
    loading.value = true
    error.value = null
    try {
      const params = new URLSearchParams({ from, to })
      if (userIds.length) params.append('userIds', userIds.join(','))
      if (projectIds.length) params.append('projectIds', projectIds.join(','))
      const { data } = await api.get<UserAssignments[]>(`/pm/team-planner?${params.toString()}`)
      assignments.value = data
    } catch (err) {
      error.value = _errMsg(err)
    } finally {
      loading.value = false
    }
  }

  async function fetchCapacity(from: string, to: string) {
    try {
      const { data } = await api.get<UserCapacity[]>(`/pm/team-planner/capacity?from=${from}&to=${to}`)
      capacity.value = data
    } catch (err) {
      error.value = _errMsg(err)
      throw err
    }
  }

  async function fetchConflicts(from: string, to: string) {
    try {
      const { data } = await api.get<ConflictRow[]>(`/pm/team-planner/conflicts?from=${from}&to=${to}`)
      conflicts.value = data
    } catch (err) {
      error.value = _errMsg(err)
      throw err
    }
  }

  async function reassign(wpId: string, assigneeId: string, startDate?: string, dueDate?: string) {
    try {
      await api.patch(`/pm/team-planner/work-packages/${wpId}/reassign`, { assigneeId, startDate, dueDate })
    } catch (err) {
      error.value = _errMsg(err)
      throw err
    }
  }

  function reset(): void {
    assignments.value = []
    capacity.value = []
    conflicts.value = []
    loading.value = false
    error.value = null
  }

  onLogout(reset)

  return { assignments, capacity, conflicts, loading, error, fetchAssignments, fetchCapacity, fetchConflicts, reassign, reset }
})
