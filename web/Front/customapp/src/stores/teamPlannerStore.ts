/** @file src/stores/teamPlannerStore.ts — Team capacity + assignments + conflicts */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/lib/api'
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

export const useTeamPlannerStore = defineStore('teamPlanner', () => {
  const assignments = ref<UserAssignments[]>([])
  const capacity = ref<UserCapacity[]>([])
  const conflicts = ref<{ userId: string; wp1: WorkPackage; wp2: WorkPackage }[]>([])
  const loading = ref(false)

  async function fetchAssignments(from: string, to: string, userIds: string[] = [], projectIds: string[] = []) {
    loading.value = true
    try {
      const params = new URLSearchParams({ from, to })
      if (userIds.length) params.append('userIds', userIds.join(','))
      if (projectIds.length) params.append('projectIds', projectIds.join(','))
      const { data } = await api.get<UserAssignments[]>(`/pm/team-planner?${params.toString()}`)
      assignments.value = data
    } finally {
      loading.value = false
    }
  }

  async function fetchCapacity(from: string, to: string) {
    const { data } = await api.get<UserCapacity[]>(`/pm/team-planner/capacity?from=${from}&to=${to}`)
    capacity.value = data
  }

  async function fetchConflicts(from: string, to: string) {
    const { data } = await api.get<typeof conflicts.value>(`/pm/team-planner/conflicts?from=${from}&to=${to}`)
    conflicts.value = data
  }

  async function reassign(wpId: string, assigneeId: string, startDate?: string, dueDate?: string) {
    await api.patch(`/pm/team-planner/work-packages/${wpId}/reassign`, { assigneeId, startDate, dueDate })
  }

  return { assignments, capacity, conflicts, loading, fetchAssignments, fetchCapacity, fetchConflicts, reassign }
})
