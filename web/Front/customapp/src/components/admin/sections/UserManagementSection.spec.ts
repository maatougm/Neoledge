/** Smoke test — UserManagementSection. */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { NEO_LIBRARY_STUBS, NEO_TOAST_MOCK, NEO_CONFIRM_MOCK } from '../__test-helpers__/stubs'

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn().mockResolvedValue({ data: [] }), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))
vi.mock('@neolibrary/components', async () => ({
  ...NEO_LIBRARY_STUBS,
  useNeoToast: () => NEO_TOAST_MOCK,
  useNeoConfirm: () => NEO_CONFIRM_MOCK,
}))

import UserManagementSection from './UserManagementSection.vue'

beforeEach(() => setActivePinia(createPinia()))

describe('UserManagementSection', () => {
  it('mounts without throwing', () => {
    const w = mount(UserManagementSection, { global: { stubs: NEO_LIBRARY_STUBS } })
    expect(w.exists()).toBe(true)
  })
})
