/** Smoke test — SystemStatusSection. */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { NEO_LIBRARY_STUBS } from '../__test-helpers__/stubs'

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn().mockResolvedValue({ data: {} }), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))
vi.mock('@neolibrary/components', async () => ({ ...NEO_LIBRARY_STUBS }))

import SystemStatusSection from './SystemStatusSection.vue'

beforeEach(() => setActivePinia(createPinia()))

describe('SystemStatusSection', () => {
  it('mounts without throwing', () => {
    const w = mount(SystemStatusSection, { global: { stubs: NEO_LIBRARY_STUBS } })
    expect(w.exists()).toBe(true)
  })
})
