import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import PresenceAvatars from './PresenceAvatars.vue'

interface PresenceUser {
  userId: string
  name: string
  color: string
}

function makeUser(i: number): PresenceUser {
  return { userId: `u${i}`, name: `User ${i}`, color: '#abcdef' }
}

describe('PresenceAvatars', () => {
  it('renders one avatar per user (under the 5-cap)', () => {
    const list = [makeUser(1), makeUser(2), makeUser(3)]
    const wrapper = mount(PresenceAvatars, { props: { presenceList: list } })
    const avatars = wrapper.findAll('.avatar:not(.avatar--more)')
    expect(avatars).toHaveLength(3)
    expect(avatars[0].text()).toBe('U')
    expect(avatars[0].attributes('title')).toBe('User 1')
  })

  it('caps visible avatars at 5 and renders an "+N" pill for the rest', () => {
    const list = Array.from({ length: 8 }, (_, i) => makeUser(i))
    const wrapper = mount(PresenceAvatars, { props: { presenceList: list } })
    expect(wrapper.findAll('.avatar:not(.avatar--more)')).toHaveLength(5)
    const more = wrapper.find('.avatar--more')
    expect(more.exists()).toBe(true)
    expect(more.text()).toBe('+3')
    expect(more.attributes('aria-label')).toBe('3 autres utilisateurs')
  })

  it('does not render the "+N" pill when exactly at the visible cap', () => {
    const list = Array.from({ length: 5 }, (_, i) => makeUser(i))
    const wrapper = mount(PresenceAvatars, { props: { presenceList: list } })
    expect(wrapper.find('.avatar--more').exists()).toBe(false)
  })

  it('uses "?" as initial when a name is empty', () => {
    const wrapper = mount(PresenceAvatars, {
      props: { presenceList: [{ userId: 'u0', name: '', color: '#000' }] },
    })
    expect(wrapper.find('.avatar').text()).toBe('?')
  })

  it('renders nothing when the list is empty', () => {
    const wrapper = mount(PresenceAvatars, { props: { presenceList: [] } })
    expect(wrapper.findAll('.avatar')).toHaveLength(0)
  })
})
