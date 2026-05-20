/** Smoke test — ProjectEditDialog (visibility + project prop). */
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

import ProjectEditDialog from './ProjectEditDialog.vue'

const baseProject = {
  id: 'p1',
  name: 'Projet Alpha',
  clientName: 'ACME',
  projectManagerName: 'Marie',
  projectManagerEmail: 'marie@x.com',
  status: 'Kickoff',
  startDate: '2026-04-01',
  endDate: '2026-06-01',
  createdAt: '2026-03-01T00:00:00Z',
}

beforeEach(() => setActivePinia(createPinia()))

describe('ProjectEditDialog', () => {
  it('mounts hidden when visible=false', () => {
    const w = mount(ProjectEditDialog, {
      global: { stubs: NEO_LIBRARY_STUBS },
      props: { visible: false, project: baseProject as never },
    })
    expect(w.exists()).toBe(true)
  })

  it('mounts visible with a project', () => {
    const w = mount(ProjectEditDialog, {
      global: { stubs: NEO_LIBRARY_STUBS },
      props: { visible: true, project: baseProject as never },
    })
    expect(w.exists()).toBe(true)
  })

  it('mounts with null project', () => {
    const w = mount(ProjectEditDialog, {
      global: { stubs: NEO_LIBRARY_STUBS },
      props: { visible: true, project: null },
    })
    expect(w.exists()).toBe(true)
  })
})
