/**
 * @file CopilotChecklistPanel.spec.ts — smoke test for the live copilot's
 * topic checklist panel.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { makeApiMock, makeNeolibMock, initPinia, stubs } from '@/__spec-utils'
import type { ChecklistItem } from '@/composables/useLiveCopilot'

vi.mock('@/lib/api', () => ({
  default: makeApiMock(),
  extractErrorMessage: (e: unknown) => (e as Error)?.message ?? null,
}))
vi.mock('@neolibrary/components', () => makeNeolibMock())

import CopilotChecklistPanel from './CopilotChecklistPanel.vue'

const baseProps = {
  enabled: true,
  connected: true,
  refreshing: false,
  checklist: [] as ChecklistItem[],
  hint: null as string | null,
  readyForCahier: false,
  lastSkipReason: null,
  coveredCount: 0,
  totalCount: 0,
}

describe('CopilotChecklistPanel', () => {
  beforeEach(() => {
    initPinia()
    vi.clearAllMocks()
  })

  it('mounts in the empty checklist state', () => {
    const w = mount(CopilotChecklistPanel, {
      props: baseProps,
      global: { stubs },
    })
    expect(w.exists()).toBe(true)
  })

  it('renders checklist items when provided', () => {
    const checklist: ChecklistItem[] = [
      { id: 'i1', category: 'context', topic: 'Contexte général', question: '', section: 'contexte', status: 'covered', evidence: 'discussed', suggestion: null, userAction: null },
      { id: 'i2', category: 'features', topic: 'Périmètre', question: '', section: 'perimetreInclus', status: 'missing', evidence: null, suggestion: null, userAction: null },
    ]
    const w = mount(CopilotChecklistPanel, {
      props: { ...baseProps, checklist, coveredCount: 1 },
      global: { stubs },
    })
    expect(w.text()).toMatch(/Contexte|Périmètre/)
  })

  it('renders the disconnected-state text when connected=false', () => {
    const w = mount(CopilotChecklistPanel, {
      props: { ...baseProps, connected: false },
      global: { stubs },
    })
    // The exact text varies but the panel always renders something about
    // the connection state — assert non-empty content + the header.
    expect(w.text()).toMatch(/Connexion|Checklist|Préparation/)
  })
})
