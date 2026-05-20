import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { mountOptions, initPinia } from '../__test-utils'
import CopilotCoverageBar from './CopilotCoverageBar.vue'

beforeEach(() => initPinia())

describe('CopilotCoverageBar', () => {
  it('renders the coverage percentage', () => {
    const w = mount(CopilotCoverageBar, mountOptions({
      props: { coveragePct: 65, driversAnswered: 4, driversTotal: 6 },
    }))
    expect(w.text()).toContain('65')
    expect(w.text()).toContain('4')
    expect(w.text()).toContain('6')
  })

  it('renders 0 coverage correctly', () => {
    const w = mount(CopilotCoverageBar, mountOptions({
      props: { coveragePct: 0, driversAnswered: 0, driversTotal: 10 },
    }))
    expect(w.text()).toContain('0')
  })

  it('renders 100% coverage correctly', () => {
    const w = mount(CopilotCoverageBar, mountOptions({
      props: { coveragePct: 100, driversAnswered: 10, driversTotal: 10 },
    }))
    expect(w.text()).toContain('100')
  })

  it('uses success color above 70%', () => {
    const w = mount(CopilotCoverageBar, mountOptions({
      props: { coveragePct: 85, driversAnswered: 5, driversTotal: 6 },
    }))
    expect(w.html()).toMatch(/--nl-success|#059669/i)
  })

  it('uses warn color in 40-69%', () => {
    const w = mount(CopilotCoverageBar, mountOptions({
      props: { coveragePct: 50, driversAnswered: 3, driversTotal: 6 },
    }))
    expect(w.html()).toMatch(/--nl-warn|#d97706/i)
  })

  it('uses danger color below 40%', () => {
    const w = mount(CopilotCoverageBar, mountOptions({
      props: { coveragePct: 20, driversAnswered: 1, driversTotal: 6 },
    }))
    expect(w.html()).toMatch(/--nl-danger|#dc2626/i)
  })
})
