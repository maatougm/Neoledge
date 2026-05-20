import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useUiStore } from './uiStore'

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

describe('uiStore', () => {
  describe('initial state', () => {
    it('defaults to sidebarPinned=true with empty recents + pinned arrays', () => {
      const s = useUiStore()
      expect(s.sidebarPinned).toBe(true)
      expect(s.recentProjects).toEqual([])
      expect(s.pinnedProjectIds).toEqual([])
    })
  })

  describe('init', () => {
    it('hydrates sidebarPinned from localStorage', () => {
      localStorage.setItem('nl_sidebar_pinned', 'false')
      const s = useUiStore()
      s.init()
      expect(s.sidebarPinned).toBe(false)
    })

    it('defaults sidebarPinned to true when nothing is stored', () => {
      const s = useUiStore()
      s.init()
      expect(s.sidebarPinned).toBe(true)
    })

    it('hydrates recents + pinned arrays from JSON storage', () => {
      const recents = [{ id: 'p1', name: 'A', visitedAt: 1 }]
      localStorage.setItem('nl_recent_projects', JSON.stringify(recents))
      localStorage.setItem('nl_pinned_projects', JSON.stringify(['p1', 'p2']))
      const s = useUiStore()
      s.init()
      expect(s.recentProjects).toEqual(recents)
      expect(s.pinnedProjectIds).toEqual(['p1', 'p2'])
    })

    it('falls back to [] on corrupt JSON', () => {
      localStorage.setItem('nl_recent_projects', '{not json')
      localStorage.setItem('nl_pinned_projects', 'oops')
      const s = useUiStore()
      s.init()
      expect(s.recentProjects).toEqual([])
      expect(s.pinnedProjectIds).toEqual([])
    })
  })

  describe('toggleSidebarPinned + setSidebarPinned', () => {
    it('toggles and persists', () => {
      const s = useUiStore()
      s.toggleSidebarPinned()
      expect(s.sidebarPinned).toBe(false)
      expect(localStorage.getItem('nl_sidebar_pinned')).toBe('false')
      s.toggleSidebarPinned()
      expect(s.sidebarPinned).toBe(true)
      expect(localStorage.getItem('nl_sidebar_pinned')).toBe('true')
    })

    it('setSidebarPinned writes the explicit value', () => {
      const s = useUiStore()
      s.setSidebarPinned(false)
      expect(s.sidebarPinned).toBe(false)
      expect(localStorage.getItem('nl_sidebar_pinned')).toBe('false')
    })
  })

  describe('trackProjectVisit', () => {
    it('prepends a project + persists the array', () => {
      const s = useUiStore()
      s.trackProjectVisit({ id: 'p1', name: 'A' })
      expect(s.recentProjects).toHaveLength(1)
      expect(s.recentProjects[0]).toMatchObject({ id: 'p1', name: 'A' })
      expect(s.recentProjects[0].visitedAt).toBeGreaterThan(0)
      expect(JSON.parse(localStorage.getItem('nl_recent_projects') ?? '[]')).toHaveLength(1)
    })

    it('moves an already-visited project to the front', () => {
      const s = useUiStore()
      s.trackProjectVisit({ id: 'p1', name: 'A' })
      s.trackProjectVisit({ id: 'p2', name: 'B' })
      s.trackProjectVisit({ id: 'p1', name: 'A' })
      expect(s.recentProjects.map((r) => r.id)).toEqual(['p1', 'p2'])
    })

    it('caps the list at 5 entries', () => {
      const s = useUiStore()
      for (let i = 0; i < 8; i++) s.trackProjectVisit({ id: `p${i}`, name: `P${i}` })
      expect(s.recentProjects).toHaveLength(5)
      expect(s.recentProjects[0].id).toBe('p7')
    })
  })

  describe('isProjectPinned + togglePinnedProject', () => {
    it('starts unpinned', () => {
      const s = useUiStore()
      expect(s.isProjectPinned('p1')).toBe(false)
    })

    it('toggles in then out + persists each step', () => {
      const s = useUiStore()
      s.togglePinnedProject('p1')
      expect(s.isProjectPinned('p1')).toBe(true)
      expect(JSON.parse(localStorage.getItem('nl_pinned_projects') ?? '[]')).toEqual(['p1'])
      s.togglePinnedProject('p1')
      expect(s.isProjectPinned('p1')).toBe(false)
      expect(JSON.parse(localStorage.getItem('nl_pinned_projects') ?? '[]')).toEqual([])
    })
  })
})
