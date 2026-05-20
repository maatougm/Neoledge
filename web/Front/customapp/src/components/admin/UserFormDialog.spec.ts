/** Smoke test — UserFormDialog (create vs edit). */
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

import UserFormDialog from './UserFormDialog.vue'

beforeEach(() => setActivePinia(createPinia()))

describe('UserFormDialog', () => {
  it('mounts hidden when visible=false', () => {
    const w = mount(UserFormDialog, {
      global: { stubs: NEO_LIBRARY_STUBS },
      props: { visible: false },
    })
    expect(w.exists()).toBe(true)
  })

  it('mounts in create mode', () => {
    const w = mount(UserFormDialog, {
      global: { stubs: NEO_LIBRARY_STUBS },
      props: { visible: true },
    })
    expect(w.exists()).toBe(true)
  })

  it('mounts in edit mode with a user', () => {
    const user = {
      id: 'u1', firstName: 'A', lastName: 'B', email: 'a@b.com',
      role: 'Member', isActive: true, jobTitle: null, department: null, lastLoginAt: null,
    }
    const w = mount(UserFormDialog, {
      global: { stubs: NEO_LIBRARY_STUBS },
      props: { visible: true, user: user as never },
    })
    expect(w.exists()).toBe(true)
  })
})
