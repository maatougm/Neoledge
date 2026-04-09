import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import axios from 'axios'
import type { UserResponse } from '@/types/user.types'

vi.mock('axios')
vi.mock('../useApp', () => ({
  useApp: () => ({
    apiUrl: 'http://test-api',
    jwt: 'fake-jwt-token',
  }),
}))

const mockUser: UserResponse = {
  id: 'u1',
  firstName: 'Jean',
  lastName: 'Dupont',
  email: 'jean@test.com',
  role: 'Admin',
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
  lastLoginAt: null,
}

const mockPM: UserResponse = {
  id: 'u2',
  firstName: 'Marie',
  lastName: 'Martin',
  email: 'marie@test.com',
  role: 'ProjectManager',
  isActive: true,
  createdAt: '2026-01-02T00:00:00Z',
  lastLoginAt: null,
}

const mockInactive: UserResponse = {
  id: 'u3',
  firstName: 'Paul',
  lastName: 'Durand',
  email: 'paul@test.com',
  role: 'Viewer',
  isActive: false,
  createdAt: '2026-01-03T00:00:00Z',
  lastLoginAt: null,
}

describe('useUserStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(axios.get).mockReset()
    vi.mocked(axios.post).mockReset()
    vi.mocked(axios.put).mockReset()
  })

  // Lazy import to ensure fresh store per test
  const getStore = async () => {
    const { useUserStore } = await import('../userStore')
    return useUserStore()
  }

  // ─── fetchAll ────────────────────────────────────────────────────────────────

  describe('fetchAll', () => {
    it('calls correct URL and sets users state', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: [mockUser, mockPM] })

      const store = await getStore()
      await store.fetchAll()

      expect(axios.get).toHaveBeenCalledWith(
        'http://test-api/admin/AppUser',
        { headers: { Authorization: 'Bearer fake-jwt-token' } },
      )
      expect(store.users).toHaveLength(2)
      expect(store.users[0]).toEqual(mockUser)
      expect(store.loading).toBe(false)
    })

    it('sets error state on failure', async () => {
      vi.mocked(axios.get).mockRejectedValueOnce(new Error('Network error'))

      const store = await getStore()
      await store.fetchAll()

      expect(store.error).toBe('Network error')
      expect(store.loading).toBe(false)
    })
  })

  // ─── createUser ──────────────────────────────────────────────────────────────

  describe('createUser', () => {
    it('posts to correct URL and adds user to state immutably', async () => {
      const payload = {
        firstName: 'Jean',
        lastName: 'Dupont',
        email: 'jean@test.com',
        password: 'P@ss1234',
        role: 'Admin' as const,
      }
      vi.mocked(axios.post).mockResolvedValueOnce({ data: mockUser })

      const store = await getStore()
      const originalRef = store.users
      const result = await store.createUser(payload)

      expect(axios.post).toHaveBeenCalledWith(
        'http://test-api/admin/AppUser',
        payload,
        { headers: { Authorization: 'Bearer fake-jwt-token' } },
      )
      expect(result).toEqual(mockUser)
      expect(store.users).toHaveLength(1)
      // Immutability: array reference should have changed
      expect(store.users).not.toBe(originalRef)
    })
  })

  // ─── updateUser ──────────────────────────────────────────────────────────────

  describe('updateUser', () => {
    it('puts to correct URL and updates user in state immutably', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: [mockUser] })

      const store = await getStore()
      await store.fetchAll()
      const originalRef = store.users

      const updated = { ...mockUser, firstName: 'Updated' }
      vi.mocked(axios.put).mockResolvedValueOnce({ data: updated })

      const result = await store.updateUser('u1', { firstName: 'Updated' })

      expect(axios.put).toHaveBeenCalledWith(
        'http://test-api/admin/AppUser/u1',
        { firstName: 'Updated' },
        { headers: { Authorization: 'Bearer fake-jwt-token' } },
      )
      expect(result).toEqual(updated)
      expect(store.users[0].firstName).toBe('Updated')
      // Immutability: new array reference
      expect(store.users).not.toBe(originalRef)
    })
  })

  // ─── deactivateUser ──────────────────────────────────────────────────────────

  describe('deactivateUser', () => {
    it('sets isActive to false in state immutably', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: [mockUser] })

      const store = await getStore()
      await store.fetchAll()
      const originalRef = store.users

      vi.mocked(axios.post).mockResolvedValueOnce({})

      await store.deactivateUser('u1')

      expect(store.users[0].isActive).toBe(false)
      expect(store.users).not.toBe(originalRef)
    })
  })

  // ─── reactivateUser ─────────────────────────────────────────────────────────

  describe('reactivateUser', () => {
    it('sets isActive to true in state immutably', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: [mockInactive] })

      const store = await getStore()
      await store.fetchAll()
      const originalRef = store.users

      vi.mocked(axios.post).mockResolvedValueOnce({})

      await store.reactivateUser('u3')

      expect(store.users[0].isActive).toBe(true)
      expect(store.users).not.toBe(originalRef)
    })
  })

  // ─── resetPassword ──────────────────────────────────────────────────────────

  describe('resetPassword', () => {
    it('returns temporary password string', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: { temporaryPassword: 'TempP@ss123' },
      })

      const store = await getStore()
      const result = await store.resetPassword('u1')

      expect(axios.post).toHaveBeenCalledWith(
        'http://test-api/admin/AppUser/u1/reset-password',
        {},
        { headers: { Authorization: 'Bearer fake-jwt-token' } },
      )
      expect(result).toBe('TempP@ss123')
    })
  })

  // ─── Getters ─────────────────────────────────────────────────────────────────

  describe('activeUsers getter', () => {
    it('filters only active users', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: [mockUser, mockPM, mockInactive],
      })

      const store = await getStore()
      await store.fetchAll()

      expect(store.activeUsers).toHaveLength(2)
      expect(store.activeUsers.every((u) => u.isActive)).toBe(true)
    })
  })

  describe('projectManagers getter', () => {
    it('filters active ProjectManager role users', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: [mockUser, mockPM, mockInactive],
      })

      const store = await getStore()
      await store.fetchAll()

      expect(store.projectManagers).toHaveLength(1)
      expect(store.projectManagers[0].role).toBe('ProjectManager')
      expect(store.projectManagers[0].isActive).toBe(true)
    })
  })
})
