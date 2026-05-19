/**
 * @file useDarkMode.spec.ts
 * Tests the dark-mode composable: localStorage round-trip, document.documentElement
 * .dark / .p-dark class toggling, and the async loadFromBackend with axios mocked.
 *
 * Important: `useDarkMode` keeps `isDark` as a module-level singleton that is
 * initialised at import time from localStorage. Each test resets localStorage,
 * the documentElement classList, and re-imports the module via `vi.resetModules`
 * so its module-level state starts fresh.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

vi.mock('axios', () => {
  const get = vi.fn()
  const put = vi.fn()
  return { default: { get, put }, get, put }
})

async function loadComposable() {
  const mod = await import('./useDarkMode')
  return mod.useDarkMode()
}

describe('useDarkMode', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    document.documentElement.classList.remove('dark', 'p-dark')
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('initialises isDark=false when no preference is stored', async () => {
    const { isDark } = await loadComposable()
    expect(isDark.value).toBe(false)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('initialises isDark=true and applies .dark class when localStorage darkMode=true', async () => {
    localStorage.setItem('darkMode', 'true')
    const { isDark } = await loadComposable()
    expect(isDark.value).toBe(true)
    // Module-load side effect applied the class before any component mounted.
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('toggle() flips isDark, persists to localStorage, and toggles both .dark + .p-dark', async () => {
    const { isDark, toggle } = await loadComposable()
    expect(isDark.value).toBe(false)

    toggle()
    expect(isDark.value).toBe(true)
    expect(localStorage.getItem('darkMode')).toBe('true')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.classList.contains('p-dark')).toBe(true)

    toggle()
    expect(isDark.value).toBe(false)
    expect(localStorage.getItem('darkMode')).toBe('false')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.documentElement.classList.contains('p-dark')).toBe(false)
  })

  it('toggle() fires axios PUT only after loadFromBackend has registered token + apiBase', async () => {
    const axios = (await import('axios')).default as unknown as {
      put: ReturnType<typeof vi.fn>
      get: ReturnType<typeof vi.fn>
    }
    const { toggle, loadFromBackend } = await loadComposable()

    // Before loadFromBackend, savePreference is a no-op — no PUT.
    toggle()
    expect(axios.put).not.toHaveBeenCalled()

    axios.get.mockResolvedValueOnce({ data: { darkMode: false } })
    await loadFromBackend('TOKEN', 'https://api')

    axios.put.mockResolvedValueOnce({ data: {} })
    toggle()
    // Fire-and-forget — wait a tick for the awaited fetch to schedule.
    await Promise.resolve()
    expect(axios.put).toHaveBeenCalledWith(
      'https://api/api/userprofile/preferences',
      { darkMode: true },
      { headers: { Authorization: 'Bearer TOKEN' } },
    )
  })

  it('loadFromBackend overrides localStorage when the backend returns darkMode:true', async () => {
    const axios = (await import('axios')).default as unknown as { get: ReturnType<typeof vi.fn> }
    const { isDark, loadFromBackend } = await loadComposable()
    expect(isDark.value).toBe(false)

    axios.get.mockResolvedValueOnce({ data: { darkMode: true } })
    await loadFromBackend('TOKEN', 'https://api')

    expect(isDark.value).toBe(true)
    expect(localStorage.getItem('darkMode')).toBe('true')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('loadFromBackend silently swallows axios errors (offline / 401)', async () => {
    const axios = (await import('axios')).default as unknown as { get: ReturnType<typeof vi.fn> }
    const { isDark, loadFromBackend } = await loadComposable()
    axios.get.mockRejectedValueOnce(new Error('Network down'))
    await expect(loadFromBackend('TOKEN', 'https://api')).resolves.toBeUndefined()
    expect(isDark.value).toBe(false)
  })

  it('savePreference silently swallows axios PUT failures', async () => {
    const axios = (await import('axios')).default as unknown as {
      put: ReturnType<typeof vi.fn>
      get: ReturnType<typeof vi.fn>
    }
    const { toggle, loadFromBackend } = await loadComposable()

    axios.get.mockResolvedValueOnce({ data: {} })
    await loadFromBackend('TOKEN', 'https://api')

    axios.put.mockRejectedValueOnce(new Error('boom'))
    expect(() => toggle()).not.toThrow()
    // Wait microtask for the rejected PUT to settle.
    await new Promise((r) => setTimeout(r, 0))
  })

  it('ignores a non-boolean backend darkMode payload', async () => {
    const axios = (await import('axios')).default as unknown as { get: ReturnType<typeof vi.fn> }
    const { isDark, loadFromBackend } = await loadComposable()
    axios.get.mockResolvedValueOnce({ data: { darkMode: 'oui' } })
    await loadFromBackend('TOKEN', 'https://api')
    expect(isDark.value).toBe(false)
  })
})
