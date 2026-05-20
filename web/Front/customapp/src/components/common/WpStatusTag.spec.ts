import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import WpStatusTag from './WpStatusTag.vue'

describe('WpStatusTag', () => {
  it('renders a NeoTag with the mapped label + severity for a known status', () => {
    const wrapper = mount(WpStatusTag, {
      props: { status: 'InProgress' },
      global: { stubs: { NeoTag: { template: '<span class="ntag" :data-severity="severity">{{ value }}</span>', props: ['value', 'severity'] } } },
    })
    const tag = wrapper.find('.ntag')
    expect(tag.text()).toBe('En cours')
    expect(tag.attributes('data-severity')).toBe('info')
  })

  it('falls back to the raw status string when unknown', () => {
    const wrapper = mount(WpStatusTag, {
      props: { status: 'Mystery' },
      global: { stubs: { NeoTag: { template: '<span class="ntag" :data-severity="severity">{{ value }}</span>', props: ['value', 'severity'] } } },
    })
    expect(wrapper.find('.ntag').text()).toBe('Mystery')
    // FALLBACK uses 'secondary' severity
    expect(wrapper.find('.ntag').attributes('data-severity')).toBe('secondary')
  })

  it.each([
    ['Blocked', 'danger'],
    ['Resolved', 'success'],
    ['OnHold', 'warn'],
  ])('maps %s status to severity=%s', (status, severity) => {
    const wrapper = mount(WpStatusTag, {
      props: { status },
      global: { stubs: { NeoTag: { template: '<span class="ntag" :data-severity="severity" />', props: ['value', 'severity'] } } },
    })
    expect(wrapper.find('.ntag').attributes('data-severity')).toBe(severity)
  })
})
