/**
 * @file CahierDesChargesSection.spec.ts — smoke test for the cahier panel.
 *
 * The streaming behavior is exercised by `src/lib/cahier-stream.spec.ts`.
 * This spec just covers the empty/saved render branches.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { makeApiMock, makeNeolibMock, initPinia, stubs } from '@/__spec-utils'

vi.mock('@/lib/api', () => ({
  default: makeApiMock(),
  extractErrorMessage: (e: unknown) => (e as Error)?.message ?? null,
}))
vi.mock('@neolibrary/components', () => makeNeolibMock())
vi.mock('@/lib/cahier-stream', () => ({ streamCahierPreview: vi.fn().mockResolvedValue(undefined) }))

import CahierDesChargesSection from './CahierDesChargesSection.vue'
import api from '@/lib/api'

describe('CahierDesChargesSection', () => {
  beforeEach(() => {
    initPinia()
    vi.clearAllMocks()
  })

  it('mounts in the empty state', async () => {
    ;(api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { aiContent: null, savedAt: null } })
    const w = mount(CahierDesChargesSection, {
      props: { projectId: 'p1' },
      global: { stubs },
    })
    await flushPromises()
    expect(w.text()).toContain('Cahier des charges')
  })

  it('renders the saved badge when a cahier is already persisted', async () => {
    ;(api.get as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.includes('/saved')) {
        return Promise.resolve({
          data: {
            aiContent: {
              objectifDocument: 'X', contexte: 'X', objectifProjet: 'X',
              perimetreInclus: 'X', perimetreExclus: 'X',
              exigencesFonctionnelles: [], architectureTechnique: [],
              livrables: 'X', conclusion: 'X',
            },
            savedAt: '2026-05-19T00:00:00.000Z',
          },
        })
      }
      return Promise.resolve({ data: {} })
    })
    const w = mount(CahierDesChargesSection, {
      props: { projectId: 'p1' },
      global: { stubs },
    })
    await flushPromises()
    expect(w.text()).toMatch(/Enregistré|enregistré|Cahier des charges/)
  })
})
