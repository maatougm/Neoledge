/**
 * @file MeetingSection.spec.ts — smoke test for the meetings list panel.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { makeApiMock, makeNeolibMock, initPinia, stubs } from '@/__spec-utils'

vi.mock('@/lib/api', () => ({
  default: makeApiMock(),
  extractErrorMessage: (e: unknown) => (e as Error)?.message ?? null,
}))
vi.mock('@neolibrary/components', () => makeNeolibMock())

import MeetingSection from './MeetingSection.vue'

describe('MeetingSection', () => {
  beforeEach(() => {
    initPinia()
    vi.clearAllMocks()
  })

  it('mounts without crashing', async () => {
    const w = mount(MeetingSection, {
      props: { projectId: 'p1' },
      global: { stubs },
    })
    await flushPromises()
    expect(w.exists()).toBe(true)
  })

  it('accepts a readonly prop', () => {
    const w = mount(MeetingSection, {
      props: { projectId: 'p1', readonly: true },
      global: { stubs },
    })
    expect(w.exists()).toBe(true)
  })
})
