import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import KeyboardHelpDialog from './KeyboardHelpDialog.vue'

beforeEach(() => {
  document.body.innerHTML = ''
  document.body.style.overflow = ''
})
afterEach(() => {
  document.body.innerHTML = ''
  document.body.style.overflow = ''
})

describe('KeyboardHelpDialog', () => {
  it('renders nothing when visible=false', async () => {
    mount(KeyboardHelpDialog, {
      props: { visible: false },
      attachTo: document.body,
    })
    await flushPromises()
    expect(document.body.querySelector('.kb-help')).toBeNull()
  })

  it('renders the kbd table when visible=true', async () => {
    mount(KeyboardHelpDialog, {
      props: { visible: true },
      attachTo: document.body,
    })
    await flushPromises()
    expect(document.body.querySelector('.kb-help')).toBeTruthy()
    expect(document.body.textContent).toContain('Raccourcis clavier')
    expect(document.body.textContent).toContain('Recherche globale')
  })

  it('emits update:visible=false when the modal close button is clicked', async () => {
    const wrapper = mount(KeyboardHelpDialog, {
      props: { visible: true },
      attachTo: document.body,
    })
    await flushPromises()
    const closeBtn = document.body.querySelector('.modal-close') as HTMLElement | null
    closeBtn?.click()
    await flushPromises()
    expect(wrapper.emitted('update:visible')?.[0]).toEqual([false])
  })
})
