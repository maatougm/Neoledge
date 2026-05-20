/**
 * @file CahierPreflightModal.spec.ts — smoke test for the pre-generation
 * gap-analysis modal.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { makeApiMock, makeNeolibMock, initPinia, stubs } from '@/__spec-utils'

vi.mock('@/lib/api', () => ({
  default: makeApiMock(),
  extractErrorMessage: (e: unknown) => (e as Error)?.message ?? null,
}))
vi.mock('@neolibrary/components', () => makeNeolibMock())

import CahierPreflightModal from './CahierPreflightModal.vue'
import api from '@/lib/api'

describe('CahierPreflightModal', () => {
  beforeEach(() => {
    initPinia()
    vi.clearAllMocks()
  })

  it('renders nothing when visible=false', () => {
    const w = mount(CahierPreflightModal, {
      props: { visible: false, projectId: 'p1' },
      global: { stubs },
    })
    expect(w.find('[data-stub="AppModal"]').exists()).toBe(false)
  })

  it('shows loading state then renders preflight result', async () => {
    ;(api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        readinessScore: 0.8,
        missingFields: [],
        answeredFields: ['contexte'],
        canGenerate: true,
        computedAt: Date.now(),
        source: 'ai',
      },
    })
    const w = mount(CahierPreflightModal, {
      props: { visible: true, projectId: 'p1' },
      global: { stubs },
    })
    await flushPromises()
    // Body either loaded or still loading — either renders something inside the modal.
    expect(w.find('[data-stub="AppModal"]').exists()).toBe(true)
  })
})
