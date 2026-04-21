/**
 * @file     bulkActions.spec.ts
 * @desc     Unit tests for bulk action store methods (selection + HTTP actions)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// Mock the shared axios wrapper (projectStore uses `api` from @/lib/api)
vi.mock('@/lib/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))

import api from '@/lib/api'

describe('projectStore — bulk actions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(api.get).mockReset()
    vi.mocked(api.post).mockReset()
    vi.mocked(api.put).mockReset()
    vi.mocked(api.patch).mockReset()
    vi.mocked(api.delete).mockReset()
  })

  const getStore = async () => {
    const { useProjectStore } = await import('../projectStore')
    return useProjectStore()
  }

  // ─── toggleSelection ───────────────────────────────────────────────────────

  describe('toggleSelection', () => {
    it('adds an id when not already selected', async () => {
      const store = await getStore()
      store.toggleSelection('p1')
      expect(store.selectedProjectIds).toEqual(['p1'])
    })

    it('removes an id when already selected (immutable — new array)', async () => {
      const store = await getStore()
      store.toggleSelection('p1')
      store.toggleSelection('p2')
      const refBefore = store.selectedProjectIds
      store.toggleSelection('p1')
      expect(store.selectedProjectIds).toEqual(['p2'])
      expect(store.selectedProjectIds).not.toBe(refBefore)
    })

    it('produces a new array reference on add (immutable)', async () => {
      const store = await getStore()
      const before = store.selectedProjectIds
      store.toggleSelection('p1')
      expect(store.selectedProjectIds).not.toBe(before)
    })
  })

  // ─── selectAll ─────────────────────────────────────────────────────────────

  describe('selectAll', () => {
    it('sets selectedProjectIds to a copy of the provided ids', async () => {
      const store = await getStore()
      const ids = ['p1', 'p2', 'p3']
      store.selectAll(ids)
      expect(store.selectedProjectIds).toEqual(ids)
    })

    it('produces a new array reference (immutable)', async () => {
      const store = await getStore()
      const ids = ['p1', 'p2']
      store.selectAll(ids)
      expect(store.selectedProjectIds).not.toBe(ids)
    })
  })

  // ─── clearSelection ────────────────────────────────────────────────────────

  describe('clearSelection', () => {
    it('empties the selectedProjectIds array', async () => {
      const store = await getStore()
      store.selectAll(['p1', 'p2'])
      store.clearSelection()
      expect(store.selectedProjectIds).toHaveLength(0)
    })
  })

  // ─── bulkArchive ───────────────────────────────────────────────────────────

  describe('bulkArchive', () => {
    it('calls the correct endpoint with projectIds and refreshes the list', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({ data: undefined } as never)
      vi.mocked(api.get).mockResolvedValueOnce({ data: { items: [], total: 0 } } as never)

      const store = await getStore()
      await store.bulkArchive(['p1', 'p2'])

      expect(api.post).toHaveBeenCalledWith('/admin/project/bulk-archive', { projectIds: ['p1', 'p2'] })
      expect(api.get).toHaveBeenCalledWith('/admin/project')
    })

    it('sets error state on failure', async () => {
      vi.mocked(api.post).mockRejectedValueOnce(new Error('Network error'))

      const store = await getStore()
      await store.bulkArchive(['p1'])

      expect(store.error).toBe('Network error')
    })
  })

  // ─── bulkUpdateStatus ──────────────────────────────────────────────────────

  describe('bulkUpdateStatus', () => {
    it('calls the correct endpoint with projectIds and status', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({ data: undefined } as never)
      vi.mocked(api.get).mockResolvedValueOnce({ data: { items: [], total: 0 } } as never)

      const store = await getStore()
      await store.bulkUpdateStatus(['p1', 'p2'], 'InProgress')

      expect(api.post).toHaveBeenCalledWith('/admin/project/bulk-status', {
        projectIds: ['p1', 'p2'],
        status: 'InProgress',
      })
    })
  })

  // ─── bulkAssignManager ────────────────────────────────────────────────────

  describe('bulkAssignManager', () => {
    it('calls the correct endpoint with projectIds and managerId', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({ data: undefined } as never)
      vi.mocked(api.get).mockResolvedValueOnce({ data: { items: [], total: 0 } } as never)

      const store = await getStore()
      await store.bulkAssignManager(['p1', 'p3'], 'mgr-42')

      expect(api.post).toHaveBeenCalledWith('/admin/project/bulk-assign-manager', {
        projectIds: ['p1', 'p3'],
        managerId: 'mgr-42',
      })
    })
  })
})
