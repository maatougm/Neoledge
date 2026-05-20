/**
 * @file api.spec.ts — unit tests for the shared axios singleton + helpers.
 *
 * `api` is a module-level axios instance whose interceptors are attached
 * at import time. Rather than patching the module internals, we exercise
 * the live instance with a custom axios `adapter` that we mount via
 * `api.defaults.adapter` — this gives us control over the round-trip
 * without monkeypatching `fetch`.
 *
 * We also unit-test `extractErrorMessage` directly since it's a pure
 * function suitable for synchronous assertions.
 *
 * The two side-effects to verify on the response interceptor:
 *   1. 401 (non-auth-endpoint) → authStore.clear() + router.push('login')
 *   2. 5xx (not suppressed)    → useNeoToast().add('error', ...)
 *   3. 4xx                     → no toast (silent for the caller)
 *   4. suppressErrorToast=true → 5xx is silent
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios'

// ─── Mocks that need to be in place BEFORE `./api` is imported ───────────────

const mockToastAdd = vi.fn()
vi.mock('@neolibrary/components', () => ({
  useNeoToast: () => ({ add: mockToastAdd }),
}))

const mockRouterPush = vi.fn()
const mockRouterReplace = vi.fn()
vi.mock('@/router', () => ({
  default: {
    push: mockRouterPush,
    replace: mockRouterReplace,
    currentRoute: { value: { path: '/somewhere' } },
  },
}))

// ─── Pull api + helper after mocks ───────────────────────────────────────────
//
// Vitest hoists vi.mock calls to the top of the file before any import, so
// importing here is safe — the mocks are already installed by the time the
// real module sees `useNeoToast` / `router`.

import api, { extractErrorMessage } from './api'
import { useAuthStore } from '@/stores/authStore'
import { useConfigStore } from '@/stores/configStore'

// ─── Adapter helper — installs a one-shot response/error pair on the
//     singleton, captures the outgoing config, and restores after. ──────────

interface CapturedRequest {
  url?: string
  headers?: Record<string, unknown>
  config: AxiosRequestConfig
}

function installAdapter(
  result:
    | { type: 'response'; status: number; data: unknown }
    | { type: 'error'; status?: number; data?: unknown; message?: string },
): { captured: { request?: CapturedRequest }; restore: () => void } {
  const captured: { request?: CapturedRequest } = {}
  const prior = api.defaults.adapter
  api.defaults.adapter = (cfg: AxiosRequestConfig) => {
    captured.request = {
      url: cfg.url,
      headers: cfg.headers as Record<string, unknown>,
      config: cfg,
    }
    if (result.type === 'response') {
      return Promise.resolve({
        data: result.data,
        status: result.status,
        statusText: 'OK',
        headers: {},
        config: cfg as never,
      } as AxiosResponse)
    }
    const err = new Error(result.message ?? 'mock failure') as AxiosError
    err.config = cfg as never
    if (result.status !== undefined) {
      ;(err as { response?: unknown }).response = {
        status: result.status,
        data: result.data ?? {},
        statusText: '',
        headers: {},
        config: cfg as never,
      }
    }
    return Promise.reject(err)
  }
  return { captured, restore: () => { api.defaults.adapter = prior } }
}

beforeEach(() => {
  setActivePinia(createPinia())
  mockToastAdd.mockReset()
  mockRouterPush.mockReset()
  mockRouterReplace.mockReset()
})
afterEach(() => {
  // Reset any per-test adapter overrides.
  delete (api.defaults as { adapter?: unknown }).adapter
})

// ─── extractErrorMessage ─────────────────────────────────────────────────────

describe('extractErrorMessage', () => {
  it('returns null when error is null / not an object', () => {
    expect(extractErrorMessage(null)).toBeNull()
    expect(extractErrorMessage(undefined)).toBeNull()
    expect(extractErrorMessage('string')).toBeNull()
    expect(extractErrorMessage(42)).toBeNull()
  })

  it('returns response.data.message when it is a string', () => {
    expect(extractErrorMessage({ response: { data: { message: 'Bad' } } })).toBe('Bad')
  })

  it('joins response.data.message when it is an array', () => {
    expect(extractErrorMessage({ response: { data: { message: ['a', 'b', 'c'] } } })).toBe('a, b, c')
  })

  it('falls back to response.data.error', () => {
    expect(extractErrorMessage({ response: { data: { error: 'fallback' } } })).toBe('fallback')
  })

  it('falls back to error.message when no response data', () => {
    expect(extractErrorMessage({ message: 'network' })).toBe('network')
  })

  it('returns null when nothing extractable', () => {
    expect(extractErrorMessage({})).toBeNull()
  })

  it('prefers message over error when both present', () => {
    expect(extractErrorMessage({ response: { data: { message: 'msg', error: 'err' } } })).toBe('msg')
  })
})

// ─── Request interceptor ─────────────────────────────────────────────────────

describe('api request interceptor', () => {
  it('attaches Authorization: Bearer <jwt> when authStore has a JWT', async () => {
    const auth = useAuthStore()
    auth.jwt = 'test-jwt-value'

    const { captured, restore } = installAdapter({ type: 'response', status: 200, data: { ok: true } })
    try {
      await api.get('/whatever')
      expect(captured.request?.headers?.['Authorization']).toBe('Bearer test-jwt-value')
    } finally {
      restore()
    }
  })

  it('does NOT attach Authorization when no JWT is present', async () => {
    const { captured, restore } = installAdapter({ type: 'response', status: 200, data: {} })
    try {
      await api.get('/whatever')
      expect(captured.request?.headers?.['Authorization']).toBeUndefined()
    } finally {
      restore()
    }
  })

  it('prefixes relative URLs with configStore.apiUrl', async () => {
    const config = useConfigStore()
    config.apiUrl = 'https://api.example.com'

    const { captured, restore } = installAdapter({ type: 'response', status: 200, data: {} })
    try {
      await api.get('/foo/bar')
      expect(captured.request?.url).toBe('https://api.example.com/foo/bar')
    } finally {
      restore()
    }
  })

  it('does NOT prefix absolute URLs', async () => {
    const config = useConfigStore()
    config.apiUrl = 'https://api.example.com'

    const { captured, restore } = installAdapter({ type: 'response', status: 200, data: {} })
    try {
      await api.get('https://other.example.com/x')
      expect(captured.request?.url).toBe('https://other.example.com/x')
    } finally {
      restore()
    }
  })
})

// ─── Response interceptor — 5xx auto-toast ───────────────────────────────────

describe('api response interceptor — 5xx auto-toast', () => {
  it('toasts an error for 5xx responses', async () => {
    const { restore } = installAdapter({
      type: 'error',
      status: 500,
      data: { message: 'boom' },
    })
    try {
      await expect(api.get('/x')).rejects.toBeTruthy()
      expect(mockToastAdd).toHaveBeenCalledWith({
        severity: 'error',
        detail: 'boom',
        life: 5000,
      })
    } finally {
      restore()
    }
  })

  it('uses generic "Erreur N" when no body message AND no Error.message extractable', async () => {
    // Pass empty error.message so extractErrorMessage falls through to the
    // generic `Erreur ${status}` fallback.
    const { restore } = installAdapter({
      type: 'error',
      status: 503,
      data: {},
      message: '',
    })
    try {
      await expect(api.get('/x')).rejects.toBeTruthy()
      expect(mockToastAdd).toHaveBeenCalledWith({
        severity: 'error',
        detail: 'Erreur 503',
        life: 5000,
      })
    } finally {
      restore()
    }
  })

  it('falls back to error.message when response body has no message', async () => {
    // Confirms the extractErrorMessage chain: data.message → data.error → e.message.
    const { restore } = installAdapter({
      type: 'error',
      status: 502,
      data: {},
      message: 'network down',
    })
    try {
      await expect(api.get('/x')).rejects.toBeTruthy()
      expect(mockToastAdd).toHaveBeenCalledWith({
        severity: 'error',
        detail: 'network down',
        life: 5000,
      })
    } finally {
      restore()
    }
  })

  it('does NOT toast 4xx responses (business errors are caller-handled)', async () => {
    const { restore } = installAdapter({
      type: 'error',
      status: 400,
      data: { message: 'validation failed' },
    })
    try {
      await expect(api.get('/x')).rejects.toBeTruthy()
      expect(mockToastAdd).not.toHaveBeenCalled()
    } finally {
      restore()
    }
  })

  it('does NOT toast 5xx when suppressErrorToast=true', async () => {
    const { restore } = installAdapter({
      type: 'error',
      status: 500,
      data: { message: 'silent' },
    })
    try {
      await expect(
        api.get('/x', { suppressErrorToast: true } as AxiosRequestConfig),
      ).rejects.toBeTruthy()
      expect(mockToastAdd).not.toHaveBeenCalled()
    } finally {
      restore()
    }
  })
})

// ─── Response interceptor — 401 handling ─────────────────────────────────────

describe('api response interceptor — 401', () => {
  it('clears authStore on 401 (non-auth endpoint)', async () => {
    const auth = useAuthStore()
    auth.jwt = 'old-jwt'
    const clearSpy = vi.spyOn(auth, 'clear')

    const { restore } = installAdapter({ type: 'error', status: 401, data: {} })
    try {
      await expect(api.get('/protected')).rejects.toBeTruthy()
      expect(clearSpy).toHaveBeenCalled()
    } finally {
      restore()
    }
  })

  it('does NOT clear authStore on 401 from /auth/login (login itself can 401)', async () => {
    const auth = useAuthStore()
    auth.jwt = 'old-jwt'
    const clearSpy = vi.spyOn(auth, 'clear')

    const { restore } = installAdapter({ type: 'error', status: 401, data: {} })
    try {
      await expect(api.post('/auth/login', {})).rejects.toBeTruthy()
      expect(clearSpy).not.toHaveBeenCalled()
    } finally {
      restore()
    }
  })
})
