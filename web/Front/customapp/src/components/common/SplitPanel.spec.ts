import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import SplitPanel from './SplitPanel.vue'

describe('SplitPanel', () => {
  it('renders only the list slot when showDetail=false', () => {
    const wrapper = mount(SplitPanel, {
      props: { showDetail: false },
      slots: { list: '<div class="L">left</div>', detail: '<div class="R">right</div>' },
    })
    expect(wrapper.find('.split-panel__list').exists()).toBe(true)
    expect(wrapper.find('.split-panel__list').text()).toBe('left')
    expect(wrapper.find('.split-panel__detail').exists()).toBe(false)
    expect(wrapper.find('.split-panel').classes()).not.toContain('split-panel--has-detail')
  })

  it('renders both slots and the modifier when showDetail=true', () => {
    const wrapper = mount(SplitPanel, {
      props: { showDetail: true },
      slots: { list: '<div>L</div>', detail: '<div>R</div>' },
    })
    expect(wrapper.find('.split-panel__list').text()).toBe('L')
    expect(wrapper.find('.split-panel__detail').text()).toBe('R')
    expect(wrapper.find('.split-panel').classes()).toContain('split-panel--has-detail')
  })
})
