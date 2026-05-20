/**
 * @file MeetingExtrasTabs.spec.ts — smoke test for the per-meeting
 * agenda + attendees + outcomes tabs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { makeApiMock, makeNeolibMock, initPinia, stubs } from '@/__spec-utils'

vi.mock('@/lib/api', () => ({
  default: makeApiMock(),
  extractErrorMessage: (e: unknown) => (e as Error)?.message ?? null,
}))
vi.mock('@neolibrary/components', () => makeNeolibMock())

import MeetingExtrasTabs from './MeetingExtrasTabs.vue'

describe('MeetingExtrasTabs', () => {
  beforeEach(() => {
    initPinia()
    vi.clearAllMocks()
  })

  it('mounts without crashing', () => {
    const w = mount(MeetingExtrasTabs, {
      props: { projectId: 'p1', meetingId: 'm1' },
      global: { stubs },
    })
    expect(w.exists()).toBe(true)
  })
})
