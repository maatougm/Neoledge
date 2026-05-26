/** @file memberTasksStore.ts — paged Member tasks list with URL-synced filters. */

import { defineStore } from 'pinia'
import { ref, reactive } from 'vue'
import api from '@/lib/api'
import { onLogout } from './logoutBus'
import type { MemberTaskCard } from './memberDashboardStore'

export type TaskTab = 'todo' | 'review' | 'done' | 'all'

export interface MemberTasksFilters {
  tab: TaskTab
  projectId?: string
  sprintId?: string
  q?: string
}

export const useMemberTasksStore = defineStore('memberTasks', () => {
  const items = ref<MemberTaskCard[]>([])
  const total = ref(0)
  const filters = reactive<MemberTasksFilters>({ tab: 'todo' })
  const selectedIds = ref(new Set<string>())
  const loading = ref(false)
  const error = ref<string | null>(null)

  function setFilter<K extends keyof MemberTasksFilters>(key: K, value: MemberTasksFilters[K]): void {
    filters[key] = value
    selectedIds.value = new Set()
  }

  async function fetchAll(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      // The backend takes a single `status` query — for tabs that need multiple
      // statuses (todo: New + InProgress, done: Resolved + Closed) we fan out
      // and merge.
      let allItems: MemberTaskCard[] = []
      let totalCount = 0

      const statusesForTab = (() => {
        if (filters.tab === 'todo') return ['New', 'InProgress']
        if (filters.tab === 'done') return ['Resolved', 'Closed']
        if (filters.tab === 'review') return ['AwaitingReview']
        return [undefined]
      })()

      for (const s of statusesForTab) {
        const params = new URLSearchParams()
        if (s) params.set('status', s)
        if (filters.projectId) params.set('projectId', filters.projectId)
        if (filters.sprintId) params.set('sprintId', filters.sprintId)
        if (filters.q) params.set('q', filters.q)
        params.set('limit', '200')
        const { data } = await api.get<{ items: MemberTaskCard[]; total: number }>(
          `/pm/my-tasks?${params.toString()}`,
        )
        allItems = allItems.concat(data.items ?? [])
        totalCount += data.total ?? 0
      }

      // Stable order: due-asc → priority-desc → createdAt-desc.
      allItems.sort((a, b) => {
        const ad = a.dueDate ? new Date(a.dueDate).getTime() : Number.POSITIVE_INFINITY
        const bd = b.dueDate ? new Date(b.dueDate).getTime() : Number.POSITIVE_INFINITY
        if (ad !== bd) return ad - bd
        const PR: Record<string, number> = { Critical: 0, High: 1, Normal: 2, Low: 3 }
        const ap = PR[a.priority] ?? 2
        const bp = PR[b.priority] ?? 2
        return ap - bp
      })

      items.value = allItems
      total.value = totalCount
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Erreur de chargement.'
    } finally {
      loading.value = false
    }
  }

  function toggleSelect(id: string): void {
    const next = new Set(selectedIds.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selectedIds.value = next
  }
  function selectAllVisible(): void {
    selectedIds.value = new Set(items.value.map((i) => i.id))
  }
  function clearSelection(): void {
    selectedIds.value = new Set()
  }

  async function bulkTransition(newStatus: string): Promise<{ updated: number; failed: number }> {
    const ids = Array.from(selectedIds.value)
    if (ids.length === 0) return { updated: 0, failed: 0 }
    let updated = 0
    let failed = 0
    await Promise.all(
      ids.map(async (id) => {
        const task = items.value.find((t) => t.id === id)
        if (!task) return
        try {
          await api.patch(`/pm/projects/${task.project.id}/work-packages/${id}`, { status: newStatus })
          task.status = newStatus
          updated += 1
        } catch {
          failed += 1
        }
      }),
    )
    selectedIds.value = new Set()
    return { updated, failed }
  }

  async function transitionOne(id: string, newStatus: string): Promise<boolean> {
    const task = items.value.find((t) => t.id === id)
    if (!task) return false
    const before = task.status
    task.status = newStatus
    try {
      await api.patch(`/pm/projects/${task.project.id}/work-packages/${id}`, { status: newStatus })
      return true
    } catch {
      task.status = before
      return false
    }
  }

  function reset(): void {
    items.value = []
    total.value = 0
    filters.tab = 'todo'
    filters.projectId = undefined
    filters.sprintId = undefined
    filters.q = undefined
    selectedIds.value = new Set()
    loading.value = false
    error.value = null
  }
  onLogout(reset)

  return {
    items, total, filters, selectedIds, loading, error,
    setFilter, fetchAll,
    toggleSelect, selectAllVisible, clearSelection,
    bulkTransition, transitionOne,
    reset,
  }
})

