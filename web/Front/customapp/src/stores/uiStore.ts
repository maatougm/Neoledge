/** @file src/stores/uiStore.ts — Pinia store for UI state (sidebar, recents, pinned projects) */

import { defineStore } from 'pinia'
import { ref } from 'vue'

const STORAGE_KEY_PINNED        = 'nl_sidebar_pinned'
const STORAGE_KEY_RECENTS       = 'nl_recent_projects'
const STORAGE_KEY_PINNED_PROJS  = 'nl_pinned_projects'
const MAX_RECENTS = 5

export interface RecentProject {
  id: string
  name: string
  clientName?: string | null
  visitedAt: number
}

export const useUiStore = defineStore('ui', () => {
  // ── State ────────────────────────────────────────────────────────────────────
  // Sidebar defaults to PINNED (expanded) so first-time users see nav labels.
  const sidebarPinned = ref<boolean>(true)

  const recentProjects = ref<RecentProject[]>([])
  const pinnedProjectIds = ref<string[]>([])

  // ── Actions ──────────────────────────────────────────────────────────────────

  /** Load persisted UI preferences from localStorage. Call once on app mount. */
  const init = (): void => {
    const storedPinned = localStorage.getItem(STORAGE_KEY_PINNED)
    // Preserve prior preference; default to true (expanded) when absent.
    sidebarPinned.value = storedPinned === null ? true : storedPinned === 'true'

    try {
      const rawRecents = localStorage.getItem(STORAGE_KEY_RECENTS)
      if (rawRecents) recentProjects.value = JSON.parse(rawRecents) as RecentProject[]
    } catch { recentProjects.value = [] }

    try {
      const rawPinned = localStorage.getItem(STORAGE_KEY_PINNED_PROJS)
      if (rawPinned) pinnedProjectIds.value = JSON.parse(rawPinned) as string[]
    } catch { pinnedProjectIds.value = [] }
  }

  /** Toggle the sidebar pinned (always-expanded) state and persist it. */
  const toggleSidebarPinned = (): void => {
    sidebarPinned.value = !sidebarPinned.value
    localStorage.setItem(STORAGE_KEY_PINNED, String(sidebarPinned.value))
  }

  /** Explicitly set the pinned state (e.g. from keyboard shortcut). */
  const setSidebarPinned = (value: boolean): void => {
    sidebarPinned.value = value
    localStorage.setItem(STORAGE_KEY_PINNED, String(value))
  }

  /** Record a project visit — prepended to recents, capped at MAX_RECENTS. */
  const trackProjectVisit = (proj: Omit<RecentProject, 'visitedAt'>): void => {
    const now = Date.now()
    const next: RecentProject[] = [
      { ...proj, visitedAt: now },
      ...recentProjects.value.filter((r) => r.id !== proj.id),
    ].slice(0, MAX_RECENTS)
    recentProjects.value = next
    localStorage.setItem(STORAGE_KEY_RECENTS, JSON.stringify(next))
  }

  const isProjectPinned = (id: string): boolean => pinnedProjectIds.value.includes(id)

  const togglePinnedProject = (id: string): void => {
    const next = isProjectPinned(id)
      ? pinnedProjectIds.value.filter((pid) => pid !== id)
      : [...pinnedProjectIds.value, id]
    pinnedProjectIds.value = next
    localStorage.setItem(STORAGE_KEY_PINNED_PROJS, JSON.stringify(next))
  }

  return {
    // state
    sidebarPinned,
    recentProjects,
    pinnedProjectIds,
    // actions
    init,
    toggleSidebarPinned,
    setSidebarPinned,
    trackProjectVisit,
    isProjectPinned,
    togglePinnedProject,
  }
})
