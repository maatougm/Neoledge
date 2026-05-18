/**
 * NeoLibrary's wrapper components (NeoInputText, NeoPassword, …) don't forward
 * the `autocomplete` / `name` attributes to the underlying <input>, which makes
 * Chrome's password manager skip the field and the DOM Issues panel emit
 * "Input elements should have autocomplete attributes".
 *
 * Use these helpers in `onMounted` (after `nextTick()`) to patch the inner
 * inputs directly. Each helper scopes itself to a CSS selector so a dialog
 * can target only the inputs it owns instead of the whole document.
 */

export interface AutofillSpec {
  /** Selector for the wrapping element (form, .modal, etc.). Defaults to body. */
  scope?: string
  email?: 'email' | 'username'
  /** 'current-password' for sign-in, 'new-password' for create / reset / change. */
  password?: 'current-password' | 'new-password'
  /** When two password fields exist (current + new), pass second = 'new-password'. */
  passwordSecond?: 'current-password' | 'new-password'
}

function setIfMissing(el: Element, attrs: Record<string, string>): void {
  for (const [k, v] of Object.entries(attrs)) {
    if (!el.getAttribute(k)) el.setAttribute(k, v)
  }
}

export function applyAutofill(spec: AutofillSpec): void {
  const root = spec.scope ? document.querySelector(spec.scope) : document.body
  if (!root) return

  if (spec.email) {
    const e = root.querySelector('input[type="email"]')
    if (e) setIfMissing(e, { autocomplete: spec.email, name: spec.email })
  }
  if (spec.password) {
    const pw = root.querySelectorAll<HTMLInputElement>('input[type="password"]')
    if (pw[0]) setIfMissing(pw[0], { autocomplete: spec.password, name: spec.password })
    if (pw[1] && spec.passwordSecond) {
      setIfMissing(pw[1], { autocomplete: spec.passwordSecond, name: spec.passwordSecond })
    }
  }
}
