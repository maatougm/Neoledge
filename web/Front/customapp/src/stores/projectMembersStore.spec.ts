import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

import api from '@/lib/api'
import { useProjectMembersStore, type ProjectMember } from './projectMembersStore'

const mockedApi = api as unknown as Record<'get' | 'post' | 'patch' | 'delete', ReturnType<typeof vi.fn>>

function makeMember(id: string, userId = `u-${id}`): ProjectMember {
  return {
    id,
    userId,
    label: '',
    createdAt: '2026-01-01T00:00:00Z',
    user: { id: userId, firstName: 'A', lastName: 'B', email: `${userId}@t`, avatarPath: null, role: 'Member' },
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  for (const m of Object.values(mockedApi)) m.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('projectMembersStore', () => {
  it('starts empty', () => {
    const s = useProjectMembersStore()
    expect(s.members).toEqual([])
    expect(s.projectManagerId).toBeNull()
    expect(s.loading).toBe(false)
    expect(s.error).toBeNull()
  })

  describe('fetchAll', () => {
    it('parses the envelope shape (members + projectManagerId)', async () => {
      mockedApi.get.mockResolvedValue({
        data: { members: [makeMember('m1'), makeMember('m2')], projectManagerId: 'u-pm' },
      })
      const s = useProjectMembersStore()
      await s.fetchAll('p1')
      expect(s.members).toHaveLength(2)
      expect(s.projectManagerId).toBe('u-pm')
      expect(s.error).toBeNull()
    })

    it('parses the legacy plain-array shape', async () => {
      mockedApi.get.mockResolvedValue({ data: [makeMember('m1')] })
      const s = useProjectMembersStore()
      await s.fetchAll('p1')
      expect(s.members).toHaveLength(1)
      expect(s.projectManagerId).toBeNull()
    })

    it('extracts response.data.message on axios errors', async () => {
      mockedApi.get.mockRejectedValue({ response: { data: { message: 'Accès refusé' } } })
      const s = useProjectMembersStore()
      await s.fetchAll('p1')
      expect(s.error).toBe('Accès refusé')
    })

    it('falls back to Error.message otherwise', async () => {
      mockedApi.get.mockRejectedValue(new Error('boom'))
      const s = useProjectMembersStore()
      await s.fetchAll('p1')
      expect(s.error).toBe('boom')
    })
  })

  describe('add', () => {
    it('POSTs the member then refetches', async () => {
      mockedApi.post.mockResolvedValue({ data: undefined })
      mockedApi.get.mockResolvedValue({ data: [makeMember('m1')] })
      const s = useProjectMembersStore()
      await s.add('p1', 'u-new', 'Backend')
      expect(mockedApi.post).toHaveBeenCalledWith('/pm/projects/p1/members', { userId: 'u-new', label: 'Backend' })
      expect(s.members).toHaveLength(1)
    })

    it('throws the error AND sets error.value on failure', async () => {
      mockedApi.post.mockRejectedValue(new Error('conflict'))
      const s = useProjectMembersStore()
      await expect(s.add('p1', 'u', 'l')).rejects.toThrow('conflict')
      expect(s.error).toBe('conflict')
    })
  })

  describe('updateLabel', () => {
    it('patches then refetches', async () => {
      mockedApi.patch.mockResolvedValue({ data: undefined })
      mockedApi.get.mockResolvedValue({ data: [] })
      const s = useProjectMembersStore()
      await s.updateLabel('p1', 'm1', 'Tech Lead')
      expect(mockedApi.patch).toHaveBeenCalledWith('/pm/projects/p1/members/m1', { label: 'Tech Lead' })
    })

    it('rethrows on failure', async () => {
      mockedApi.patch.mockRejectedValue(new Error('no'))
      const s = useProjectMembersStore()
      await expect(s.updateLabel('p1', 'm1', 'x')).rejects.toThrow()
    })
  })

  describe('remove', () => {
    it('deletes then refetches', async () => {
      mockedApi.delete.mockResolvedValue({ data: undefined })
      mockedApi.get.mockResolvedValue({ data: [] })
      const s = useProjectMembersStore()
      await s.remove('p1', 'm1')
      expect(mockedApi.delete).toHaveBeenCalledWith('/pm/projects/p1/members/m1')
    })

    it('rethrows on failure', async () => {
      mockedApi.delete.mockRejectedValue(new Error('blocked'))
      const s = useProjectMembersStore()
      await expect(s.remove('p1', 'm1')).rejects.toThrow()
    })
  })

  describe('reset', () => {
    it('wipes the store', () => {
      const s = useProjectMembersStore()
      s.members = [makeMember('m1')]
      s.projectManagerId = 'u-pm'
      s.loading = true
      s.error = 'x'
      s.reset()
      expect(s.members).toEqual([])
      expect(s.projectManagerId).toBeNull()
      expect(s.loading).toBe(false)
      expect(s.error).toBeNull()
    })
  })
})
