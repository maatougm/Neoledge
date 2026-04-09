/**
 * @file     trashStore.spec.ts
 * @module   NeoLeadge — Deployment Manager
 * @desc     Unit tests for trash-related actions in projectStore
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import axios from 'axios'
import type { DeletedProjectSummary } from '@/types/project.types'

vi.mock('axios')
vi.mock('../useApp', () => ({
  useApp: () => ({
    apiUrl: 'http://test-api',
    jwt: 'fake-jwt-token',
    authHeader: () => ({ Authorization: 'Bearer fake-jwt-token' }),
  }),
}))

const mockDeleted1: DeletedProjectSummary = {
  id: 'del-1',
  name: 'Projet Supprimé Alpha',
  clientName: 'Client A',
  projectManagerName: 'Jean Dupont',
  status: 'Draft',
  deletedAt: '2026-04-01T10:00:00Z',
  deletedByName: 'Admin User',
}

const mockDeleted2: DeletedProjectSummary = {
  id: 'del-2',
  name: 'Projet Supprimé Beta',
  clientName: 'Client B',
  projectManagerName: null,
  status: 'InProgress',
  deletedAt: '2026-04-02T12:00:00Z',
  deletedByName: null,
}

describe('projectStore — trash actions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  // ─── fetchDeletedProjects ─────────────────────────────────────────────────

  describe('fetchDeletedProjects', () => {
    it('populates deletedProjects state with API response', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: [mockDeleted1, mockDeleted2] })

      const { useProjectStore } = await import('../projectStore')
      const store = useProjectStore()

      await store.fetchDeletedProjects()

      expect(store.deletedProjects).toHaveLength(2)
      expect(store.deletedProjects[0].id).toBe('del-1')
      expect(store.deletedProjects[1].id).toBe('del-2')
    })

    it('calls the correct endpoint', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: [] })

      const { useProjectStore } = await import('../projectStore')
      const store = useProjectStore()

      await store.fetchDeletedProjects()

      expect(axios.get).toHaveBeenCalledWith(
        'http://test-api/admin/Project/deleted',
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: expect.any(String) }) }),
      )
    })

    it('sets error on API failure without throwing', async () => {
      vi.mocked(axios.get).mockRejectedValueOnce(new Error('Network error'))

      const { useProjectStore } = await import('../projectStore')
      const store = useProjectStore()

      await store.fetchDeletedProjects()

      expect(store.error).toBe('Network error')
      expect(store.deletedProjects).toHaveLength(0)
    })
  })

  // ─── restoreProject ────────────────────────────────────────────────────────

  describe('restoreProject', () => {
    it('removes the restored project from deletedProjects immutably', async () => {
      // Seed deleted projects
      vi.mocked(axios.get).mockResolvedValueOnce({ data: [mockDeleted1, mockDeleted2] })
      // Restore POST
      vi.mocked(axios.post).mockResolvedValueOnce({})
      // fetchAll after restore
      vi.mocked(axios.get).mockResolvedValueOnce({ data: [] })

      const { useProjectStore } = await import('../projectStore')
      const store = useProjectStore()

      await store.fetchDeletedProjects()
      const beforeRef = store.deletedProjects

      await store.restoreProject('del-1')

      // Immutability check: array reference changed
      expect(store.deletedProjects).not.toBe(beforeRef)
      expect(store.deletedProjects).toHaveLength(1)
      expect(store.deletedProjects.find((p) => p.id === 'del-1')).toBeUndefined()
      expect(store.deletedProjects[0].id).toBe('del-2')
    })

    it('calls the correct restore endpoint', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: [mockDeleted1] })
      vi.mocked(axios.post).mockResolvedValueOnce({})
      vi.mocked(axios.get).mockResolvedValueOnce({ data: [] })

      const { useProjectStore } = await import('../projectStore')
      const store = useProjectStore()

      await store.fetchDeletedProjects()
      await store.restoreProject('del-1')

      expect(axios.post).toHaveBeenCalledWith(
        'http://test-api/admin/Project/del-1/restore',
        null,
        expect.anything(),
      )
    })

    it('sets error on API failure', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: [mockDeleted1] })
      vi.mocked(axios.post).mockRejectedValueOnce(new Error('Restore failed'))

      const { useProjectStore } = await import('../projectStore')
      const store = useProjectStore()

      await store.fetchDeletedProjects()
      await store.restoreProject('del-1')

      expect(store.error).toBe('Restore failed')
    })
  })

  // ─── purgeProject ──────────────────────────────────────────────────────────

  describe('purgeProject', () => {
    it('removes the purged project from deletedProjects immutably', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: [mockDeleted1, mockDeleted2] })
      vi.mocked(axios.delete).mockResolvedValueOnce({})

      const { useProjectStore } = await import('../projectStore')
      const store = useProjectStore()

      await store.fetchDeletedProjects()
      const beforeRef = store.deletedProjects

      await store.purgeProject('del-2')

      // Immutability check: array reference changed
      expect(store.deletedProjects).not.toBe(beforeRef)
      expect(store.deletedProjects).toHaveLength(1)
      expect(store.deletedProjects.find((p) => p.id === 'del-2')).toBeUndefined()
      expect(store.deletedProjects[0].id).toBe('del-1')
    })

    it('calls the correct hard-delete endpoint', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: [mockDeleted1] })
      vi.mocked(axios.delete).mockResolvedValueOnce({})

      const { useProjectStore } = await import('../projectStore')
      const store = useProjectStore()

      await store.fetchDeletedProjects()
      await store.purgeProject('del-1')

      expect(axios.delete).toHaveBeenCalledWith(
        'http://test-api/admin/Project/del-1/hard-delete',
        expect.anything(),
      )
    })

    it('sets error on API failure', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: [mockDeleted1] })
      vi.mocked(axios.delete).mockRejectedValueOnce(new Error('Purge failed'))

      const { useProjectStore } = await import('../projectStore')
      const store = useProjectStore()

      await store.fetchDeletedProjects()
      await store.purgeProject('del-1')

      expect(store.error).toBe('Purge failed')
    })

    it('does not call fetchAll after purge (unlike restore)', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: [mockDeleted1] })
      vi.mocked(axios.delete).mockResolvedValueOnce({})

      const { useProjectStore } = await import('../projectStore')
      const store = useProjectStore()

      await store.fetchDeletedProjects()
      vi.clearAllMocks()

      await store.purgeProject('del-1')

      // No additional GET calls should have been made
      expect(axios.get).not.toHaveBeenCalled()
    })
  })
})
