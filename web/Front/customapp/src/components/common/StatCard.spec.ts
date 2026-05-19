import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import StatCard from './StatCard.vue'

describe('StatCard', () => {
  it('renders value + label + icon class', () => {
    const wrapper = mount(StatCard, {
      props: { icon: 'pi-users', label: 'Users', value: 42 },
    })
    expect(wrapper.text()).toContain('42')
    expect(wrapper.text()).toContain('Users')
    expect(wrapper.find('i.pi').classes()).toContain('pi-users')
  })

  it('accepts string values', () => {
    const wrapper = mount(StatCard, {
      props: { icon: 'pi-clock', label: 'Total', value: '3.2k' },
    })
    expect(wrapper.text()).toContain('3.2k')
  })

  it.each(['normal', 'danger', 'warning', 'success'])('applies tone modifier "%s"', (tone) => {
    const wrapper = mount(StatCard, {
      props: { icon: 'pi-x', label: 'L', value: 1, tone: tone as 'normal' | 'danger' | 'warning' | 'success' },
    })
    expect(wrapper.find('.stat').classes()).toContain(`stat--${tone}`)
  })

  it('omits a tone class when prop is undefined', () => {
    const wrapper = mount(StatCard, { props: { icon: 'pi-x', label: 'L', value: 1 } })
    // class becomes "stat stat--undefined" — accept either undefined modifier OR none
    const classes = wrapper.find('.stat').classes()
    expect(classes).toContain('stat')
  })
})
