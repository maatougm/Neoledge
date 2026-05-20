import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import axios from 'axios'

// Mock @/router BEFORE importing useApp (which attaches axios interceptors at module load).
vi.mock('@/router', () => ({ default: { push: vi.fn() } }))
vi.mock('axios', async () => {
  const real = await vi.importActual<typeof import('axios')>('axios')
  return {
    default: {
      get: vi.fn(),
      post: vi.fn(),
      interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
      isAxiosError: real.isAxiosError,
    },
  }
})

import { useApp } from './useApp'

const mockedAxios = axios as unknown as {
  get: ReturnType<typeof vi.fn>
  post: ReturnType<typeof vi.fn>
}

function makeJwtForRole(role: string): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = btoa(JSON.stringify({ role, sub: 'u-1', iat: 1 }))
  return `${header}.${payload}.sig`
}

beforeEach(() => {
  setActivePinia(createPinia())
  mockedAxios.get.mockReset()
  mockedAxios.post.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useApp store', () => {
  it('starts with empty state', () => {
    const s = useApp()
    expect(s.jwt).toBe('')
    expect(s.apiUrl).toBe('')
    expect(s.loading).toBe(false)
    expect(s.userRole).toBeNull()
  })

  describe('fetchApiUrl', () => {
    it('populates apiUrl + eliseUrl + strips trailing slashes', async () => {
      mockedAxios.get.mockResolvedValue({ data: { GLB_API_URL: 'https://api.example.com///', GLB_ELISE_URL: 'https://elise' } })
      const s = useApp()
      await s.fetchApiUrl()
      expect(s.apiUrl).toBe('https://api.example.com')
    })
  })

  describe('login', () => {
    it('stores the jwt on a non-TOTP login', async () => {
      const s = useApp()
      s.apiUrl = 'https://api.example.com'
      mockedAxios.post.mockResolvedValue({ data: { jwt: makeJwtForRole('Admin') } })
      const r = await s.login('a@b.co', 'pw')
      expect(r).toEqual({})
      expect(s.jwt).toContain('.')
    })

    it('returns {requiresTotp,tempToken} when TOTP demanded', async () => {
      const s = useApp()
      mockedAxios.post.mockResolvedValue({ data: { requiresTotp: true, tempToken: 'tmp' } })
      const r = await s.login('a@b.co', 'pw')
      expect(r).toEqual({ requiresTotp: true, tempToken: 'tmp' })
      expect(s.jwt).toBe('')
    })
  })

  describe('loginTotp', () => {
    it('stores the jwt on success', async () => {
      const s = useApp()
      mockedAxios.post.mockResolvedValue({ data: { jwt: makeJwtForRole('PM') } })
      await s.loginTotp('tmp', '123456')
      expect(s.jwt).toContain('.')
    })
  })

  describe('logout', () => {
    it('clears jwt + hits /hook/logout', async () => {
      const s = useApp()
      s.jwt = 'something'
      mockedAxios.get.mockResolvedValue({ data: undefined })
      await s.logout()
      expect(s.jwt).toBe('')
    })

    it('swallows /hook/logout failure', async () => {
      const s = useApp()
      s.jwt = 'something'
      mockedAxios.get.mockRejectedValue(new Error('network'))
      await expect(s.logout()).resolves.toBeUndefined()
      expect(s.jwt).toBe('')
    })
  })

  describe('userRole computed', () => {
    it('decodes the role claim from the JWT', () => {
      const s = useApp()
      s.jwt = makeJwtForRole('Admin')
      expect(s.userRole).toBe('Admin')
    })

    it('returns null for an empty jwt', () => {
      const s = useApp()
      expect(s.userRole).toBeNull()
    })

    it('returns null on a malformed jwt', () => {
      const s = useApp()
      s.jwt = 'not-a-jwt'
      expect(s.userRole).toBeNull()
    })
  })

  describe('authHeader', () => {
    it('returns an empty object when not authenticated', () => {
      const s = useApp()
      expect(s.authHeader()).toEqual({})
    })

    it('returns Bearer header when authenticated', () => {
      const s = useApp()
      s.jwt = 'abc'
      expect(s.authHeader()).toEqual({ Authorization: 'Bearer abc' })
    })
  })

  describe('setLoading', () => {
    it('flips loading flag', () => {
      const s = useApp()
      s.setLoading(true)
      expect(s.loading).toBe(true)
      s.setLoading(false)
      expect(s.loading).toBe(false)
    })
  })

  describe('fetchJwt + storeGuidDevMode', () => {
    it('fetchJwt sets jwt on success', async () => {
      const s = useApp()
      mockedAxios.get.mockResolvedValue({ data: { jwt: 'guid-jwt' } })
      await s.fetchJwt('the-guid')
      expect(s.jwt).toBe('guid-jwt')
    })

    it('fetchJwt rethrows on failure', async () => {
      mockedAxios.get.mockRejectedValue(new Error('400'))
      const s = useApp()
      await expect(s.fetchJwt('x')).rejects.toThrow()
    })

    it('storeGuidDevMode posts the right payload', async () => {
      mockedAxios.post.mockResolvedValue({ data: undefined })
      const s = useApp()
      s.apiUrl = 'https://api'
      await s.storeGuidDevMode('the-guid')
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api/hook/storeNewGuid',
        expect.objectContaining({
          parameters: expect.objectContaining({ guid: 'the-guid' }),
        }),
      )
    })

    it('storeGuidDevMode rethrows on failure', async () => {
      mockedAxios.post.mockRejectedValue(new Error('500'))
      const s = useApp()
      await expect(s.storeGuidDevMode('g')).rejects.toThrow()
    })
  })

  describe('getSample / updateSample', () => {
    it('getSample returns response.data', async () => {
      mockedAxios.get.mockResolvedValue({ data: { hello: 'world' } })
      const s = useApp()
      const r = await s.getSample()
      expect(r).toEqual({ hello: 'world' })
    })

    it('updateSample posts payload + returns response.data', async () => {
      mockedAxios.post.mockResolvedValue({ data: { ok: true } })
      const s = useApp()
      const r = await s.updateSample({ a: 1 } as never)
      expect(r).toEqual({ ok: true })
    })

    it('getSample rethrows on failure', async () => {
      mockedAxios.get.mockRejectedValue(new Error('500'))
      const s = useApp()
      await expect(s.getSample()).rejects.toThrow()
    })

    it('updateSample rethrows on failure', async () => {
      mockedAxios.post.mockRejectedValue(new Error('500'))
      const s = useApp()
      await expect(s.updateSample({} as never)).rejects.toThrow()
    })
  })
})
