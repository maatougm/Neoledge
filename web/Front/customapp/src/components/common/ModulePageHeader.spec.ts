import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ModulePageHeader from './ModulePageHeader.vue'

const NeoTagStub = {
  template: '<span class="ntag" :data-severity="severity">{{ value }}</span>',
  props: ['value', 'severity'],
}

describe('ModulePageHeader', () => {
  it('renders the title', () => {
    const wrapper = mount(ModulePageHeader, {
      props: { title: 'My Title' },
      global: { stubs: { NeoTag: NeoTagStub } },
    })
    expect(wrapper.find('.module-header__title').text()).toBe('My Title')
  })

  it('does NOT render the NeoTag when status prop is absent', () => {
    const wrapper = mount(ModulePageHeader, {
      props: { title: 'X' },
      global: { stubs: { NeoTag: NeoTagStub } },
    })
    expect(wrapper.find('.ntag').exists()).toBe(false)
  })

  it('renders the NeoTag with the given status + severity', () => {
    const wrapper = mount(ModulePageHeader, {
      props: { title: 'X', status: 'Approved', statusSeverity: 'success' },
      global: { stubs: { NeoTag: NeoTagStub } },
    })
    const tag = wrapper.find('.ntag')
    expect(tag.exists()).toBe(true)
    expect(tag.text()).toBe('Approved')
    expect(tag.attributes('data-severity')).toBe('success')
  })

  it('exposes an "actions" named slot', () => {
    const wrapper = mount(ModulePageHeader, {
      props: { title: 'X' },
      slots: { actions: '<button class="custom-action">Go</button>' },
      global: { stubs: { NeoTag: NeoTagStub } },
    })
    expect(wrapper.find('.module-header__actions .custom-action').exists()).toBe(true)
    expect(wrapper.find('.custom-action').text()).toBe('Go')
  })
})
