/**
 * @file CahierDocSection.spec.ts — pure-render smoke for the markdown chunk
 * renderer used inside the cahier preview.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { mountOptions, initPinia } from '../__test-utils'
import CahierDocSection from './CahierDocSection.vue'

beforeEach(() => initPinia())

describe('CahierDocSection', () => {
  it('renders the title in <h3> at level=main', () => {
    const w = mount(CahierDocSection, mountOptions({
      props: { title: '1.1 Objectif', markdown: 'Hello world.' },
    }))
    expect(w.find('h3').exists()).toBe(true)
    expect(w.find('h3').text()).toBe('1.1 Objectif')
  })

  it('renders <h4> at level=sub', () => {
    const w = mount(CahierDocSection, mountOptions({
      props: { title: 'Sub', markdown: 'x', level: 'sub' },
    }))
    expect(w.find('h4').exists()).toBe(true)
    expect(w.find('h3').exists()).toBe(false)
  })

  it("renders the empty-state when markdown is null", () => {
    const w = mount(CahierDocSection, mountOptions({
      props: { title: 'Empty', markdown: null },
    }))
    expect(w.html()).toContain('À définir')
  })

  it("renders the empty-state when markdown is whitespace only", () => {
    const w = mount(CahierDocSection, mountOptions({
      props: { title: 'Empty', markdown: '   \n  ' },
    }))
    expect(w.html()).toContain('À définir')
  })

  it('converts bullet lines into a <ul>', () => {
    const w = mount(CahierDocSection, mountOptions({
      props: { title: 'List', markdown: '- one\n- two\n- three' },
    }))
    const html = w.html()
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>one</li>')
    expect(html).toContain('<li>two</li>')
    expect(html).toContain('<li>three</li>')
  })

  it('renders **bold** markdown as <strong>', () => {
    const w = mount(CahierDocSection, mountOptions({
      props: { title: 'B', markdown: 'This is **important** text.' },
    }))
    expect(w.html()).toContain('<strong>important</strong>')
  })

  it('escapes HTML in raw markdown (XSS defence)', () => {
    const w = mount(CahierDocSection, mountOptions({
      props: { title: 'X', markdown: '<script>alert(1)</script>' },
    }))
    const html = w.html()
    // The literal tag must NOT appear; the escaped form must.
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html.toLowerCase()).toMatch(/&lt;script/i)
  })

  it('renders INFO_MANQUANTE markers as inline text (not stripped)', () => {
    const w = mount(CahierDocSection, mountOptions({
      props: { title: 'M', markdown: 'INFO_MANQUANTE: budget total' },
    }))
    expect(w.text()).toContain('INFO_MANQUANTE: budget total')
  })
})
