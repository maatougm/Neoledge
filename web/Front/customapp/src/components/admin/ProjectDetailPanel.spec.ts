/** Smoke test — ProjectDetailPanel. */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { NEO_LIBRARY_STUBS, NEO_TOAST_MOCK, NEO_CONFIRM_MOCK } from './__test-helpers__/stubs'

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn().mockResolvedValue({ data: {} }), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))
vi.mock('@neolibrary/components', async () => ({
  ...NEO_LIBRARY_STUBS,
  useNeoToast: () => NEO_TOAST_MOCK,
  useNeoConfirm: () => NEO_CONFIRM_MOCK,
}))

import ProjectDetailPanel from './ProjectDetailPanel.vue'

beforeEach(() => setActivePinia(createPinia()))

describe('ProjectDetailPanel', () => {
  it('mounts with projectId prop', () => {
    const w = mount(ProjectDetailPanel, {
      global: { stubs: NEO_LIBRARY_STUBS },
      props: { projectId: 'p1' },
    })
    expect(w.exists()).toBe(true)
  })
})
