import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import PriorityDot from './PriorityDot.vue'

describe('PriorityDot', () => {
  it('renders with the lowercased priority modifier class', () => {
    const wrapper = mount(PriorityDot, { props: { priority: 'High' } })
    const dot = wrapper.find('.priority-dot')
    expect(dot.classes()).toContain('priority-dot--high')
    expect(dot.attributes('title')).toBe('High')
  })

  it('defaults to "medium" when no priority is provided', () => {
    const wrapper = mount(PriorityDot)
    const dot = wrapper.find('.priority-dot')
    expect(dot.classes()).toContain('priority-dot--medium')
    expect(dot.attributes('title')).toBe('Medium')
  })

  it.each(['Low', 'Medium', 'High', 'Critical'])('maps "%s" to its modifier', (p) => {
    const wrapper = mount(PriorityDot, { props: { priority: p } })
    expect(wrapper.find('.priority-dot').classes()).toContain(`priority-dot--${p.toLowerCase()}`)
  })

  it('falls back to "medium" when priority is empty string', () => {
    const wrapper = mount(PriorityDot, { props: { priority: '' } })
    expect(wrapper.find('.priority-dot').classes()).toContain('priority-dot--medium')
  })
})
