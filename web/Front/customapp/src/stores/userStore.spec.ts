import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

import api from '@/lib/api'
import { useUserStore } from './userStore'
import { _clearHandlers } from './logoutBus'

const mockedApi = api as unknown as Record<'get' | 'post' | 'put' | 'patch' | 'delete', ReturnType<typeof vi.fn>>

function makeUser(id: string, opts: Partial<{ role: string; isActive: boolean }> = {}) {
  return { id, email: `${id}@test`, firstName: 'F', lastName: 'L', role: opts.role ?? 'Member', isActive: opts.isActive ?? true, createdAt: '2026-01-01T00:00:00Z', lastLoginAt: null as string | null }
}

beforeEach(() => {
  setActivePinia(createPinia())
  _clearHandlers()
  for (const m of Object.values(mockedApi)) m.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('userStore', () => {
  it('starts empty', () => {
    const s = useUserStore()
    expect(s.users).toEqual([])
    expect(s.loading).toBe(false)
    expect(s.error).toBeNull()
  })

  describe('fetchAll', () => {
    it('populates users from an envelope response', async () => {
      mockedApi.get.mockResolvedValue({ data: { items: [makeUser('u1'), makeUser('u2')], total: 2 } })
      const s = useUserStore()
      await s.fetchAll()
      expect(s.users).toHaveLength(2)
      expect(s.loading).toBe(false)
      expect(s.error).toBeNull()
    })

    it('populates users from a raw-array response (legacy)', async () => {
      mockedApi.get.mockResolvedValue({ data: [makeUser('u1')] })
      const s = useUserStore()
      await s.fetchAll()
      expect(s.users).toHaveLength(1)
    })

    it('captures error messages on failure', async () => {
      mockedApi.get.mockRejectedValue(new Error('500'))
      const s = useUserStore()
      await s.fetchAll()
      expect(s.error).toBe('500')
      expect(s.loading).toBe(false)
    })
  })

  describe('fetchByRole', () => {
    it('returns the list and does not pollute users state', async () => {
      mockedApi.get.mockResolvedValue({ data: [makeUser('u1', { role: 'ProjectManager' })] })
      const s = useUserStore()
      const r = await s.fetchByRole('ProjectManager')
      expect(r).toHaveLength(1)
      expect(s.users).toEqual([])
    })

    it('returns [] + sets error on failure', async () => {
      mockedApi.get.mockRejectedValue(new Error('boom'))
      const s = useUserStore()
      const r = await s.fetchByRole('Admin')
      expect(r).toEqual([])
      expect(s.error).toBe('boom')
    })
  })

  describe('createUser', () => {
    it('appends the new user on success', async () => {
      mockedApi.post.mockResolvedValue({ data: makeUser('u-new') })
      const s = useUserStore()
      const r = await s.createUser({ email: 'x', password: 'y' } as never)
      expect(r?.id).toBe('u-new')
      expect(s.users).toHaveLength(1)
    })

    it('returns null + sets error on failure', async () => {
      mockedApi.post.mockRejectedValue(new Error('conflict'))
      const s = useUserStore()
      const r = await s.createUser({} as never)
      expect(r).toBeNull()
      expect(s.error).toBe('conflict')
    })
  })

  describe('updateUser', () => {
    it('replaces the matching row immutably', async () => {
      const s = useUserStore()
      s.users = [makeUser('u1'), makeUser('u2')]
      mockedApi.put.mockResolvedValue({ data: { ...makeUser('u1'), firstName: 'Renamed' } })
      const r = await s.updateUser('u1', { firstName: 'Renamed' } as never)
      expect(r?.firstName).toBe('Renamed')
      expect(s.users.find((u) => u.id === 'u1')?.firstName).toBe('Renamed')
      expect(s.users.find((u) => u.id === 'u2')?.firstName).toBe('F')
    })

    it('returns null on failure', async () => {
      mockedApi.put.mockRejectedValue(new Error('forbidden'))
      const s = useUserStore()
      const r = await s.updateUser('u1', {} as never)
      expect(r).toBeNull()
      expect(s.error).toBe('forbidden')
    })
  })

  describe('resetPassword', () => {
    it('returns the temporary password', async () => {
      mockedApi.post.mockResolvedValue({ data: { temporaryPassword: 'temp-xyz' } })
      const s = useUserStore()
      const r = await s.resetPassword('u1')
      expect(r).toBe('temp-xyz')
    })

    it('returns null on failure', async () => {
      mockedApi.post.mockRejectedValue(new Error('nope'))
      const s = useUserStore()
      const r = await s.resetPassword('u1')
      expect(r).toBeNull()
      expect(s.error).toBe('nope')
    })
  })

  describe('deactivate/reactivate', () => {
    it('flips isActive in place on deactivate', async () => {
      const s = useUserStore()
      s.users = [makeUser('u1', { isActive: true })]
      mockedApi.post.mockResolvedValue({ data: undefined })
      await s.deactivateUser('u1')
      expect(s.users[0].isActive).toBe(false)
    })

    it('flips isActive in place on reactivate', async () => {
      const s = useUserStore()
      s.users = [makeUser('u1', { isActive: false })]
      mockedApi.post.mockResolvedValue({ data: undefined })
      await s.reactivateUser('u1')
      expect(s.users[0].isActive).toBe(true)
    })
  })

  describe('deleteUser', () => {
    it('removes the row + returns true on success', async () => {
      const s = useUserStore()
      s.users = [makeUser('u1'), makeUser('u2')]
      mockedApi.delete.mockResolvedValue({ data: undefined })
      const r = await s.deleteUser('u1')
      expect(r).toBe(true)
      expect(s.users.map((u) => u.id)).toEqual(['u2'])
    })

    it('surfaces axios response.data.message on a 400', async () => {
      mockedApi.delete.mockRejectedValue({ response: { data: { message: 'has history rows' } } })
      const s = useUserStore()
      const r = await s.deleteUser('u1')
      expect(r).toBe(false)
      expect(s.error).toBe('has history rows')
    })

    it('falls back to Error.message when no axios body', async () => {
      mockedApi.delete.mockRejectedValue(new Error('network'))
      const s = useUserStore()
      const r = await s.deleteUser('u1')
      expect(r).toBe(false)
      expect(s.error).toBe('network')
    })
  })

  describe('getters', () => {
    it('activeUsers filters by isActive', () => {
      const s = useUserStore()
      s.users = [makeUser('u1', { isActive: true }), makeUser('u2', { isActive: false })]
      expect(s.activeUsers.map((u) => u.id)).toEqual(['u1'])
    })

    it('projectManagers filters by role + active', () => {
      const s = useUserStore()
      s.users = [
        makeUser('u1', { role: 'ProjectManager', isActive: true }),
        makeUser('u2', { role: 'ProjectManager', isActive: false }),
        makeUser('u3', { role: 'Admin', isActive: true }),
      ]
      expect(s.projectManagers.map((u) => u.id)).toEqual(['u1'])
    })
  })

  describe('reset', () => {
    it('wipes the store', () => {
      const s = useUserStore()
      s.users = [makeUser('u1')]
      s.loading = true
      s.error = 'x'
      s.reset()
      expect(s.users).toEqual([])
      expect(s.loading).toBe(false)
      expect(s.error).toBeNull()
    })
  })
})
