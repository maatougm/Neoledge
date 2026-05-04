/**
 * @file     useDarkMode.spec.ts
 * @module   NeoLeadge — Deployment Manager
 * @desc     Unit tests for the useDarkMode composable
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import axios from 'axios'

// ── Mock axios before importing the composable ────────────────────────────────
vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    put: vi.fn(),
  },
}))

const mockedAxios = axios as unknown as {
  get: ReturnType<typeof vi.fn>
  put: ReturnType<typeof vi.fn>
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function resetDocumentClass(): void {
  document.documentElement.classList.remove('dark')
}

function setLocalStorage(value: string | null): void {
  if (value === null) {
    localStorage.removeItem('darkMode')
  } else {
    localStorage.setItem('darkMode', value)
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('useDarkMode', () => {
  beforeEach(async () => {
    resetDocumentClass()
    setLocalStorage('false')
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('toggle() flips isDark from false to true', async () => {
    setLocalStorage('false')
    const { useDarkMode } = await import('../useDarkMode')
    const { isDark, toggle } = useDarkMode()
    isDark.value = false
    toggle()
    expect(isDark.value).toBe(true)
  })

  it('toggle() sets localStorage darkMode to "true"', async () => {
    setLocalStorage('false')
    const { useDarkMode } = await import('../useDarkMode')
    const { isDark, toggle } = useDarkMode()
    isDark.value = false
    toggle()
    expect(localStorage.getItem('darkMode')).toBe('true')
  })

  it('toggle() adds "dark" class to documentElement', async () => {
    setLocalStorage('false')
    const { useDarkMode } = await import('../useDarkMode')
    const { isDark, toggle } = useDarkMode()
    isDark.value = false
    document.documentElement.classList.remove('dark')
    toggle()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('toggle() removes "dark" class when toggling back off', async () => {
    setLocalStorage('true')
    const { useDarkMode } = await import('../useDarkMode')
    const { isDark, toggle } = useDarkMode()
    isDark.value = true
    document.documentElement.classList.add('dark')
    toggle()
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('toggle() sets localStorage darkMode to "false" when toggling off', async () => {
    setLocalStorage('true')
    const { useDarkMode } = await import('../useDarkMode')
    const { isDark, toggle } = useDarkMode()
    isDark.value = true
    toggle()
    expect(localStorage.getItem('darkMode')).toBe('false')
  })

  it('loadFromBackend() applies backend darkMode value when true', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { darkMode: true } })
    const { useDarkMode } = await import('../useDarkMode')
    const { isDark, loadFromBackend } = useDarkMode()
    isDark.value = false
    document.documentElement.classList.remove('dark')

    await loadFromBackend('fake-token', 'http://localhost:3000')

    expect(isDark.value).toBe(true)
    expect(localStorage.getItem('darkMode')).toBe('true')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('loadFromBackend() applies backend darkMode value when false', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { darkMode: false } })
    const { useDarkMode } = await import('../useDarkMode')
    const { isDark, loadFromBackend } = useDarkMode()
    isDark.value = true
    document.documentElement.classList.add('dark')

    await loadFromBackend('fake-token', 'http://localhost:3000')

    expect(isDark.value).toBe(false)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('loadFromBackend() silently ignores network errors', async () => {
    mockedAxios.get.mockRejectedValueOnce(new Error('Network error'))
    const { useDarkMode } = await import('../useDarkMode')
    const { isDark, loadFromBackend } = useDarkMode()
    isDark.value = false

    await expect(loadFromBackend('fake-token', 'http://localhost:3000')).resolves.toBeUndefined()
    expect(isDark.value).toBe(false)
  })

  it('savePreference() calls PUT /api/userprofile/preferences with darkMode value', async () => {
    mockedAxios.put.mockResolvedValueOnce({})
    mockedAxios.get.mockResolvedValueOnce({ data: { darkMode: true } })

    const { useDarkMode } = await import('../useDarkMode')
    const { toggle, loadFromBackend } = useDarkMode()

    // Set token/apiBase via loadFromBackend
    await loadFromBackend('test-token', 'http://api.test')

    mockedAxios.put.mockClear()
    toggle()

    // Give the microtask queue a tick to let the async savePreference fire
    await Promise.resolve()

    expect(mockedAxios.put).toHaveBeenCalledWith(
      'http://api.test/api/userprofile/preferences',
      expect.objectContaining({ darkMode: expect.any(Boolean) }),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-token' }) }),
    )
  })
})
