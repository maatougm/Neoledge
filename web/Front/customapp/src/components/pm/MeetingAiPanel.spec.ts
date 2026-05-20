/**
 * @file MeetingAiPanel.spec.ts — smoke test for the per-meeting AI panel
 * (shows summary + action items + decisions for one meeting).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { makeApiMock, makeNeolibMock, initPinia, stubs } from '@/__spec-utils'

vi.mock('@/lib/api', () => ({
  default: makeApiMock(),
  extractErrorMessage: (e: unknown) => (e as Error)?.message ?? null,
}))
vi.mock('@neolibrary/components', () => makeNeolibMock())

import MeetingAiPanel from './MeetingAiPanel.vue'

describe('MeetingAiPanel', () => {
  beforeEach(() => {
    initPinia()
    vi.clearAllMocks()
  })

  it('mounts without crashing', () => {
    const w = mount(MeetingAiPanel, {
      props: { projectId: 'p1', meetingId: 'm1' },
      global: { stubs },
    })
    expect(w.exists()).toBe(true)
  })
})
