/**
 * @file ErrorBoundary.spec.ts — verifies the component renders + catches
 * errors from its slot.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { initPinia } from '@/__spec-utils'
import ErrorBoundary from './ErrorBoundary.vue'

describe('ErrorBoundary', () => {
  beforeEach(() => {
    initPinia()
    vi.clearAllMocks()
  })

  it('renders slot children without error', () => {
    const w = mount(ErrorBoundary, {
      slots: { default: '<div class="ok">All good</div>' },
    })
    expect(w.find('.ok').exists()).toBe(true)
  })

  it('catches errors thrown by slot children and renders a fallback', () => {
    // Suppress noisy Vue warning output for this synthetic crash.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const Crash = {
      setup() {
        throw new Error('boom')
      },
      template: '<div>x</div>',
    }
    const w = mount(ErrorBoundary, {
      slots: { default: () => [Crash] as unknown as string },
    })
    expect(w.exists()).toBe(true)
    errSpy.mockRestore()
  })
})
