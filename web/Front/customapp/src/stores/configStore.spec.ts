import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import axios from 'axios'

vi.mock('axios', () => ({
  default: { get: vi.fn() },
}))

import { useConfigStore } from './configStore'

const mockedAxios = axios as unknown as { get: ReturnType<typeof vi.fn> }

beforeEach(() => {
  setActivePinia(createPinia())
  mockedAxios.get.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('configStore', () => {
  it('starts with empty apiUrl and eliseUrl', () => {
    const store = useConfigStore()
    expect(store.apiUrl).toBe('')
    expect(store.eliseUrl).toBe('')
  })

  it('fetchConfig populates apiUrl + eliseUrl from config.json', async () => {
    mockedAxios.get.mockResolvedValue({
      data: { GLB_API_URL: 'https://api.example.com/', GLB_ELISE_URL: 'https://elise.example.com' },
    })
    const store = useConfigStore()
    await store.fetchConfig()
    expect(store.apiUrl).toBe('https://api.example.com') // trailing slash stripped
    expect(store.eliseUrl).toBe('https://elise.example.com')
  })

  it('fetchConfig is a no-op when apiUrl is already populated', async () => {
    const store = useConfigStore()
    store.apiUrl = 'https://already-set.example.com'
    await store.fetchConfig()
    expect(mockedAxios.get).not.toHaveBeenCalled()
  })

  it('falls back to window.location.origin when GLB_API_URL is empty', async () => {
    mockedAxios.get.mockResolvedValue({
      data: { GLB_API_URL: '', GLB_ELISE_URL: 'https://elise.example.com' },
    })
    const store = useConfigStore()
    await store.fetchConfig()
    expect(store.apiUrl).toBe(window.location.origin.replace(/\/+$/, ''))
  })

  it('treats missing GLB_ELISE_URL as empty string', async () => {
    mockedAxios.get.mockResolvedValue({
      data: { GLB_API_URL: 'https://api.example.com' },
    })
    const store = useConfigStore()
    await store.fetchConfig()
    expect(store.eliseUrl).toBe('')
  })
})
