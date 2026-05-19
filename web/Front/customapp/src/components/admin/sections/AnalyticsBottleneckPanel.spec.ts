/** Smoke test — AnalyticsBottleneckPanel renders with rows prop. */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { NEO_LIBRARY_STUBS, NEO_TOAST_MOCK } from '../__test-helpers__/stubs'

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn().mockResolvedValue({ data: {} }), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))
vi.mock('@neolibrary/components', async () => ({
  ...NEO_LIBRARY_STUBS,
  useNeoToast: () => NEO_TOAST_MOCK,
}))

import AnalyticsBottleneckPanel from './AnalyticsBottleneckPanel.vue'

beforeEach(() => setActivePinia(createPinia()))

describe('AnalyticsBottleneckPanel', () => {
  it('mounts with empty rows', () => {
    const w = mount(AnalyticsBottleneckPanel, {
      global: { stubs: NEO_LIBRARY_STUBS },
      props: { loading: false, rows: [] },
    })
    expect(w.exists()).toBe(true)
  })

  it('renders rows when data is present', () => {
    const w = mount(AnalyticsBottleneckPanel, {
      global: { stubs: NEO_LIBRARY_STUBS },
      props: { loading: false, rows: [{ projectId: 'p1', projectName: 'X', daysStuck: 12, severity: 'high' }] },
    })
    expect(w.exists()).toBe(true)
  })

  it('handles loading state', () => {
    const w = mount(AnalyticsBottleneckPanel, {
      global: { stubs: NEO_LIBRARY_STUBS },
      props: { loading: true, rows: [] },
    })
    expect(w.exists()).toBe(true)
  })
})
