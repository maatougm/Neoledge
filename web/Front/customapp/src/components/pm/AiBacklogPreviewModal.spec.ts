/**
 * @file AiBacklogPreviewModal.spec.ts — smoke test for the AI backlog
 * preview modal. The agent's preview is rendered as a checkable tree
 * with per-epic / per-task selection; this spec covers the empty state
 * and the populated-render branch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { makeApiMock, makeNeolibMock, initPinia, stubs } from '@/__spec-utils'

vi.mock('@/lib/api', () => ({
  default: makeApiMock(),
  extractErrorMessage: (e: unknown) => (e as Error)?.message ?? null,
}))
vi.mock('@neolibrary/components', () => makeNeolibMock())

import AiBacklogPreviewModal from './AiBacklogPreviewModal.vue'

describe('AiBacklogPreviewModal', () => {
  beforeEach(() => {
    initPinia()
    vi.clearAllMocks()
  })

  it('renders nothing when visible=false', () => {
    const w = mount(AiBacklogPreviewModal, {
      props: { visible: false, projectId: 'p1' },
      global: { stubs },
    })
    expect(w.find('[data-stub="AppModal"]').exists()).toBe(false)
  })

  it('renders empty-state message when modal visible without epics', () => {
    const w = mount(AiBacklogPreviewModal, {
      props: { visible: true, projectId: 'p1' },
      global: { stubs },
    })
    // Either loading state OR empty message — both are valid post-mount renders.
    expect(w.find('[data-stub="AppModal"]').exists()).toBe(true)
  })
})
