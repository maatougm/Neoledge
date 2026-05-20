import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import Loader from './Loader.vue'

describe('Loader', () => {
  it('renders the overlay + spinner', () => {
    const wrapper = mount(Loader)
    expect(wrapper.find('.loader-overlay').exists()).toBe(true)
    expect(wrapper.find('.loader-spinner').exists()).toBe(true)
  })
})
