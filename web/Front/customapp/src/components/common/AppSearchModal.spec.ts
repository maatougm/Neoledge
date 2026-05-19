/**
 * @file AppSearchModal.spec.ts — smoke test for the global Cmd+K search modal.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { makeApiMock, makeNeolibMock, initPinia, stubs } from '@/__spec-utils'

vi.mock('@/lib/api', () => ({
  default: makeApiMock(),
  extractErrorMessage: (e: unknown) => (e as Error)?.message ?? null,
}))
vi.mock('@neolibrary/components', () => makeNeolibMock())
vi.mock('vue-router', async () => {
  const actual = await vi.importActual<typeof import('vue-router')>('vue-router')
  return { ...actual, useRouter: () => ({ push: vi.fn() }), useRoute: () => ({ query: {} }) }
})

import AppSearchModal from './AppSearchModal.vue'

describe('AppSearchModal', () => {
  beforeEach(() => {
    initPinia()
    vi.clearAllMocks()
  })

  it('does not render when visible=false', () => {
    const w = mount(AppSearchModal, {
      props: { visible: false },
      global: { stubs },
    })
    expect(w.find('[data-stub="AppModal"]').exists()).toBe(false)
  })

  it('renders when visible=true', () => {
    const w = mount(AppSearchModal, {
      props: { visible: true },
      global: { stubs },
    })
    expect(w.exists()).toBe(true)
  })
})
