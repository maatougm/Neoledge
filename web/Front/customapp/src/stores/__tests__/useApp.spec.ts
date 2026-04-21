import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import axios from 'axios'

vi.mock('axios', () => {
  const mock = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  }
  return { default: mock, ...mock }
})
vi.mock('@/router', () => ({
  default: { push: vi.fn() },
}))

describe('useApp', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(axios.post).mockReset()
    vi.mocked(axios.get).mockReset()
  })

  const getStore = async () => {
    const { useApp } = await import('../useApp')
    return useApp()
  }

  // ─── login ──────────────────────────────────────────────────────────────────

  describe('login', () => {
    it('posts credentials and sets jwt and mustChangePassword', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: { jwt: 'jwt-abc-123', mustChangePassword: true },
      })

      const store = await getStore()
      await store.login('user@test.com', 'P@ss1234')

      expect(axios.post).toHaveBeenCalledWith(
        '/auth/login',
        { email: 'user@test.com', password: 'P@ss1234' },
      )
      expect(store.jwt).toBe('jwt-abc-123')
      expect(store.mustChangePassword).toBe(true)
    })

    it('sets mustChangePassword to false when not returned', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: { jwt: 'jwt-xyz' },
      })

      const store = await getStore()
      await store.login('user@test.com', 'P@ss1234')

      expect(store.mustChangePassword).toBe(false)
    })
  })

  // ─── logout ─────────────────────────────────────────────────────────────────

  describe('logout', () => {
    it('clears jwt and mustChangePassword', async () => {
      const store = await getStore()
      store.jwt = 'existing-token'
      store.mustChangePassword = true

      vi.mocked(axios.get).mockResolvedValueOnce({})

      await store.logout()

      expect(store.jwt).toBe('')
      expect(store.mustChangePassword).toBe(false)
    })

    it('clears jwt even when logout API call fails', async () => {
      const store = await getStore()
      store.jwt = 'existing-token'

      vi.mocked(axios.get).mockRejectedValueOnce(new Error('Network fail'))

      await store.logout()

      expect(store.jwt).toBe('')
    })
  })

  // ─── userRole ───────────────────────────────────────────────────────────────

  describe('userRole computed', () => {
    it('decodes role from JWT payload', async () => {
      const store = await getStore()
      // Build a fake JWT with role claim in the payload
      const payload = {
        'http://schemas.microsoft.com/ws/2008/06/identity/claims/role': 'Admin',
      }
      const fakeJwt = `header.${btoa(JSON.stringify(payload))}.signature`
      store.jwt = fakeJwt

      expect(store.userRole).toBe('Admin')
    })

    it('falls back to simple role claim', async () => {
      const store = await getStore()
      const payload = { role: 'ProjectManager' }
      const fakeJwt = `header.${btoa(JSON.stringify(payload))}.signature`
      store.jwt = fakeJwt

      expect(store.userRole).toBe('ProjectManager')
    })

    it('returns null when no JWT', async () => {
      const store = await getStore()
      store.jwt = ''

      expect(store.userRole).toBeNull()
    })

    it('returns null for malformed JWT', async () => {
      const store = await getStore()
      store.jwt = 'not-a-valid-jwt'

      expect(store.userRole).toBeNull()
    })
  })

  // ─── authHeader ─────────────────────────────────────────────────────────────

  describe('authHeader', () => {
    it('returns Bearer header when JWT present', async () => {
      const store = await getStore()
      store.jwt = 'my-token'

      expect(store.authHeader()).toEqual({ Authorization: 'Bearer my-token' })
    })

    it('returns empty object when no JWT', async () => {
      const store = await getStore()
      store.jwt = ''

      expect(store.authHeader()).toEqual({})
    })
  })
})
