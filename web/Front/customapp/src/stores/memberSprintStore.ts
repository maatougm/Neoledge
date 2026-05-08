/** @file memberSprintStore.ts — backs MemberSprintView (single sprint detail). */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/lib/api'
import { onLogout } from './logoutBus'
import type { MemberTaskCard } from './memberDashboardStore'

interface SprintDetail {
  id: string
  name: string
  goal: string | null
  status: string
  startDate: string
  endDate: string
}

interface TeammateBucket {
  userId: string
  fullName: string
  count: number
}

export const useMemberSprintStore = defineStore('memberSprint', () => {
  const sprint = ref<SprintDetail | null>(null)
  const myTasks = ref<MemberTaskCard[]>([])
  const teammates = ref<TeammateBucket[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function load(projectId: string, sprintId: string, currentUserId: string): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const [allWpsRes] = await Promise.all([
        api.get<{ items: Array<MemberTaskCard & { assigneeId: string | null; assignee?: { firstName?: string; lastName?: string } | null }> }>(
          `/pm/projects/${projectId}/work-packages?sprintId=${sprintId}&limit=200`,
        ),
      ])
      const allWps = allWpsRes.data.items ?? []

      // Resolve sprint metadata from the first WP's sprint relation
      // (saves us from another endpoint round-trip).
      const sprintMeta = (allWps.find((w) => w.sprint)?.sprint ?? null) as SprintDetail | null
      sprint.value = sprintMeta

      myTasks.value = allWps.filter((w) => w.assigneeId === currentUserId)

      // Teammates count (excluding caller).
      const buckets = new Map<string, TeammateBucket>()
      for (const w of allWps) {
        if (!w.assigneeId || w.assigneeId === currentUserId) continue
        const existing = buckets.get(w.assigneeId)
        const fullName = `${w.assignee?.firstName ?? ''} ${w.assignee?.lastName ?? ''}`.trim() || 'Coéquipier'
        if (existing) existing.count += 1
        else buckets.set(w.assigneeId, { userId: w.assigneeId, fullName, count: 1 })
      }
      teammates.value = Array.from(buckets.values()).sort((a, b) => b.count - a.count)
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur de chargement.'
    } finally {
      loading.value = false
    }
  }

  async function transition(projectId: string, wpId: string, newStatus: string): Promise<boolean> {
    const task = myTasks.value.find((t) => t.id === wpId)
    if (!task) return false
    const before = task.status
    task.status = newStatus
    try {
      await api.patch(`/pm/projects/${projectId}/work-packages/${wpId}`, { status: newStatus })
      return true
    } catch {
      task.status = before
      return false
    }
  }

  function reset(): void {
    sprint.value = null
    myTasks.value = []
    teammates.value = []
    loading.value = false
    error.value = null
  }
  onLogout(reset)

  return { sprint, myTasks, teammates, loading, error, load, transition, reset }
})
