/** Smoke test — UserList (renders empty and with users). */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { NEO_LIBRARY_STUBS, NEO_TOAST_MOCK, NEO_CONFIRM_MOCK } from './__test-helpers__/stubs'

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))
vi.mock('@neolibrary/components', async () => ({
  ...NEO_LIBRARY_STUBS,
  useNeoToast: () => NEO_TOAST_MOCK,
  useNeoConfirm: () => NEO_CONFIRM_MOCK,
}))

import UserList from './UserList.vue'

beforeEach(() => setActivePinia(createPinia()))

describe('UserList', () => {
  it('mounts with empty users', () => {
    const w = mount(UserList, {
      global: { stubs: NEO_LIBRARY_STUBS },
      props: { users: [] },
    })
    expect(w.exists()).toBe(true)
  })

  it('mounts with one user', () => {
    const users = [{
      id: 'u1', firstName: 'A', lastName: 'B', email: 'a@b.com',
      role: 'Member', isActive: true, jobTitle: null, department: null, lastLoginAt: null,
    }]
    const w = mount(UserList, {
      global: { stubs: NEO_LIBRARY_STUBS },
      props: { users: users as never },
    })
    expect(w.exists()).toBe(true)
  })

  it('mounts without explicit users prop', () => {
    const w = mount(UserList, {
      global: { stubs: NEO_LIBRARY_STUBS },
    })
    expect(w.exists()).toBe(true)
  })
})
