/**
 * @file ChangePasswordDialog.spec.ts — smoke test for the
 * change-password dialog.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { makeApiMock, makeNeolibMock, initPinia, stubs } from '@/__spec-utils'

vi.mock('@/lib/api', () => ({
  default: makeApiMock(),
  extractErrorMessage: (e: unknown) => (e as Error)?.message ?? null,
}))
vi.mock('@neolibrary/components', () => makeNeolibMock())

import ChangePasswordDialog from './ChangePasswordDialog.vue'

describe('ChangePasswordDialog', () => {
  beforeEach(() => {
    initPinia()
    vi.clearAllMocks()
  })

  it('renders nothing when visible=false', () => {
    const w = mount(ChangePasswordDialog, {
      props: { visible: false },
      global: { stubs },
    })
    expect(w.find('[data-stub="AppModal"]').exists()).toBe(false)
  })

  it('renders the dialog when visible=true', () => {
    const w = mount(ChangePasswordDialog, {
      props: { visible: true },
      global: { stubs },
    })
    expect(w.exists()).toBe(true)
  })
})
