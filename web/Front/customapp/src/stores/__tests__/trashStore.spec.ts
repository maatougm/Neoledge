/**
 * @file     trashStore.spec.ts
 * @desc     Unit tests for trash-related actions in projectStore
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { DeletedProjectSummary } from '@/types/project.types'

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
  status: 'Kickoff',
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
      vi.mocked(api.get).mockResolvedValueOnce({ data: [mockDeleted1, mockDeleted2] } as never)

      const { useProjectStore } = await import('../projectStore')
      const store = useProjectStore()

      await store.fetchDeletedProjects()

      expect(store.deletedProjects).toHaveLength(2)
      expect(store.deletedProjects[0].id).toBe('del-1')
      expect(store.deletedProjects[1].id).toBe('del-2')
    })

    it('calls the correct endpoint', async () => {
      vi.mocked(api.get).mockResolvedValueOnce({ data: [] } as never)

      const { useProjectStore } = await import('../projectStore')
      const store = useProjectStore()

      await store.fetchDeletedProjects()

      expect(api.get).toHaveBeenCalledWith('/admin/project/deleted')
    })

    it('unwraps the paginated envelope { items, total } shape', async () => {
      // The backend returns a paginated envelope, not a raw array. Regression
      // test: spreading the envelope as if it were an array left the trash
      // permanently empty in the UI.
      vi.mocked(api.get).mockResolvedValueOnce({
        data: { items: [mockDeleted1, mockDeleted2], total: 2, skip: 0, take: 100 },
      } as never)

      const { useProjectStore } = await import('../projectStore')
      const store = useProjectStore()

      await store.fetchDeletedProjects()

      expect(store.deletedProjects).toHaveLength(2)
      expect(store.deletedProjects[0].id).toBe('del-1')
      expect(store.deletedProjects[1].id).toBe('del-2')
    })

    it('sets error on API failure without throwing', async () => {
      vi.mocked(api.get).mockRejectedValueOnce(new Error('Network error'))

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
      vi.mocked(api.get).mockResolvedValueOnce({ data: [mockDeleted1, mockDeleted2] } as never)
      vi.mocked(api.post).mockResolvedValueOnce({ data: undefined } as never)
      // fetchAll refresh after restore
      vi.mocked(api.get).mockResolvedValueOnce({ data: { items: [], total: 0 } } as never)

      const { useProjectStore } = await import('../projectStore')
      const store = useProjectStore()

      await store.fetchDeletedProjects()
      const beforeRef = store.deletedProjects

      await store.restoreProject('del-1')

      expect(store.deletedProjects).not.toBe(beforeRef)
      expect(store.deletedProjects).toHaveLength(1)
      expect(store.deletedProjects.find((p) => p.id === 'del-1')).toBeUndefined()
      expect(store.deletedProjects[0].id).toBe('del-2')
    })

    it('calls the correct restore endpoint', async () => {
      vi.mocked(api.get).mockResolvedValueOnce({ data: [mockDeleted1] } as never)
      vi.mocked(api.post).mockResolvedValueOnce({ data: undefined } as never)
      vi.mocked(api.get).mockResolvedValueOnce({ data: { items: [], total: 0 } } as never)

      const { useProjectStore } = await import('../projectStore')
      const store = useProjectStore()

      await store.fetchDeletedProjects()
      await store.restoreProject('del-1')

      expect(api.post).toHaveBeenCalledWith('/admin/project/del-1/restore', null)
    })

    it('sets error on API failure', async () => {
      vi.mocked(api.get).mockResolvedValueOnce({ data: [mockDeleted1] } as never)
      vi.mocked(api.post).mockRejectedValueOnce(new Error('Restore failed'))

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
      vi.mocked(api.get).mockResolvedValueOnce({ data: [mockDeleted1, mockDeleted2] } as never)
      vi.mocked(api.delete).mockResolvedValueOnce({ data: undefined } as never)

      const { useProjectStore } = await import('../projectStore')
      const store = useProjectStore()

      await store.fetchDeletedProjects()
      const beforeRef = store.deletedProjects

      await store.purgeProject('del-2')

      expect(store.deletedProjects).not.toBe(beforeRef)
      expect(store.deletedProjects).toHaveLength(1)
      expect(store.deletedProjects.find((p) => p.id === 'del-2')).toBeUndefined()
      expect(store.deletedProjects[0].id).toBe('del-1')
    })

    it('calls the correct hard-delete endpoint', async () => {
      vi.mocked(api.get).mockResolvedValueOnce({ data: [mockDeleted1] } as never)
      vi.mocked(api.delete).mockResolvedValueOnce({ data: undefined } as never)

      const { useProjectStore } = await import('../projectStore')
      const store = useProjectStore()

      await store.fetchDeletedProjects()
      await store.purgeProject('del-1')

      expect(api.delete).toHaveBeenCalledWith('/admin/project/del-1/hard-delete')
    })

    it('sets error on API failure', async () => {
      vi.mocked(api.get).mockResolvedValueOnce({ data: [mockDeleted1] } as never)
      vi.mocked(api.delete).mockRejectedValueOnce(new Error('Purge failed'))

      const { useProjectStore } = await import('../projectStore')
      const store = useProjectStore()

      await store.fetchDeletedProjects()
      await store.purgeProject('del-1')

      expect(store.error).toBe('Purge failed')
    })

    it('does not call fetchAll after purge (unlike restore)', async () => {
      vi.mocked(api.get).mockResolvedValueOnce({ data: [mockDeleted1] } as never)
      vi.mocked(api.delete).mockResolvedValueOnce({ data: undefined } as never)

      const { useProjectStore } = await import('../projectStore')
      const store = useProjectStore()

      await store.fetchDeletedProjects()
      vi.clearAllMocks()

      await store.purgeProject('del-1')

      expect(api.get).not.toHaveBeenCalled()
    })
  })
})
