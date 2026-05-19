import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import StatusChip from './StatusChip.vue'

describe('StatusChip', () => {
  it('renders the mapped French label for a known status', () => {
    const wrapper = mount(StatusChip, { props: { status: 'InProgress' } })
    expect(wrapper.text()).toBe('En cours')
  })

  it('falls back to the raw status string for an unknown status', () => {
    const wrapper = mount(StatusChip, { props: { status: 'Mystery' } })
    expect(wrapper.text()).toBe('Mystery')
  })

  it('applies the per-status color + background as inline style', () => {
    const wrapper = mount(StatusChip, { props: { status: 'Blocked' } })
    const chip = wrapper.find('.chip')
    // Blocked → color #DC2626, background #FEF2F2
    expect(chip.attributes('style')).toContain('color: rgb(220, 38, 38)')
    expect(chip.attributes('style')).toContain('background: rgb(254, 242, 242)')
  })

  it('renders different colors for different statuses', () => {
    const a = mount(StatusChip, { props: { status: 'Resolved' } })
    const b = mount(StatusChip, { props: { status: 'OnHold' } })
    expect(a.find('.chip').attributes('style')).not.toBe(b.find('.chip').attributes('style'))
  })
})
