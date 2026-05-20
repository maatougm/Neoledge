import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AppSkeleton from './AppSkeleton.vue'

describe('AppSkeleton', () => {
  it('renders with default line variant + full width', () => {
    const wrapper = mount(AppSkeleton)
    const el = wrapper.find('.skeleton')
    expect(el.exists()).toBe(true)
    expect(el.classes()).toContain('skeleton--line')
    expect(el.attributes('style')).toContain('width: 100%')
    expect(el.attributes('style')).toContain('height: 16px')
  })

  it.each(['line', 'block', 'circle'])('applies variant modifier "%s"', (variant) => {
    const wrapper = mount(AppSkeleton, {
      props: { variant: variant as 'line' | 'block' | 'circle' },
    })
    expect(wrapper.find('.skeleton').classes()).toContain(`skeleton--${variant}`)
  })

  it('honors width + height props', () => {
    const wrapper = mount(AppSkeleton, {
      props: { width: '50%', height: '24px' },
    })
    const style = wrapper.find('.skeleton').attributes('style') ?? ''
    expect(style).toContain('width: 50%')
    expect(style).toContain('height: 24px')
  })
})
