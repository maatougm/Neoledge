/**
 * @file FilterBuilder.spec.ts — smoke test for the filter UI builder.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { makeApiMock, makeNeolibMock, initPinia, stubs } from '@/__spec-utils'

vi.mock('@/lib/api', () => ({
  default: makeApiMock(),
  extractErrorMessage: (e: unknown) => (e as Error)?.message ?? null,
}))
vi.mock('@neolibrary/components', () => makeNeolibMock())

import FilterBuilder from './FilterBuilder.vue'

describe('FilterBuilder', () => {
  beforeEach(() => {
    initPinia()
    vi.clearAllMocks()
  })

  it('mounts with empty initial criteria', () => {
    const w = mount(FilterBuilder, { global: { stubs } })
    expect(w.exists()).toBe(true)
  })

  it('mounts with a populated modelValue', () => {
    const w = mount(FilterBuilder, {
      props: { modelValue: { search: 'foo', status: ['Active'] } },
      global: { stubs },
    })
    expect(w.exists()).toBe(true)
  })
})
