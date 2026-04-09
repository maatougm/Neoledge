/**
 * @file     bulkActions.spec.ts
 * @module   NeoLeadge — Deployment Manager
 * @desc     Unit tests for bulk action store methods (selection + HTTP actions)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import axios from 'axios'

vi.mock('axios')
vi.mock('../useApp', () => ({
  useApp: () => ({
    apiUrl: 'http://test-api',
    jwt: 'fake-jwt-token',
  }),
}))

const headers = { headers: { Authorization: 'Bearer fake-jwt-token' } }
const BASE = 'http://test-api/admin/Project'

describe('projectStore — bulk actions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(axios.get).mockReset()
    vi.mocked(axios.post).mockReset()
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
    it('calls the correct endpoint with ids and refreshes the list', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({})
      vi.mocked(axios.get).mockResolvedValueOnce({ data: [] })

      const store = await getStore()
      await store.bulkArchive(['p1', 'p2'])

      expect(axios.post).toHaveBeenCalledWith(
        `${BASE}/bulk-archive`,
        { ids: ['p1', 'p2'] },
        headers,
      )
      expect(axios.get).toHaveBeenCalledWith(BASE, headers)
    })

    it('sets error state on failure', async () => {
      vi.mocked(axios.post).mockRejectedValueOnce(new Error('Network error'))

      const store = await getStore()
      await store.bulkArchive(['p1'])

      expect(store.error).toBe('Network error')
    })
  })

  // ─── bulkUpdateStatus ──────────────────────────────────────────────────────

  describe('bulkUpdateStatus', () => {
    it('calls the correct endpoint with ids and status', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({})
      vi.mocked(axios.get).mockResolvedValueOnce({ data: [] })

      const store = await getStore()
      await store.bulkUpdateStatus(['p1', 'p2'], 'InProgress')

      expect(axios.post).toHaveBeenCalledWith(
        `${BASE}/bulk-status`,
        { ids: ['p1', 'p2'], status: 'InProgress' },
        headers,
      )
    })
  })

  // ─── bulkAssignManager ────────────────────────────────────────────────────

  describe('bulkAssignManager', () => {
    it('calls the correct endpoint with ids and managerId', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({})
      vi.mocked(axios.get).mockResolvedValueOnce({ data: [] })

      const store = await getStore()
      await store.bulkAssignManager(['p1', 'p3'], 'mgr-42')

      expect(axios.post).toHaveBeenCalledWith(
        `${BASE}/bulk-assign-manager`,
        { ids: ['p1', 'p3'], managerId: 'mgr-42' },
        headers,
      )
    })
  })
})
