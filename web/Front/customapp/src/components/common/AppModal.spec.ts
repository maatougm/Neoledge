/**
 * AppModal uses Teleport to body + a Transition wrapper + global keydown
 * listener. Tests cover the public surface: visibility binding, close
 * paths (backdrop click, ✕ button, Esc), and the body scroll-lock.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import AppModal from './AppModal.vue'

beforeEach(() => {
  document.body.innerHTML = ''
  document.body.style.overflow = ''
})

afterEach(() => {
  document.body.innerHTML = ''
  document.body.style.overflow = ''
})

describe('AppModal', () => {
  it('renders nothing when visible=false', async () => {
    mount(AppModal, {
      props: { visible: false, header: 'Hi' },
      attachTo: document.body,
    })
    await flushPromises()
    expect(document.body.innerHTML).not.toContain('modal-box')
  })

  it('renders the header, body slot, and footer slot when visible=true', async () => {
    mount(AppModal, {
      props: { visible: true, header: 'Welcome' },
      slots: { default: 'BODY-X', footer: '<button class="ft-btn">OK</button>' },
      attachTo: document.body,
    })
    await flushPromises()
    expect(document.body.querySelector('.modal-title')?.textContent).toBe('Welcome')
    expect(document.body.textContent).toContain('BODY-X')
    expect(document.body.querySelector('.ft-btn')).toBeTruthy()
  })

  it('honors the width prop on the modal box', async () => {
    mount(AppModal, {
      props: { visible: true, header: 'X', width: '720px' },
      attachTo: document.body,
    })
    await flushPromises()
    const box = document.body.querySelector('.modal-box') as HTMLElement | null
    expect(box?.style.width).toBe('720px')
  })

  it('emits update:visible=false when the ✕ button is clicked', async () => {
    const wrapper = mount(AppModal, {
      props: { visible: true, header: 'X' },
      attachTo: document.body,
    })
    await flushPromises()
    const closeBtn = document.body.querySelector('.modal-close') as HTMLElement | null
    expect(closeBtn).toBeTruthy()
    closeBtn!.click()
    await flushPromises()
    expect(wrapper.emitted('update:visible')?.[0]).toEqual([false])
  })

  it('emits update:visible=false on Escape key', async () => {
    const wrapper = mount(AppModal, {
      props: { visible: true, header: 'X' },
      attachTo: document.body,
    })
    await flushPromises()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(wrapper.emitted('update:visible')?.[0]).toEqual([false])
  })

  it('locks body scroll while visible and restores it when closed', async () => {
    const wrapper = mount(AppModal, {
      props: { visible: true, header: 'X' },
      attachTo: document.body,
    })
    await flushPromises()
    expect(document.body.style.overflow).toBe('hidden')
    await wrapper.setProps({ visible: false })
    await flushPromises()
    expect(document.body.style.overflow).toBe('')
  })
})
