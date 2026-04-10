/** @file src/stores/uiStore.ts — Pinia store for UI state (sidebar, layout preferences) */

import { defineStore } from 'pinia'
import { ref } from 'vue'

const STORAGE_KEY_PINNED = 'nl_sidebar_pinned'

export const useUiStore = defineStore('ui', () => {
  // ── State ────────────────────────────────────────────────────────────────────
  const sidebarPinned = ref<boolean>(false)

  // ── Actions ──────────────────────────────────────────────────────────────────

  /**
   * Load persisted UI preferences from localStorage.
   * Call once on app mount.
   */
  const init = (): void => {
    sidebarPinned.value = localStorage.getItem(STORAGE_KEY_PINNED) === 'true'
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

  return {
    sidebarPinned,
    init,
    toggleSidebarPinned,
    setSidebarPinned,
  }
})
