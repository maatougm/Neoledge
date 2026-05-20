/** Smoke test — ProjectCreateForm. */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { NEO_LIBRARY_STUBS, NEO_TOAST_MOCK } from './__test-helpers__/stubs'

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn().mockResolvedValue({ data: [] }), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))
vi.mock('@neolibrary/components', async () => ({
  ...NEO_LIBRARY_STUBS,
  useNeoToast: () => NEO_TOAST_MOCK,
}))

import ProjectCreateForm from './ProjectCreateForm.vue'

// Component watches `route.params.id` (the reset-on-navigate guard) — supplying
// a router is mandatory or the `watch()` setup-time call throws.
const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/:id?', component: { template: '<div/>' } }],
})

beforeEach(async () => {
  setActivePinia(createPinia())
  await router.push('/')
})

describe('ProjectCreateForm', () => {
  it('mounts without throwing', async () => {
    const w = mount(ProjectCreateForm, {
      global: { plugins: [router], stubs: NEO_LIBRARY_STUBS },
    })
    expect(w.exists()).toBe(true)
  })
})
