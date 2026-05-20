/**
 * @file autofillFix.spec.ts — unit tests for the DOM autofill patch helper.
 *
 * Uses jsdom (already wired in vitest.config) so we can hand-build a
 * fragment, call applyAutofill, and inspect the attributes after.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { applyAutofill } from './autofillFix'

beforeEach(() => {
  document.body.innerHTML = ''
})
afterEach(() => {
  document.body.innerHTML = ''
})

describe('applyAutofill', () => {
  it('sets autocomplete + name on the email input', () => {
    document.body.innerHTML = '<input type="email">'
    applyAutofill({ email: 'username' })
    const e = document.querySelector('input[type="email"]') as HTMLInputElement
    expect(e.getAttribute('autocomplete')).toBe('username')
    expect(e.getAttribute('name')).toBe('username')
  })

  it('sets autocomplete + name on the password input (single)', () => {
    document.body.innerHTML = '<input type="password">'
    applyAutofill({ password: 'current-password' })
    const pw = document.querySelector('input[type="password"]') as HTMLInputElement
    expect(pw.getAttribute('autocomplete')).toBe('current-password')
    expect(pw.getAttribute('name')).toBe('current-password')
  })

  it('sets attributes on BOTH password inputs when passwordSecond is provided', () => {
    document.body.innerHTML = '<input type="password" class="a"><input type="password" class="b">'
    applyAutofill({
      password: 'current-password',
      passwordSecond: 'new-password',
    })
    const a = document.querySelector('.a') as HTMLInputElement
    const b = document.querySelector('.b') as HTMLInputElement
    expect(a.getAttribute('autocomplete')).toBe('current-password')
    expect(b.getAttribute('autocomplete')).toBe('new-password')
  })

  it('does NOT overwrite an existing autocomplete attribute', () => {
    document.body.innerHTML = '<input type="email" autocomplete="foo">'
    applyAutofill({ email: 'username' })
    const e = document.querySelector('input[type="email"]') as HTMLInputElement
    expect(e.getAttribute('autocomplete')).toBe('foo')
  })

  it('scopes the patch to the provided selector', () => {
    document.body.innerHTML = `
      <form class="inside"><input type="email"></form>
      <input type="email" class="outside">
    `
    applyAutofill({ scope: '.inside', email: 'email' })
    const inside = document.querySelector('.inside input') as HTMLInputElement
    const outside = document.querySelector('.outside') as HTMLInputElement
    expect(inside.getAttribute('autocomplete')).toBe('email')
    expect(outside.getAttribute('autocomplete')).toBeNull()
  })

  it('no-ops when the scope selector matches nothing', () => {
    document.body.innerHTML = '<input type="email">'
    applyAutofill({ scope: '.does-not-exist', email: 'username' })
    const e = document.querySelector('input[type="email"]') as HTMLInputElement
    expect(e.getAttribute('autocomplete')).toBeNull()
  })

  it('no-ops when no email / password fields are present', () => {
    document.body.innerHTML = '<input type="text">'
    applyAutofill({ email: 'username', password: 'current-password' })
    // No errors thrown, no attributes added.
    const t = document.querySelector('input') as HTMLInputElement
    expect(t.getAttribute('autocomplete')).toBeNull()
  })
})
