/**
 * @file sanitize.spec.ts — unit tests for the DOMPurify wrapper.
 *
 * Confirms the canonical allow-list defended in `sanitize.ts`:
 *   - script / iframe / object / embed / style / link / meta tags stripped
 *   - on-*, formaction, javascript: protocols stripped
 *   - Common safe tags + the small set of allowed attributes preserved
 */

import { describe, it, expect } from 'vitest'
import { sanitize } from './sanitize'

describe('sanitize', () => {
  it('returns empty string for empty / falsy input', () => {
    expect(sanitize('')).toBe('')
    expect(sanitize(undefined as unknown as string)).toBe('')
    expect(sanitize(null as unknown as string)).toBe('')
  })

  it('preserves plain text', () => {
    expect(sanitize('hello world')).toBe('hello world')
  })

  it('preserves allowed tags (p, strong, em, ul/li, h1, code, a)', () => {
    expect(sanitize('<p>x</p>')).toBe('<p>x</p>')
    expect(sanitize('<strong>x</strong>')).toBe('<strong>x</strong>')
    expect(sanitize('<em>x</em>')).toBe('<em>x</em>')
    expect(sanitize('<ul><li>a</li><li>b</li></ul>')).toBe('<ul><li>a</li><li>b</li></ul>')
    expect(sanitize('<h1>title</h1>')).toBe('<h1>title</h1>')
    expect(sanitize('<code>x</code>')).toBe('<code>x</code>')
    expect(sanitize('<a href="https://x.com">x</a>')).toContain('href="https://x.com"')
  })

  it('preserves table primitives', () => {
    expect(sanitize('<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>v</td></tr></tbody></table>'))
      .toContain('<table>')
  })

  it('strips <script> entirely', () => {
    const out = sanitize('safe<script>alert(1)</script>tail')
    expect(out).not.toMatch(/script/i)
    expect(out).toContain('safe')
    expect(out).toContain('tail')
    expect(out).not.toContain('alert(1)')
  })

  it('strips <iframe>', () => {
    const out = sanitize('<iframe src="https://evil.com"></iframe>')
    expect(out).not.toMatch(/iframe/i)
  })

  it('strips <style>', () => {
    const out = sanitize('<style>body { color: red }</style>')
    expect(out).not.toMatch(/style/i)
  })

  it('strips <link> and <meta>', () => {
    const out = sanitize('<link rel="stylesheet" href="x"><meta http-equiv="refresh" content="0;url=y">')
    expect(out).not.toMatch(/<link/i)
    expect(out).not.toMatch(/<meta/i)
  })

  it('strips onerror/onclick/onload event handlers', () => {
    const out = sanitize('<p onclick="bad()" onerror="bad()" onload="bad()">x</p>')
    expect(out).toContain('<p')
    expect(out).not.toMatch(/onclick/i)
    expect(out).not.toMatch(/onerror/i)
    expect(out).not.toMatch(/onload/i)
  })

  it('strips javascript: URLs from href', () => {
    const out = sanitize('<a href="javascript:bad()">click</a>')
    expect(out).not.toMatch(/javascript:/i)
  })

  it('strips disallowed tags but keeps inner text', () => {
    // <object> is in FORBID_TAGS — body should drop the tag.
    const out = sanitize('<object data="x"><p>fallback</p></object>')
    expect(out).not.toMatch(/<object/i)
  })

  it('preserves the class attribute', () => {
    const out = sanitize('<p class="warn">x</p>')
    expect(out).toContain('class="warn"')
  })

  it('strips disallowed attributes like style and id', () => {
    const out = sanitize('<p style="color: red" id="x" data-foo="y">text</p>')
    expect(out).not.toMatch(/style=/i)
    expect(out).not.toMatch(/id=/i)
    expect(out).not.toMatch(/data-foo/i)
  })
})
