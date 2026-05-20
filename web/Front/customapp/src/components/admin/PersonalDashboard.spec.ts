/** Smoke test — PersonalDashboard. */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { NEO_LIBRARY_STUBS, NEO_TOAST_MOCK } from './__test-helpers__/stubs'

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn().mockResolvedValue({ data: [] }), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))
vi.mock('@neolibrary/components', async () => ({
  ...NEO_LIBRARY_STUBS,
  useNeoToast: () => NEO_TOAST_MOCK,
}))

import PersonalDashboard from './PersonalDashboard.vue'

beforeEach(() => setActivePinia(createPinia()))

describe('PersonalDashboard', () => {
  it('mounts with userId', () => {
    const w = mount(PersonalDashboard, {
      global: { stubs: NEO_LIBRARY_STUBS },
      props: { userId: 'u1' },
    })
    expect(w.exists()).toBe(true)
  })
})
