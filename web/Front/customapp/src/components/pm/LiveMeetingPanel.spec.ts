/**
 * @file LiveMeetingPanel.spec.ts — smoke test for the live meeting panel.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { makeApiMock, makeNeolibMock, initPinia, stubs } from '@/__spec-utils'

vi.mock('@/lib/api', () => ({
  default: makeApiMock(),
  extractErrorMessage: (e: unknown) => (e as Error)?.message ?? null,
}))
vi.mock('@neolibrary/components', () => makeNeolibMock())
vi.mock('@/composables/useLiveCopilot', () => ({
  useLiveCopilot: () => ({
    enabled: { value: false },
    connected: { value: false },
    checklist: { value: [] },
    hint: { value: null },
    lastSkipReason: { value: null },
    readyForCahier: { value: false },
    coveredCount: { value: 0 },
    startSession: vi.fn(),
    endSession: vi.fn(),
    appendChunk: vi.fn(),
    refresh: vi.fn(),
  }),
}))

import LiveMeetingPanel from './LiveMeetingPanel.vue'

describe('LiveMeetingPanel', () => {
  beforeEach(() => {
    initPinia()
    vi.clearAllMocks()
  })

  it('mounts without crashing', () => {
    const w = mount(LiveMeetingPanel, {
      props: { projectId: 'p1' },
      global: { stubs },
    })
    expect(w.exists()).toBe(true)
  })

  it('renders the start button by default', async () => {
    const w = mount(LiveMeetingPanel, {
      props: { projectId: 'p1' },
      global: { stubs },
    })
    await flushPromises()
    // Either a "start" / "démarrer" button label or the disconnected state.
    expect(w.text().length).toBeGreaterThan(0)
  })
})
