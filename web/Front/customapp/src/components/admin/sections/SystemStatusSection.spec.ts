/** Smoke test — SystemStatusSection. */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { NEO_LIBRARY_STUBS } from '../__test-helpers__/stubs'

vi.mock('@/lib/api', () => ({
  default: {
    get: vi.fn().mockResolvedValue({
      data: {
        serverStatus: 'up', uptimeSeconds: 3600, memoryUsedMb: 120, nodeVersion: 'v22.0.0',
        databaseStatus: 'Connecté', transcriptionStatus: 'Connecté',
        userTotal: 0, userActive: 0, projectTotal: 0, projectByStatus: {},
        security: { lockedAccounts: 0, accountsUnderAttack: 0, logins24h: 0, failedLoginsCurrent: 0, recentEvents: [] },
        errors: { totalSinceBoot: 0, recentCount: 0, recent: [] },
      },
    }),
    post: vi.fn(), patch: vi.fn(), delete: vi.fn(),
  },
}))
vi.mock('@neolibrary/components', async () => ({ ...NEO_LIBRARY_STUBS }))

import SystemStatusSection from './SystemStatusSection.vue'

beforeEach(() => setActivePinia(createPinia()))

describe('SystemStatusSection', () => {
  it('mounts without throwing', () => {
    const w = mount(SystemStatusSection, { global: { stubs: NEO_LIBRARY_STUBS } })
    expect(w.exists()).toBe(true)
  })
})
