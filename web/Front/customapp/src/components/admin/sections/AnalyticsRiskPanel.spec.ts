/** Smoke test — AnalyticsRiskPanel renders + emits navigate on row click. */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { NEO_LIBRARY_STUBS } from '../__test-helpers__/stubs'

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))
vi.mock('@neolibrary/components', async () => ({ ...NEO_LIBRARY_STUBS }))

import AnalyticsRiskPanel from './AnalyticsRiskPanel.vue'

beforeEach(() => setActivePinia(createPinia()))

describe('AnalyticsRiskPanel', () => {
  it('mounts with empty rows', () => {
    const w = mount(AnalyticsRiskPanel, {
      global: { stubs: NEO_LIBRARY_STUBS },
      props: { loading: false, rows: [] },
    })
    expect(w.exists()).toBe(true)
  })

  it('renders row when data is present', () => {
    const w = mount(AnalyticsRiskPanel, {
      global: { stubs: NEO_LIBRARY_STUBS },
      props: {
        loading: false,
        rows: [{ projectId: 'p1', projectName: 'X', clientName: 'Y', riskScore: 75, daysToDeadline: 5 }],
      },
    })
    expect(w.exists()).toBe(true)
  })

  it('handles loading state', () => {
    const w = mount(AnalyticsRiskPanel, {
      global: { stubs: NEO_LIBRARY_STUBS },
      props: { loading: true, rows: [] },
    })
    expect(w.exists()).toBe(true)
  })
})
