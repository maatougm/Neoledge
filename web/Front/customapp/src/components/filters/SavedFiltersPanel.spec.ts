/**
 * @file SavedFiltersPanel.spec.ts — smoke test for the saved-filters panel.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { makeApiMock, makeNeolibMock, initPinia, stubs } from '@/__spec-utils'

vi.mock('@/lib/api', () => ({
  default: makeApiMock(),
  extractErrorMessage: (e: unknown) => (e as Error)?.message ?? null,
}))
vi.mock('@neolibrary/components', () => makeNeolibMock())

import SavedFiltersPanel from './SavedFiltersPanel.vue'

describe('SavedFiltersPanel', () => {
  beforeEach(() => {
    initPinia()
    vi.clearAllMocks()
  })

  it('mounts without crashing', () => {
    const w = mount(SavedFiltersPanel, { global: { stubs } })
    expect(w.exists()).toBe(true)
  })

  it('mounts with currentCriteria', () => {
    const w = mount(SavedFiltersPanel, {
      props: { currentCriteria: { search: 'foo' } },
      global: { stubs },
    })
    expect(w.exists()).toBe(true)
  })
})
