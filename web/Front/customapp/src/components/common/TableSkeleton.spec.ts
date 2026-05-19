import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TableSkeleton from './TableSkeleton.vue'

describe('TableSkeleton', () => {
  it('renders default 6 rows × 5 cols of skeleton cells', () => {
    const wrapper = mount(TableSkeleton)
    expect(wrapper.findAll('.table-skel__row')).toHaveLength(6)
    expect(wrapper.findAll('.skeleton')).toHaveLength(6 * 5)
  })

  it('honors rows + cols props', () => {
    const wrapper = mount(TableSkeleton, { props: { rows: 3, cols: 2 } })
    expect(wrapper.findAll('.table-skel__row')).toHaveLength(3)
    expect(wrapper.findAll('.skeleton')).toHaveLength(3 * 2)
  })

  it('handles zero rows gracefully', () => {
    const wrapper = mount(TableSkeleton, { props: { rows: 0, cols: 5 } })
    expect(wrapper.findAll('.table-skel__row')).toHaveLength(0)
    expect(wrapper.findAll('.skeleton')).toHaveLength(0)
  })
})
