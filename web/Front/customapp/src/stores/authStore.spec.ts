import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import axios from 'axios'

vi.mock('axios', async () => {
  const real = await vi.importActual<typeof import('axios')>('axios')
  return {
    default: {
      post: vi.fn(),
      get: vi.fn(),
      isAxiosError: real.isAxiosError,
    },
  }
})

vi.mock('@/lib/jwt', () => ({
  getUserRole: vi.fn((t: string) => (t === 'role-pm' ? 'ProjectManager' : t === 'role-admin' ? 'Admin' : null)),
  getUserFullName: vi.fn((t: string) => (t ? 'Alice Doe' : '')),
  getUserInitials: vi.fn((t: string) => (t ? 'AD' : '??')),
  getUserId: vi.fn((t: string) => (t ? 'u-1' : null)),
  isTokenExpired: vi.fn(() => false),
}))

import { useAuthStore } from './authStore'
import { useConfigStore } from './configStore'
import { _clearHandlers } from './logoutBus'
import { isTokenExpired } from '@/lib/jwt'

const mockedAxios = axios as unknown as { post: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn>; isAxiosError: typeof axios.isAxiosError }

beforeEach(() => {
  setActivePinia(createPinia())
  useConfigStore().apiUrl = 'https://api.example.com'
  localStorage.clear()
  mockedAxios.post.mockReset()
  mockedAxios.get.mockReset()
  vi.mocked(isTokenExpired).mockReset().mockReturnValue(false)
  _clearHandlers()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('authStore', () => {
  describe('getters', () => {
    it('isAuthenticated is false initially, true after setJwt', () => {
      const s = useAuthStore()
      expect(s.isAuthenticated).toBe(false)
      s.setJwt('role-pm')
      expect(s.isAuthenticated).toBe(true)
    })

    it('userRole / userFullName / userInitials / userId return decoded values when jwt is set', () => {
      const s = useAuthStore()
      s.setJwt('role-pm')
      expect(s.userRole).toBe('ProjectManager')
      expect(s.userFullName).toBe('Alice Doe')
      expect(s.userInitials).toBe('AD')
      expect(s.userId).toBe('u-1')
    })

    it('userRole / userId are null when jwt is empty', () => {
      const s = useAuthStore()
      expect(s.userRole).toBeNull()
      expect(s.userId).toBeNull()
      expect(s.userFullName).toBe('')
      expect(s.userInitials).toBe('??')
    })
  })

  describe('init', () => {
    it('hydrates from localStorage when a valid token is present', () => {
      localStorage.setItem('nl_jwt', 'role-pm')
      const s = useAuthStore()
      s.init()
      expect(s.jwt).toBe('role-pm')
    })

    it('clears localStorage and stays empty when stored token is expired', () => {
      vi.mocked(isTokenExpired).mockReturnValue(true)
      localStorage.setItem('nl_jwt', 'rotten')
      const s = useAuthStore()
      s.init()
      expect(s.jwt).toBe('')
      expect(localStorage.getItem('nl_jwt')).toBeNull()
    })

    it('is a no-op when nothing is stored', () => {
      const s = useAuthStore()
      s.init()
      expect(s.jwt).toBe('')
    })
  })

  describe('login', () => {
    it('stores the jwt + persists it on a non-TOTP login', async () => {
      mockedAxios.post.mockResolvedValue({ data: { jwt: 'role-pm' } })
      const s = useAuthStore()
      const r = await s.login('a@b.co', 'pw')
      expect(r).toEqual({ requiresTotp: false })
      expect(s.jwt).toBe('role-pm')
      expect(localStorage.getItem('nl_jwt')).toBe('role-pm')
    })

    it('returns requiresTotp + tempToken when the server demands a TOTP code', async () => {
      mockedAxios.post.mockResolvedValue({ data: { requiresTotp: true, tempToken: 'tmp' } })
      const s = useAuthStore()
      const r = await s.login('a@b.co', 'pw')
      expect(r).toEqual({ requiresTotp: true, tempToken: 'tmp' })
      expect(s.jwt).toBe('')
      expect(localStorage.getItem('nl_jwt')).toBeNull()
    })

    it('coerces missing jwt to empty string', async () => {
      mockedAxios.post.mockResolvedValue({ data: {} })
      const s = useAuthStore()
      await s.login('a@b.co', 'pw')
      expect(s.jwt).toBe('')
    })
  })

  describe('loginTotp', () => {
    it('stores the jwt on success', async () => {
      mockedAxios.post.mockResolvedValue({ data: { jwt: 'role-admin' } })
      const s = useAuthStore()
      await s.loginTotp('tmp', '123456')
      expect(s.jwt).toBe('role-admin')
      expect(localStorage.getItem('nl_jwt')).toBe('role-admin')
    })
  })

  describe('requestMagicLink', () => {
    it('POSTs the email to /auth/magic-link and resolves without storing a jwt', async () => {
      mockedAxios.post.mockResolvedValue({ data: { message: 'ok' } })
      const s = useAuthStore()
      await expect(s.requestMagicLink('a@b.co')).resolves.toBeUndefined()
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.example.com/auth/magic-link',
        { email: 'a@b.co' },
      )
      expect(s.jwt).toBe('')
    })
  })

  describe('magicLogin', () => {
    it('stores the jwt + persists it on a non-TOTP magic login', async () => {
      mockedAxios.post.mockResolvedValue({ data: { jwt: 'role-pm' } })
      const s = useAuthStore()
      const r = await s.magicLogin('rawtoken')
      expect(r).toEqual({ requiresTotp: false })
      expect(s.jwt).toBe('role-pm')
      expect(localStorage.getItem('nl_jwt')).toBe('role-pm')
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.example.com/auth/magic-login',
        { token: 'rawtoken' },
      )
    })

    it('returns requiresTotp + tempToken when the account has 2FA', async () => {
      mockedAxios.post.mockResolvedValue({ data: { requiresTotp: true, tempToken: 'tmp' } })
      const s = useAuthStore()
      const r = await s.magicLogin('rawtoken')
      expect(r).toEqual({ requiresTotp: true, tempToken: 'tmp' })
      expect(s.jwt).toBe('')
      expect(localStorage.getItem('nl_jwt')).toBeNull()
    })

    it('propagates a rejection on an invalid / expired link (401)', async () => {
      mockedAxios.post.mockRejectedValue(
        Object.assign(new Error('unauth'), { isAxiosError: true, response: { status: 401 } }),
      )
      const s = useAuthStore()
      await expect(s.magicLogin('bad')).rejects.toBeTruthy()
      expect(s.jwt).toBe('')
    })
  })

  describe('logout', () => {
    it('clears local state then notifies the server', async () => {
      mockedAxios.get.mockResolvedValue({ data: {} })
      const s = useAuthStore()
      s.setJwt('role-pm')
      await s.logout()
      expect(s.jwt).toBe('')
      expect(localStorage.getItem('nl_jwt')).toBeNull()
      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://api.example.com/hook/logout',
        expect.objectContaining({ headers: { Authorization: 'Bearer role-pm' } }),
      )
    })

    it('silently swallows a failing /hook/logout call (state already cleared)', async () => {
      mockedAxios.get.mockRejectedValue(new Error('network'))
      const s = useAuthStore()
      s.setJwt('role-pm')
      await expect(s.logout()).resolves.toBeUndefined()
      expect(s.jwt).toBe('')
    })
  })

  describe('clear', () => {
    it('wipes jwt + localStorage + dispatches auth:logout event', () => {
      const s = useAuthStore()
      s.setJwt('role-pm')
      const listener = vi.fn()
      window.addEventListener('auth:logout', listener)
      s.clear()
      expect(s.jwt).toBe('')
      expect(localStorage.getItem('nl_jwt')).toBeNull()
      expect(listener).toHaveBeenCalled()
      window.removeEventListener('auth:logout', listener)
    })
  })

  describe('fetchMe', () => {
    it('returns null when not authenticated', async () => {
      const s = useAuthStore()
      const r = await s.fetchMe()
      expect(r).toBeNull()
      expect(mockedAxios.get).not.toHaveBeenCalled()
    })

    it('returns the response body on 200', async () => {
      const body = { user: { id: 'u-1', email: 'a@b.co', firstName: 'A', lastName: 'B', role: 'PM' } }
      mockedAxios.get.mockResolvedValue({ data: body })
      const s = useAuthStore()
      s.setJwt('role-pm')
      const r = await s.fetchMe()
      expect(r).toEqual(body)
    })

    it('clears auth on 401 (token invalidated server-side)', async () => {
      // Build a plain object that axios.isAxiosError recognises. The mocked
      // module preserves the real isAxiosError implementation; it duck-types
      // on the `isAxiosError` flag, so a plain object with that flag set
      // qualifies — avoids needing AxiosError as a constructor.
      const err = Object.assign(new Error('unauth'), { isAxiosError: true, response: { status: 401 } })
      mockedAxios.get.mockRejectedValue(err)
      const s = useAuthStore()
      s.setJwt('role-pm')
      const r = await s.fetchMe()
      expect(r).toBeNull()
      expect(s.jwt).toBe('')
    })

    it('returns null on a generic network failure without clearing state', async () => {
      mockedAxios.get.mockRejectedValue(new Error('boom'))
      const s = useAuthStore()
      s.setJwt('role-pm')
      const r = await s.fetchMe()
      expect(r).toBeNull()
      // Generic errors do not clear state.
      expect(s.jwt).toBe('role-pm')
    })
  })
})
