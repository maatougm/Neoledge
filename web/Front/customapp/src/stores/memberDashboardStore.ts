/** @file memberDashboardStore.ts — Pinia store backing MemberDashboardView. */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/lib/api'
import { onLogout } from './logoutBus'

export interface MemberTaskCard {
  id: string
  title: string
  status: string
  priority: string
  type: string
  dueDate: string | null
  estimatedHours: number | null
  project: { id: string; name: string }
  sprint: { id: string; name: string } | null
}

export interface MemberSprintCard {
  projectId: string
  projectName: string
  sprint: {
    id: string
    name: string
    goal: string | null
    status: 'Active' | 'Planning' | 'Closed' | 'Cancelled'
    startDate: string
    endDate: string
  }
  myTaskCount: number
}

export interface MemberProjectCard {
  id: string
  name: string
  clientName: string
  status: string
  startDate: string
  endDate: string
  activeSprint: { id: string; name: string; goal: string | null; endDate: string } | null
  myInProgressCount: number
}

export interface WeeklyTotals {
  weekStart: string
  totalHours: number
  byDay: Array<{ date: string; hours: number }>
}

export const useMemberDashboardStore = defineStore('memberDashboard', () => {
  const todayTasks = ref<MemberTaskCard[]>([])
  const activeSprints = ref<MemberSprintCard[]>([])
  const myProjects = ref<MemberProjectCard[]>([])
  const weeklyTotals = ref<WeeklyTotals | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  /** Monday-of-this-week as YYYY-MM-DD in local time. */
  function currentWeekStart(): string {
    const d = new Date()
    const day = d.getDay() // Sunday=0 ... Saturday=6
    const offset = day === 0 ? -6 : 1 - day // shift back to Monday
    d.setDate(d.getDate() + offset)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${dd}`
  }

  async function fetchAll(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const weekStart = currentWeekStart()
      const [tasksRes, sprintsRes, projectsRes, weekRes] = await Promise.all([
        api.get<{ items: MemberTaskCard[] }>('/pm/my-tasks/today'),
        api.get<{ items: MemberSprintCard[] }>('/pm/my-sprints'),
        api.get<{ items: MemberProjectCard[] }>('/pm/my-projects'),
        api
          .get<WeeklyTotals>(`/api/time-entries/week?weekStart=${weekStart}`)
          .catch(() => ({ data: null as WeeklyTotals | null })),
      ])
      todayTasks.value = tasksRes.data.items ?? []
      activeSprints.value = sprintsRes.data.items ?? []
      myProjects.value = projectsRes.data.items ?? []
      weeklyTotals.value = weekRes && 'data' in weekRes ? weekRes.data : null
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur de chargement.'
    } finally {
      loading.value = false
    }
  }

  /**
   * Optimistic status transition. The caller's UI updates immediately,
   * the server is hit, and on failure we re-fetch to refresh the source
   * of truth.
   */
  async function transitionTask(task: MemberTaskCard, newStatus: string): Promise<boolean> {
    const before = task.status
    task.status = newStatus
    try {
      await api.patch(`/pm/projects/${task.project.id}/work-packages/${task.id}`, { status: newStatus })
      // Drop the task from "today" if it transitioned to a closed state.
      if (newStatus === 'Resolved' || newStatus === 'Closed') {
        todayTasks.value = todayTasks.value.filter((t) => t.id !== task.id)
      }
      return true
    } catch {
      task.status = before
      return false
    }
  }

  function reset(): void {
    todayTasks.value = []
    activeSprints.value = []
    myProjects.value = []
    weeklyTotals.value = null
    loading.value = false
    error.value = null
  }
  onLogout(reset)

  return { todayTasks, activeSprints, myProjects, weeklyTotals, loading, error, fetchAll, transitionTask, reset }
})
