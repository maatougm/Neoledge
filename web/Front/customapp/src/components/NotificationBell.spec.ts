/**
 * @file NotificationBell.spec.ts — smoke test for the bell icon + dropdown.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { makeApiMock, makeNeolibMock, initPinia, stubs } from '@/__spec-utils'

vi.mock('@/lib/api', () => ({
  default: makeApiMock(),
  extractErrorMessage: (e: unknown) => (e as Error)?.message ?? null,
}))
vi.mock('@neolibrary/components', () => makeNeolibMock())
vi.mock('@/composables/useNotificationSocket', () => ({
  useNotificationSocket: () => ({ on: vi.fn(), off: vi.fn(), connected: { value: false } }),
}))
vi.mock('vue-router', async () => {
  const actual = await vi.importActual<typeof import('vue-router')>('vue-router')
  return { ...actual, useRouter: () => ({ push: vi.fn() }), useRoute: () => ({ query: {} }) }
})

import NotificationBell from './NotificationBell.vue'

describe('NotificationBell', () => {
  beforeEach(() => {
    initPinia()
    vi.clearAllMocks()
  })

  it('mounts without crashing', () => {
    const w = mount(NotificationBell, { global: { stubs } })
    expect(w.exists()).toBe(true)
  })
})
