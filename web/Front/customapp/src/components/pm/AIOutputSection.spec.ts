/**
 * @file AIOutputSection.spec.ts — smoke test for the AI output panel.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { makeApiMock, makeNeolibMock, initPinia, stubs } from '@/__spec-utils'

vi.mock('@/lib/api', () => ({
  default: makeApiMock(),
  extractErrorMessage: (e: unknown) => (e as Error)?.message ?? null,
}))
vi.mock('@neolibrary/components', () => makeNeolibMock())

import AIOutputSection from './AIOutputSection.vue'
import api from '@/lib/api'

describe('AIOutputSection', () => {
  beforeEach(() => {
    initPinia()
    vi.clearAllMocks()
  })

  it('mounts without crashing in the empty state', async () => {
    ;(api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { aiContent: null, savedAt: null } })
    const w = mount(AIOutputSection, {
      props: { projectId: 'p1' },
      global: { stubs },
    })
    await flushPromises()
    expect(w.exists()).toBe(true)
    expect(w.text()).toContain('Analyse IA')
  })

  it('renders sections when aiContent is loaded', async () => {
    ;(api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        aiContent: {
          contexte: 'Le contexte du projet',
          objectifProjet: 'Objectif testé',
        },
        savedAt: '2026-05-19T00:00:00.000Z',
      },
    })
    const w = mount(AIOutputSection, {
      props: { projectId: 'p1' },
      global: { stubs },
    })
    await flushPromises()
    expect(w.text()).toContain('Contexte')
    expect(w.text()).toContain('Le contexte du projet')
  })

  it('does not call API without projectId prop', async () => {
    const w = mount(AIOutputSection, { global: { stubs } })
    await flushPromises()
    expect(api.get).not.toHaveBeenCalled()
    expect(w.text()).toContain('Analyse IA')
  })
})
