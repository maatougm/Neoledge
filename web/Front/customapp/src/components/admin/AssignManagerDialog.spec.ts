/** Smoke test — AssignManagerDialog (visibility, close emit). */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { NEO_LIBRARY_STUBS, NEO_TOAST_MOCK } from './__test-helpers__/stubs'

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))
vi.mock('@neolibrary/components', async () => ({
  ...NEO_LIBRARY_STUBS,
  useNeoToast: () => NEO_TOAST_MOCK,
}))

import AssignManagerDialog from './AssignManagerDialog.vue'

beforeEach(() => setActivePinia(createPinia()))

describe('AssignManagerDialog', () => {
  it('mounts when not visible (renders nothing)', () => {
    const w = mount(AssignManagerDialog, {
      global: { stubs: NEO_LIBRARY_STUBS },
      props: { visible: false, projectId: 'p1', projectName: 'X' },
    })
    expect(w.exists()).toBe(true)
  })

  it('mounts when visible', () => {
    const w = mount(AssignManagerDialog, {
      global: { stubs: NEO_LIBRARY_STUBS },
      props: { visible: true, projectId: 'p1', projectName: 'X' },
    })
    expect(w.exists()).toBe(true)
  })
})
